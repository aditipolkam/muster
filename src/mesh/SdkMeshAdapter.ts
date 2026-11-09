import type { Clock } from '../shared/clock';
import { Emitter, Unsubscribe } from '../shared/emitter';
import { createLogger } from '../shared/logger';
import { appError, err, ok, Result } from '../shared/result';
import type { PermissionsPort } from './permissions';
import type { ProtocolConfig, SdkFactory, SdkProtocol, SdkServices } from './sdk';
import type {
  BatteryPort,
  MeshDiagnosticLine,
  MeshPort,
  MeshSnapshot,
  Peer,
  PublishReport,
  ServiceTransport,
  ServiceUpdate,
  SubscribeRequest,
  SubscriptionChange,
  SubscriptionInfo,
} from './types';

const log = createLogger('mesh');
const MAX_LOST_PEERS = 50;
const MAX_DIAGNOSTICS = 50;
const LINK_REFRESH_MS = 1000;

/** Config per docs/SDK_INTEGRATION.md section 11, minus Wi-Fi Direct (Phase 2 is BLE only). */
export function buildProtocolConfig(): ProtocolConfig {
  return {
    appId: 'app.muster',
    profile: 'main',
    network: { initialTtl: 8 },
    transports: {
      ble: { enabled: true },
      wifiDirect: { enabled: false },
      internet: { enabled: false },
    },
    dors: { preferOnline: false },
    relay: { allowRelay: true, minBatteryForRelay: 35, relayPriority: 'auto' },
  } as ProtocolConfig;
}

export type SdkMeshAdapterDeps = {
  sdk: SdkFactory;
  permissions: PermissionsPort;
  clock: Clock;
  platform: 'ios' | 'android';
  battery?: BatteryPort;
};

const INITIAL: MeshSnapshot = {
  lifecycle: 'idle',
  sdkState: null,
  bluetooth: 'unknown',
  permissions: 'unknown',
  localAddress: null,
  blePeerCount: null,
  peers: [],
  lastError: null,
  startedAt: null,
  diagnostics: [],
};

/**
 * The single owner of the SDK lifecycle (docs/SDK_INTEGRATION.md section 8):
 *  1. one `OfflineProtocol` per process, never reused after `destroy()`;
 *  2. every listener is registered right after construction and before `start()`;
 *  3. battery is fed after `start()` and on each change;
 *  4. on foreground, `getState()` is reconciled and the mesh restarted if it should be running.
 * Telemetry is never enabled; no networking code lives here.
 */
export class SdkMeshAdapter implements MeshPort {
  readonly services: ServiceTransport;
  private snap: MeshSnapshot = INITIAL;
  private readonly changes = new Emitter<void>();
  private readonly updates = new Emitter<ServiceUpdate>();
  private readonly subChanges = new Emitter<SubscriptionChange>();
  private readonly requests = new Emitter<SubscribeRequest>();
  private readonly started = new Emitter<void>();
  private protocol: SdkProtocol | null = null;
  private readonly sdkServices: SdkServices;
  /** The user's intent. Cleared by `stop()` and by "stopped by user"; drives foreground restart. */
  private wantRunning = false;
  private starting: Promise<Result<void>> | null = null;
  private linkTimer: ReturnType<typeof setTimeout> | null = null;
  private batteryUnsub: Unsubscribe | null = null;

  constructor(private readonly deps: SdkMeshAdapterDeps) {
    this.sdkServices = deps.sdk.createServices();
    this.services = this.buildServiceTransport();
  }

  getSnapshot = (): MeshSnapshot => this.snap;

  subscribe = (listener: () => void): Unsubscribe => this.changes.subscribe(listener);

  // ---- lifecycle -----------------------------------------------------------------------------

  start(): Promise<Result<void>> {
    if (this.snap.lifecycle === 'running') {
      return Promise.resolve(ok(undefined));
    }
    this.starting ??= this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<Result<void>> {
    this.wantRunning = true;
    this.set({ lifecycle: 'starting', lastError: null });

    let permissions = await this.deps.permissions.check();
    if (permissions !== 'granted' && this.deps.platform === 'android') {
      permissions = await this.deps.permissions.request();
    }
    this.set({ permissions });
    if (permissions === 'denied' || permissions === 'blocked') {
      return this.failStart(
        appError(
          'mesh.permission_denied',
          permissions === 'blocked'
            ? 'Bluetooth permission is blocked. Enable it in system settings.'
            : 'Bluetooth permission is needed to find nearby devices.',
        ),
        'stopped',
      );
    }

    const protocol = this.ensureProtocol();

    try {
      let bt = await protocol.isBluetoothEnabled();
      if (!bt && this.deps.platform === 'android') {
        bt = await protocol.requestEnableBluetooth();
      }
      this.set({ bluetooth: bt ? 'on' : 'off' });
      // iOS cannot enable Bluetooth programmatically, and the CoreBluetooth authorisation prompt
      // only appears once the SDK starts BLE, so on iOS we start anyway and re-read afterwards.
      if (!bt && this.deps.platform === 'android') {
        return this.failStart(
          appError('mesh.bluetooth_off', 'Turn Bluetooth on to find nearby devices.'),
          'stopped',
        );
      }
    } catch (e) {
      log.warn(`bluetooth check failed: ${String(e)}`);
    }

    try {
      await protocol.start();
    } catch (e) {
      return this.failStart(
        appError('mesh.start_failed', 'The mesh could not start.', {
          retryable: true,
          message: e instanceof Error ? e.message : String(e),
        }),
        'error',
      );
    }

    const [address, state, bt] = await Promise.all([
      protocol.localAddress().catch(() => null),
      protocol.getState().catch(() => null),
      protocol.isBluetoothEnabled().catch(() => null),
    ]);
    this.set({
      lifecycle: 'running',
      sdkState: state === null ? null : String(state),
      localAddress: address ?? this.snap.localAddress,
      bluetooth: bt === null ? this.snap.bluetooth : bt ? 'on' : 'off',
      startedAt: this.deps.clock.now(),
    });
    await this.feedBattery(protocol);
    void this.refreshLinks();
    this.started.emit();
    return ok(undefined);
  }

  async stop(): Promise<Result<void>> {
    this.wantRunning = false;
    const protocol = this.protocol;
    if (!protocol || (this.snap.lifecycle !== 'running' && this.snap.lifecycle !== 'starting')) {
      return ok(undefined);
    }
    this.set({ lifecycle: 'stopping' });
    try {
      await protocol.stop();
    } catch (e) {
      const error = appError('mesh.stop_failed', 'The mesh could not stop cleanly.', {
        message: e instanceof Error ? e.message : String(e),
      });
      this.set({ lifecycle: 'error', lastError: error });
      return err(error);
    }
    this.markAllPeersLost();
    this.set({ lifecycle: 'stopped', sdkState: 'Stopped', startedAt: null });
    return ok(undefined);
  }

  async destroy(): Promise<void> {
    this.wantRunning = false;
    this.batteryUnsub?.();
    this.batteryUnsub = null;
    if (this.linkTimer) {
      clearTimeout(this.linkTimer);
      this.linkTimer = null;
    }
    const protocol = this.protocol;
    this.protocol = null; // never reuse a destroyed instance
    if (protocol) {
      try {
        await protocol.destroy();
      } catch (e) {
        log.warn(`destroy failed: ${String(e)}`);
      }
    }
    this.markAllPeersLost();
    this.set({ lifecycle: 'idle', sdkState: null, startedAt: null });
  }

  async reconcile(): Promise<void> {
    const protocol = this.protocol;
    if (!protocol) {
      return;
    }
    try {
      const state = String(await protocol.getState());
      this.set({ sdkState: state });
      if (this.snap.lifecycle === 'running' && state !== 'Running') {
        this.markAllPeersLost();
        this.set({ lifecycle: 'stopped' });
      }
      if (this.wantRunning && this.snap.lifecycle === 'stopped') {
        await this.start();
        return;
      }
      if (this.snap.lifecycle === 'running') {
        const bt = await protocol.isBluetoothEnabled();
        this.set({ bluetooth: bt ? 'on' : 'off' });
        await this.refreshLinks();
      }
    } catch (e) {
      log.warn(`reconcile failed: ${String(e)}`);
    }
  }

  async requestEnableBluetooth(): Promise<boolean> {
    const protocol = this.ensureProtocol();
    const on = await protocol.requestEnableBluetooth().catch(() => false);
    this.set({ bluetooth: on ? 'on' : 'off' });
    return on;
  }

  async setBattery(level: number, charging: boolean): Promise<void> {
    await this.protocol?.setBatteryState(Math.max(0, Math.min(100, Math.round(level))), charging);
  }

  // ---- SDK wiring ----------------------------------------------------------------------------

  /** Creates the instance and registers every listener synchronously, before any `start()`. */
  private ensureProtocol(): SdkProtocol {
    if (this.protocol) {
      return this.protocol;
    }
    const p = this.deps.sdk.createProtocol(buildProtocolConfig());
    this.protocol = p;
    p.on('identity_ready', e => this.set({ localAddress: e.address }));
    p.on('neighbor_discovered', e => {
      const now = this.deps.clock.now();
      const prev = this.snap.peers.find(x => x.address === e.peer_id);
      this.upsertPeer({
        address: e.peer_id,
        state: 'nearby',
        transport: e.transport,
        rssi: e.rssi ?? prev?.rssi ?? null,
        linked: prev?.linked ?? false,
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
        lostAt: null,
      });
      this.scheduleLinkRefresh();
    });
    p.on('neighbor_lost', e => {
      const prev = this.snap.peers.find(x => x.address === e.peer_id);
      if (prev && prev.state !== 'lost') {
        this.upsertPeer({ ...prev, state: 'lost', linked: false, lostAt: this.deps.clock.now() });
      }
      this.scheduleLinkRefresh();
    });
    p.on('mesh_stopped_by_user', () => {
      // One-shot and at-least-once: must be idempotent.
      this.wantRunning = false;
      this.markAllPeersLost();
      if (this.snap.lifecycle !== 'stoppedByUser') {
        this.set({ lifecycle: 'stoppedByUser', sdkState: 'Stopped', startedAt: null });
      }
    });
    p.on('diagnostic', e => {
      if (e.level === 'debug') {
        return;
      }
      const line: MeshDiagnosticLine = {
        at: this.deps.clock.now(),
        level: e.level,
        message: e.message,
      };
      this.set({ diagnostics: [line, ...this.snap.diagnostics].slice(0, MAX_DIAGNOSTICS) });
    });
    p.on('service_update_received', e =>
      this.updates.emit({
        subId: e.sub_id,
        serviceId: e.service_id,
        topic: e.topic,
        key: e.key,
        seq: e.seq,
        body: e.body,
        snapshot: e.snapshot,
        provider: e.provider_peer_id,
      }),
    );
    p.on('service_subscription_changed', e =>
      this.subChanges.emit({
        subId: e.sub_id,
        role: e.role,
        serviceId: e.service_id,
        topic: e.topic,
        peer: e.peer,
        state: e.state,
        reason: e.reason,
      }),
    );
    p.on('service_subscribe_received', e =>
      this.requests.emit({
        subId: e.sub_id,
        serviceId: e.service_id,
        topic: e.topic,
        mode: e.mode,
        sender: e.sender,
        params: e.params ?? '',
      }),
    );
    return p;
  }

  private async feedBattery(protocol: SdkProtocol): Promise<void> {
    const battery = this.deps.battery;
    if (!battery) {
      return;
    }
    const feed = (r: { level: number; charging: boolean }) =>
      void protocol
        .setBatteryState(Math.max(0, Math.min(100, Math.round(r.level))), r.charging)
        .catch(e => log.warn(`setBatteryState failed: ${String(e)}`));
    const first = await battery.read().catch(() => null);
    if (first) {
      feed(first);
    }
    this.batteryUnsub?.();
    this.batteryUnsub = battery.subscribe(feed);
  }

  private scheduleLinkRefresh(): void {
    if (this.linkTimer) {
      return;
    }
    this.linkTimer = setTimeout(() => {
      this.linkTimer = null;
      void this.refreshLinks();
    }, LINK_REFRESH_MS);
  }

  /** Which discovered peers have a live link, from `getTopology()` (a real SDK read, not inferred). */
  async refreshLinks(): Promise<void> {
    const protocol = this.protocol;
    if (!protocol || this.snap.lifecycle !== 'running') {
      return;
    }
    try {
      const [topology, count] = await Promise.all([
        protocol.getTopology(),
        protocol.getBLePeerCount().catch(() => null),
      ]);
      const me = this.snap.localAddress ?? topology.local_user_id;
      const linked = new Set<string>();
      for (const l of topology.links) {
        if (l.from === me) {
          linked.add(l.to);
        } else if (l.to === me) {
          linked.add(l.from);
        }
      }
      this.set({
        blePeerCount: count,
        peers: this.snap.peers.map(p => ({
          ...p,
          linked: p.state === 'nearby' && linked.has(p.address),
        })),
      });
    } catch (e) {
      log.warn(`topology refresh failed: ${String(e)}`);
    }
  }

  private buildServiceTransport(): ServiceTransport {
    const s = this.sdkServices;
    return {
      registerService: (id, version) => s.registerService(id, version),
      unregisterService: id => s.unregisterService(id),
      setPolicy: (id, policy) => s.setServiceSubscriptionPolicy(id, { kind: policy }),
      subscribe: (provider, serviceId, topic, mode, params) =>
        s.subscribeService(provider, serviceId, topic, mode, params ?? ''),
      unsubscribe: subId => s.unsubscribeService(subId),
      publish: async (serviceId, topic, body, key) => {
        const r = await s.publishServiceUpdate(serviceId, topic, body, key);
        const report: PublishReport = {
          subscribers: r.subscribers,
          sentLive: r.sentLive,
          queued: r.queued,
          coalesced: r.coalesced,
          failed: r.failed,
        };
        return report;
      },
      acceptSubscriber: subId => s.acceptServiceSubscription(subId),
      rejectSubscriber: (subId, reason) => s.rejectServiceSubscription(subId, reason),
      endSubscriber: (subId, reason) => s.endServiceSubscription(subId, reason),
      listSubscriptions: async () => {
        const list = await s.serviceSubscriptions();
        return list.map<SubscriptionInfo>(i => ({
          subId: i.subId,
          provider: i.provider,
          serviceId: i.serviceId,
          topic: i.topic,
          mode: i.mode,
          state: i.state,
        }));
      },
      onUpdate: h => this.updates.subscribe(h),
      onSubscriptionChanged: h => this.subChanges.subscribe(h),
      onSubscribeRequest: h => this.requests.subscribe(h),
      onStarted: h => this.started.subscribe(h),
    };
  }

  // ---- state helpers -------------------------------------------------------------------------

  private failStart(
    error: ReturnType<typeof appError>,
    lifecycle: 'stopped' | 'error',
  ): Result<void> {
    this.wantRunning = false;
    this.set({ lifecycle, lastError: error });
    return err(error);
  }

  private upsertPeer(peer: Peer): void {
    const others = this.snap.peers.filter(p => p.address !== peer.address);
    this.set({ peers: sortPeers([...others, peer]) });
  }

  private markAllPeersLost(): void {
    const now = this.deps.clock.now();
    if (this.snap.peers.some(p => p.state === 'nearby')) {
      this.set({
        peers: this.snap.peers.map(p =>
          p.state === 'nearby' ? { ...p, state: 'lost', linked: false, lostAt: now } : p,
        ),
      });
    }
  }

  private set(patch: Partial<MeshSnapshot>): void {
    const next = { ...this.snap, ...patch };
    if (patch.peers) {
      next.peers = trimLost(patch.peers);
    }
    this.snap = next;
    this.changes.emit();
  }
}

function sortPeers(peers: Peer[]): Peer[] {
  return [...peers].sort((a, b) =>
    a.state === b.state ? b.lastSeenAt - a.lastSeenAt : a.state === 'nearby' ? -1 : 1,
  );
}

function trimLost(peers: Peer[]): Peer[] {
  const lost = peers.filter(p => p.state === 'lost');
  if (lost.length <= MAX_LOST_PEERS) {
    return peers;
  }
  const drop = new Set(
    [...lost]
      .sort((a, b) => (a.lostAt ?? 0) - (b.lostAt ?? 0))
      .slice(0, lost.length - MAX_LOST_PEERS)
      .map(p => p.address),
  );
  return peers.filter(p => !drop.has(p.address));
}
