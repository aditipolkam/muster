import { Emitter, Unsubscribe } from '../shared/emitter';
import { ok, Result } from '../shared/result';
import type {
  MeshPort,
  MeshSnapshot,
  Peer,
  PublishReport,
  ServiceTransport,
  SubscribeRequest,
  SubscriptionInfo,
  SubscriptionMode,
  SubscriptionPolicy,
} from '../mesh/types';

/**
 * In-memory "radio" shared by FakeMesh nodes. TEST DOUBLE ONLY: it proves our logic, not
 * Bluetooth. Never wire it into the app; real connectivity is only claimed from physical devices.
 */
export class FakeNetwork {
  nodes = new Map<string, FakeMesh>();
  /** Drop a fraction of live deliveries (0..1) to exercise loss. */
  lossRate = 0;
  /** Deliver every update twice, as the SDK may on resync. */
  duplicate = false;
}

type Sub = {
  subId: string;
  subscriber: string;
  provider: string;
  serviceId: string;
  topic: string;
  mode: SubscriptionMode;
  state: 'pending' | 'active' | 'ended';
};

export class FakeMesh implements MeshPort {
  readonly services: ServiceTransport;
  private snap: MeshSnapshot;
  private readonly changes = new Emitter<void>();
  private readonly updates = new Emitter<
    Parameters<Parameters<ServiceTransport['onUpdate']>[0]>[0]
  >();
  private readonly subChanges = new Emitter<
    Parameters<Parameters<ServiceTransport['onSubscriptionChanged']>[0]>[0]
  >();
  private readonly requests = new Emitter<SubscribeRequest>();
  private readonly started = new Emitter<void>();
  private registered = new Map<string, SubscriptionPolicy>();
  /** Subscriptions where this node is the consumer / provider. */
  mine = new Map<string, Sub>();
  held = new Map<string, Sub>();
  private counter = 0;
  startFails = false;

  constructor(readonly address: string, private readonly net: FakeNetwork) {
    net.nodes.set(address, this);
    this.snap = {
      lifecycle: 'idle',
      sdkState: null,
      bluetooth: 'on',
      permissions: 'granted',
      localAddress: address,
      blePeerCount: 0,
      peers: [],
      lastError: null,
      startedAt: null,
      diagnostics: [],
    };
    this.services = this.build();
  }

  getSnapshot = () => this.snap;
  subscribe = (l: () => void): Unsubscribe => this.changes.subscribe(l);

  async start(): Promise<Result<void>> {
    if (this.startFails) {
      this.set({ lifecycle: 'error' });
      return {
        ok: false,
        error: { code: 'mesh.start_failed', message: 'x', userMessage: 'x', retryable: true },
      };
    }
    this.set({ lifecycle: 'running', startedAt: 1 });
    this.started.emit();
    return ok(undefined);
  }
  async stop(): Promise<Result<void>> {
    this.set({ lifecycle: 'stopped' });
    return ok(undefined);
  }
  async destroy(): Promise<void> {
    this.set({ lifecycle: 'idle' });
  }
  async reconcile(): Promise<void> {}
  async requestEnableBluetooth(): Promise<boolean> {
    return true;
  }
  async setBattery(): Promise<void> {}

  simulatePeer(address: string, patch: Partial<Peer> = {}): void {
    const p: Peer = {
      address,
      state: 'nearby',
      transport: 'BLE',
      rssi: -60,
      linked: false,
      firstSeenAt: 1,
      lastSeenAt: 1,
      lostAt: null,
      ...patch,
    };
    this.set({ peers: [...this.snap.peers.filter(x => x.address !== address), p] });
  }

  /**
   * The SDK's approval timeout (`approval_timeout_ms`, 60 s under `restricted`): every request
   * this provider was asked about and has not answered is rejected.
   */
  expireUnanswered(): void {
    for (const [subId, sub] of this.held) {
      if (sub.state === 'pending') {
        this.held.delete(subId);
        this.end(sub, 'approval_timeout');
      }
    }
  }

  /** Simulates a restart of the SDK: subscriptions/registrations are gone, listeners are told. */
  simulateRestart(): void {
    this.registered.clear();
    this.mine.clear();
    this.held.clear();
    this.started.emit();
  }

  private set(patch: Partial<MeshSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.changes.emit();
  }

  private build(): ServiceTransport {
    return {
      registerService: async id => {
        this.registered.set(id, 'restricted');
      },
      unregisterService: async id => {
        const had = this.registered.delete(id);
        for (const [k, s] of this.held) {
          if (s.serviceId === id) {
            this.held.delete(k);
          }
        }
        return had;
      },
      setPolicy: async (id, policy) => {
        this.registered.set(id, policy);
      },
      subscribe: async (provider, serviceId, topic, mode, params = '') => {
        const subId = `${this.address}-sub-${++this.counter}`;
        const sub: Sub = {
          subId,
          subscriber: this.address,
          provider,
          serviceId,
          topic,
          mode,
          state: 'pending',
        };
        this.mine.set(subId, sub);
        const prov = this.net.nodes.get(provider);
        if (!prov || !prov.registered.has(serviceId)) {
          return subId;
        }
        prov.held.set(subId, sub);
        if (prov.registered.get(serviceId) === 'accept_all') {
          this.activate(sub);
        } else {
          prov.requests.emit({ subId, serviceId, topic, mode, sender: this.address, params });
        }
        return subId;
      },
      unsubscribe: async subId => {
        const sub = this.mine.get(subId);
        this.mine.delete(subId);
        const prov = this.net.nodes.get(sub?.provider ?? '');
        if (sub && prov?.held.delete(subId)) {
          // The SDK tells the provider its follower left.
          prov.subChanges.emit({
            subId,
            role: 'provider',
            serviceId: sub.serviceId,
            topic: sub.topic,
            peer: sub.subscriber,
            state: 'ended',
            reason: 'unsubscribed',
          });
        }
        return !!sub;
      },
      publish: async (serviceId, topic, body, key) => {
        const report: PublishReport = {
          subscribers: 0,
          sentLive: 0,
          queued: 0,
          coalesced: 0,
          failed: 0,
        };
        for (const sub of this.held.values()) {
          if (sub.serviceId !== serviceId || sub.state !== 'active') {
            continue;
          }
          const covers = sub.topic.endsWith('*')
            ? topic.startsWith(sub.topic.slice(0, -1))
            : sub.topic === topic;
          if (!covers || (sub.mode === 'latest') !== (key !== undefined)) {
            continue;
          }
          report.subscribers++;
          if (Math.random() < this.net.lossRate) {
            report.failed++;
            continue;
          }
          const target = this.net.nodes.get(sub.subscriber);
          const deliver = () =>
            target?.updates.emit({
              subId: sub.subId,
              serviceId,
              topic,
              key: key ?? null,
              seq: ++this.counter,
              body,
              snapshot: false,
              provider: this.address,
            });
          deliver();
          if (this.net.duplicate) {
            deliver();
          }
          report.sentLive++;
        }
        return report;
      },
      acceptSubscriber: async subId => {
        const sub = this.held.get(subId);
        if (!sub || sub.state === 'ended') {
          // The real SDK refuses a request it no longer holds (answered, timed out, withdrawn).
          throw new Error(`no subscription awaiting an answer: ${subId}`);
        }
        this.net.nodes.get(sub.subscriber)?.activate(sub);
      },
      rejectSubscriber: async subId => {
        const sub = this.held.get(subId);
        this.held.delete(subId);
        if (sub) {
          this.end(sub, 'rejected');
        }
      },
      endSubscriber: async subId => {
        const sub = this.held.get(subId);
        this.held.delete(subId);
        if (sub) {
          this.end(sub, 'revoked');
        }
      },
      listSubscriptions: async () =>
        [...this.mine.values()].map<SubscriptionInfo>(s => ({
          subId: s.subId,
          provider: s.provider,
          serviceId: s.serviceId,
          topic: s.topic,
          mode: s.mode,
          state: s.state,
        })),
      onUpdate: h => this.updates.subscribe(h),
      onSubscriptionChanged: h => this.subChanges.subscribe(h),
      onSubscribeRequest: h => this.requests.subscribe(h),
      onStarted: h => this.started.subscribe(h),
    };
  }

  /** The SDK reports a subscription ending to both sides (`service_subscription_changed`). */
  private end(sub: Sub, reason: string): void {
    sub.state = 'ended';
    const consumer = this.net.nodes.get(sub.subscriber);
    consumer?.subChanges.emit({
      subId: sub.subId,
      role: 'consumer',
      serviceId: sub.serviceId,
      topic: sub.topic,
      peer: sub.provider,
      state: 'ended',
      reason,
    });
    this.subChanges.emit({
      subId: sub.subId,
      role: 'provider',
      serviceId: sub.serviceId,
      topic: sub.topic,
      peer: sub.subscriber,
      state: 'ended',
      reason,
    });
  }

  private activate(sub: Sub): void {
    sub.state = 'active';
    // The SDK reports the change on both sides: the provider learns its follower is live.
    this.net.nodes.get(sub.provider)?.subChanges.emit({
      subId: sub.subId,
      role: 'provider',
      serviceId: sub.serviceId,
      topic: sub.topic,
      peer: sub.subscriber,
      state: 'active',
      reason: 'accepted',
    });
    this.subChanges.emit({
      subId: sub.subId,
      role: 'consumer',
      serviceId: sub.serviceId,
      topic: sub.topic,
      peer: sub.provider,
      state: 'active',
      reason: 'accepted',
    });
  }

  get listenerCounts() {
    return {
      updates: this.updates.size,
      changes: this.subChanges.size,
      requests: this.requests.size,
      started: this.started.size,
    };
  }
}
