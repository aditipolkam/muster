import { SdkMeshAdapter, buildProtocolConfig } from '../src/mesh/SdkMeshAdapter';
import type { PermissionsPort } from '../src/mesh/permissions';
import type { BatteryPort, BatteryReading, PermissionStatus } from '../src/mesh/types';
import { Emitter } from '../src/shared/emitter';
import { FakeSdk } from '../src/testing/FakeSdk';
import { ManualClock } from '../src/testing/services';

function perms(initial: PermissionStatus, afterRequest: PermissionStatus = initial) {
  const calls: string[] = [];
  const port: PermissionsPort = {
    check: async () => {
      calls.push('check');
      return initial;
    },
    request: async () => {
      calls.push('request');
      return afterRequest;
    },
  };
  return { port, calls };
}

function battery(first: BatteryReading | null) {
  const changes = new Emitter<BatteryReading>();
  const port: BatteryPort = { read: async () => first, subscribe: fn => changes.subscribe(fn) };
  return { port, changes };
}

function make(
  over: Partial<{
    platform: 'ios' | 'android';
    permissions: PermissionsPort;
    battery: BatteryPort;
  }> = {},
) {
  const sdk = new FakeSdk();
  const clock = new ManualClock();
  const adapter = new SdkMeshAdapter({
    sdk,
    clock,
    platform: over.platform ?? 'android',
    permissions: over.permissions ?? perms('granted').port,
    battery: over.battery,
  });
  return { sdk, clock, adapter };
}

const flush = () => new Promise(r => setImmediate(r));

describe('SdkMeshAdapter lifecycle', () => {
  it('registers every listener before start() (SDK contract)', async () => {
    const { sdk, adapter } = make();
    expect((await adapter.start()).ok).toBe(true);
    const startAt = sdk.calls.indexOf('start');
    const listens = sdk.calls.filter(c => c.startsWith('on:'));
    expect(startAt).toBeGreaterThan(-1);
    expect(listens.length).toBeGreaterThanOrEqual(8);
    expect(sdk.calls.lastIndexOf(listens[listens.length - 1]!)).toBeLessThan(startAt);
    expect(listens).toEqual(
      expect.arrayContaining([
        'on:neighbor_discovered',
        'on:neighbor_lost',
        'on:mesh_stopped_by_user',
        'on:service_update_received',
        'on:service_subscription_changed',
        'on:service_subscribe_received',
      ]),
    );
  });

  it('uses the documented config: BLE on, internet off, no Wi-Fi Direct in Phase 2', () => {
    const c = buildProtocolConfig();
    expect(c.appId).toBe('app.trailmesh');
    expect(c.transports?.ble?.enabled).toBe(true);
    expect(c.transports?.internet?.enabled).toBe(false);
    expect(c.transports?.wifiDirect?.enabled).toBe(false);
  });

  it('starts, reads the address and SDK state, and is idempotent while running', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    await adapter.start();
    const s = adapter.getSnapshot();
    expect(s).toMatchObject({
      lifecycle: 'running',
      localAddress: 'off1localaddress',
      sdkState: 'Running',
      bluetooth: 'on',
    });
    expect(sdk.calls.filter(c => c === 'start')).toHaveLength(1);
    expect(sdk.createdProtocols).toBe(1);
  });

  it('shares one start between concurrent callers', async () => {
    const { sdk, adapter } = make();
    await Promise.all([adapter.start(), adapter.start(), adapter.start()]);
    expect(sdk.calls.filter(c => c === 'start')).toHaveLength(1);
  });

  it('notifies subscribers on each state change and not after unsubscribe', async () => {
    const { adapter } = make();
    const seen: string[] = [];
    const off = adapter.subscribe(() => seen.push(adapter.getSnapshot().lifecycle));
    await adapter.start();
    expect(seen).toEqual(expect.arrayContaining(['starting', 'running']));
    off();
    const n = seen.length;
    await adapter.stop();
    expect(seen).toHaveLength(n);
  });

  describe('permissions and Bluetooth', () => {
    it('does not start when Android permissions are denied', async () => {
      const p = perms('denied', 'denied');
      const { sdk, adapter } = make({ permissions: p.port });
      const r = await adapter.start();
      expect(!r.ok && r.error.code).toBe('mesh.permission_denied');
      expect(adapter.getSnapshot()).toMatchObject({ lifecycle: 'stopped', permissions: 'denied' });
      expect(p.calls).toEqual(['check', 'request']);
      expect(sdk.calls).not.toContain('start');
    });

    it('explains a permanently blocked permission', async () => {
      const { adapter } = make({ permissions: perms('denied', 'blocked').port });
      const r = await adapter.start();
      expect(!r.ok && r.error.userMessage).toMatch(/settings/i);
      expect(adapter.getSnapshot().permissions).toBe('blocked');
    });

    it('prompts only when the check does not already pass', async () => {
      const p = perms('granted');
      const { adapter } = make({ permissions: p.port });
      await adapter.start();
      expect(p.calls).toEqual(['check']);
    });

    it('iOS never prompts from JS and still starts (the OS prompts when BLE starts)', async () => {
      const p = perms('unknown');
      const { sdk, adapter } = make({ platform: 'ios', permissions: p.port });
      expect((await adapter.start()).ok).toBe(true);
      expect(p.calls).toEqual(['check']);
      expect(sdk.calls).toContain('start');
    });

    it('Android: asks to enable Bluetooth and starts when the user agrees', async () => {
      const { sdk, adapter } = make();
      sdk.bluetooth = false;
      sdk.enableBluetoothResult = true;
      expect((await adapter.start()).ok).toBe(true);
      expect(sdk.calls).toContain('requestEnableBluetooth');
      expect(adapter.getSnapshot().bluetooth).toBe('on');
    });

    it('Android: stays stopped with a clear error when Bluetooth stays off', async () => {
      const { sdk, adapter } = make();
      sdk.bluetooth = false;
      const r = await adapter.start();
      expect(!r.ok && r.error.code).toBe('mesh.bluetooth_off');
      expect(adapter.getSnapshot()).toMatchObject({ lifecycle: 'stopped', bluetooth: 'off' });
      expect(sdk.calls).not.toContain('start');
    });

    it('iOS: a Bluetooth-off reading does not block start (cannot enable it from JS)', async () => {
      const { sdk, adapter } = make({ platform: 'ios' });
      sdk.bluetooth = false;
      expect((await adapter.start()).ok).toBe(true);
      expect(sdk.calls).not.toContain('requestEnableBluetooth');
    });
  });

  describe('errors', () => {
    it('surfaces a failed start as a retryable error and lets the user try again', async () => {
      const { sdk, adapter } = make();
      sdk.startError = new Error('ble init failed');
      const r = await adapter.start();
      expect(!r.ok && r.error).toMatchObject({ code: 'mesh.start_failed', retryable: true });
      expect(adapter.getSnapshot()).toMatchObject({ lifecycle: 'error' });
      expect(adapter.getSnapshot().lastError?.message).toContain('ble init failed');

      sdk.startError = null;
      expect((await adapter.start()).ok).toBe(true);
      expect(adapter.getSnapshot()).toMatchObject({ lifecycle: 'running', lastError: null });
      expect(sdk.createdProtocols).toBe(1); // same instance, listeners kept
    });

    it('a failed stop is reported, not swallowed', async () => {
      const { sdk, adapter } = make();
      await adapter.start();
      const p = (adapter as any).protocol;
      p.stop = async () => {
        throw new Error('stop failed');
      };
      const r = await adapter.stop();
      expect(!r.ok && r.error.code).toBe('mesh.stop_failed');
      expect(adapter.getSnapshot().lifecycle).toBe('error');
      expect(sdk.state).toBe('Running');
    });
  });

  describe('stop, destroy and stop-by-user', () => {
    it('stop() keeps the instance and the listeners so start() works again', async () => {
      const { sdk, adapter } = make();
      await adapter.start();
      await adapter.stop();
      expect(adapter.getSnapshot()).toMatchObject({ lifecycle: 'stopped', sdkState: 'Stopped' });
      await adapter.start();
      expect(sdk.createdProtocols).toBe(1);
      expect(adapter.getSnapshot().lifecycle).toBe('running');
    });

    it('stop() when not running is a no-op', async () => {
      const { sdk, adapter } = make();
      expect((await adapter.stop()).ok).toBe(true);
      expect(sdk.calls).not.toContain('stop');
    });

    it('destroy() then start() builds a NEW instance and never reuses the destroyed one', async () => {
      const { sdk, adapter } = make();
      await adapter.start();
      await adapter.destroy();
      expect(sdk.destroyed).toBe(1);
      expect(adapter.getSnapshot().lifecycle).toBe('idle');
      await adapter.start();
      expect(sdk.createdProtocols).toBe(2);
      // listeners were registered again on the new instance, before its start()
      const lastStart = sdk.calls.lastIndexOf('start');
      expect(
        sdk.calls.slice(sdk.calls.indexOf('destroy'), lastStart).filter(c => c.startsWith('on:'))
          .length,
      ).toBeGreaterThanOrEqual(8);
    });

    it('mesh_stopped_by_user is idempotent and prevents an automatic restart', async () => {
      const { sdk, adapter } = make();
      await adapter.start();
      sdk.emit('mesh_stopped_by_user');
      sdk.emit('mesh_stopped_by_user'); // at-least-once delivery
      expect(adapter.getSnapshot().lifecycle).toBe('stoppedByUser');
      sdk.state = 'Stopped';
      await adapter.reconcile();
      expect(adapter.getSnapshot().lifecycle).toBe('stoppedByUser');
      expect(sdk.calls.filter(c => c === 'start')).toHaveLength(1);
      // an explicit user start works
      expect((await adapter.start()).ok).toBe(true);
      expect(adapter.getSnapshot().lifecycle).toBe('running');
    });

    it('reconcile() restarts a mesh that should be running but the OS stopped', async () => {
      const { sdk, adapter } = make();
      await adapter.start();
      sdk.state = 'Stopped';
      await adapter.reconcile();
      expect(sdk.calls.filter(c => c === 'start')).toHaveLength(2);
      expect(adapter.getSnapshot()).toMatchObject({ lifecycle: 'running', sdkState: 'Running' });
    });

    it('reconcile() does not restart after the user stopped it', async () => {
      const { sdk, adapter } = make();
      await adapter.start();
      await adapter.stop();
      await adapter.reconcile();
      expect(sdk.calls.filter(c => c === 'start')).toHaveLength(1);
      expect(adapter.getSnapshot().lifecycle).toBe('stopped');
    });

    it('reconcile() refreshes Bluetooth state while running', async () => {
      const { sdk, adapter } = make();
      await adapter.start();
      sdk.bluetooth = false;
      await adapter.reconcile();
      expect(adapter.getSnapshot().bluetooth).toBe('off');
    });
  });
});

describe('peers', () => {
  it('lists discovered peers with transport and RSSI, and keeps first-seen time', async () => {
    const { sdk, clock, adapter } = make();
    await adapter.start();
    sdk.emit('neighbor_discovered', { peer_id: 'off1peerA', transport: 'BLE', rssi: -70 });
    clock.advance(5000);
    sdk.emit('neighbor_discovered', { peer_id: 'off1peerA', transport: 'BLE', rssi: -55 });
    const [p] = adapter.getSnapshot().peers;
    expect(p).toMatchObject({
      address: 'off1peerA',
      state: 'nearby',
      transport: 'BLE',
      rssi: -55,
      linked: false,
    });
    expect(p!.lastSeenAt - p!.firstSeenAt).toBe(5000);
    expect(adapter.getSnapshot().peers).toHaveLength(1);
  });

  it('marks a peer lost on neighbor_lost and back to nearby on rediscovery', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    sdk.emit('neighbor_discovered', { peer_id: 'off1peerA', transport: 'BLE' });
    sdk.emit('neighbor_lost', { peer_id: 'off1peerA' });
    expect(adapter.getSnapshot().peers[0]).toMatchObject({
      state: 'lost',
      lostAt: expect.any(Number),
    });
    sdk.emit('neighbor_discovered', { peer_id: 'off1peerA', transport: 'BLE', rssi: -80 });
    expect(adapter.getSnapshot().peers[0]).toMatchObject({ state: 'nearby', lostAt: null });
  });

  it('ignores a loss for a peer it never saw', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    sdk.emit('neighbor_lost', { peer_id: 'off1ghost' });
    expect(adapter.getSnapshot().peers).toEqual([]);
  });

  it('shows a peer as connected only when the SDK topology has a link to it', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    sdk.emit('neighbor_discovered', { peer_id: 'off1peerA', transport: 'BLE' });
    sdk.emit('neighbor_discovered', { peer_id: 'off1peerB', transport: 'BLE' });
    sdk.links = [{ from: 'off1localaddress', to: 'off1peerA' }];
    await adapter.refreshLinks();
    const by = Object.fromEntries(adapter.getSnapshot().peers.map(p => [p.address, p.linked]));
    expect(by).toEqual({ off1peerA: true, off1peerB: false });
    expect(adapter.getSnapshot().blePeerCount).toBe(1);

    sdk.links = [];
    await adapter.refreshLinks();
    expect(adapter.getSnapshot().peers.every(p => !p.linked)).toBe(true);
  });

  it('marks every peer lost when the mesh stops, rather than showing stale neighbours', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    sdk.emit('neighbor_discovered', { peer_id: 'off1peerA', transport: 'BLE' });
    await adapter.stop();
    expect(adapter.getSnapshot().peers[0]?.state).toBe('lost');
  });

  it('bounds the number of remembered lost peers', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    for (let i = 0; i < 80; i++) {
      sdk.emit('neighbor_discovered', { peer_id: `off1p${i}`, transport: 'BLE' });
      sdk.emit('neighbor_lost', { peer_id: `off1p${i}` });
    }
    expect(adapter.getSnapshot().peers.length).toBeLessThanOrEqual(50);
  });

  it('keeps warning and error diagnostics, drops debug', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    sdk.emit('diagnostic', { level: 'debug', message: 'noise' });
    sdk.emit('diagnostic', { level: 'warning', message: 'native_event_gap' });
    expect(adapter.getSnapshot().diagnostics.map(d => d.message)).toEqual(['native_event_gap']);
  });
});

describe('battery feed (AC7)', () => {
  it('sends the level on start and on every change, clamped to 0..100', async () => {
    const b = battery({ level: 63.4, charging: true });
    const { sdk, adapter } = make({ battery: b.port });
    await adapter.start();
    expect(sdk.batteryCalls).toEqual([[63, true]]);
    b.changes.emit({ level: 12, charging: false });
    b.changes.emit({ level: 140, charging: false });
    await flush();
    expect(sdk.batteryCalls).toEqual([
      [63, true],
      [12, false],
      [100, false],
    ]);
  });

  it('does not send anything when the platform cannot read the battery', async () => {
    const { sdk, adapter } = make({ battery: battery(null).port });
    await adapter.start();
    expect(sdk.batteryCalls).toEqual([]);
  });

  it('stops listening to battery changes after destroy', async () => {
    const b = battery({ level: 50, charging: false });
    const { sdk, adapter } = make({ battery: b.port });
    await adapter.start();
    await adapter.destroy();
    expect(b.changes.size).toBe(0);
    b.changes.emit({ level: 10, charging: false });
    await flush();
    expect(sdk.batteryCalls).toEqual([[50, false]]);
  });
});

describe('AC8: telemetry is never enabled', () => {
  it('a full start / peers / publish / stop cycle never touches enableTelemetry', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    await adapter.services.registerService('tm.live.1.diag', '1');
    await adapter.services.publish('tm.live.1.diag', 'tm/1/diag/event', '{}');
    await adapter.stop();
    await adapter.destroy();
    expect(sdk.telemetryCalls).toBe(0);
    expect(sdk.calls.some(c => /telemetry/i.test(c))).toBe(false);
  });
});

describe('ServiceTransport mapping to the SDK', () => {
  it('forwards register / policy / subscribe / publish / unsubscribe with the SDK argument shapes', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    const s = adapter.services;
    await s.registerService('svc', '1');
    await s.setPolicy('svc', 'accept_all');
    const subId = await s.subscribe('off1peer', 'svc', 'tm/1/diag/*', 'log');
    const report = await s.publish('svc', 'tm/1/diag/event', '{"x":1}', 'k');
    await s.unsubscribe(subId);
    expect(sdk.calls).toEqual(
      expect.arrayContaining(['registerService:svc:1', 'setPolicy:svc:accept_all']),
    );
    expect(sdk.published[0]).toEqual({
      serviceId: 'svc',
      topic: 'tm/1/diag/event',
      body: '{"x":1}',
      key: 'k',
    });
    expect(report).toEqual({ subscribers: 1, sentLive: 1, queued: 0, coalesced: 0, failed: 0 });
    expect(sdk.unsubscribed).toEqual([subId]);
  });

  it('translates SDK events into transport callbacks', async () => {
    const { sdk, adapter } = make();
    await adapter.start();
    const updates: unknown[] = [];
    const changes: unknown[] = [];
    const requests: unknown[] = [];
    adapter.services.onUpdate(u => updates.push(u));
    adapter.services.onSubscriptionChanged(c => changes.push(c));
    adapter.services.onSubscribeRequest(r => requests.push(r));
    sdk.emit('service_update_received', {
      sub_id: 's1',
      service_id: 'svc',
      topic: 't',
      key: null,
      seq: 3,
      body: 'b',
      snapshot: true,
      provider_peer_id: 'off1p',
    });
    sdk.emit('service_subscription_changed', {
      sub_id: 's1',
      role: 'consumer',
      service_id: 'svc',
      topic: 't',
      peer: 'off1p',
      state: 'active',
      reason: 'accepted',
    });
    sdk.emit('service_subscribe_received', {
      sub_id: 's2',
      service_id: 'svc',
      topic: 't',
      mode: 'log',
      params: '',
      sender: 'off1q',
      renewal: false,
    });
    expect(updates).toEqual([
      {
        subId: 's1',
        serviceId: 'svc',
        topic: 't',
        key: null,
        seq: 3,
        body: 'b',
        snapshot: true,
        provider: 'off1p',
      },
    ]);
    expect(changes).toEqual([
      {
        subId: 's1',
        role: 'consumer',
        serviceId: 'svc',
        topic: 't',
        peer: 'off1p',
        state: 'active',
        reason: 'accepted',
      },
    ]);
    expect(requests).toEqual([
      { subId: 's2', serviceId: 'svc', topic: 't', mode: 'log', sender: 'off1q' },
    ]);
  });

  it('announces started() after every successful start so pub/sub can re-register', async () => {
    const { adapter } = make();
    const started = jest.fn();
    adapter.services.onStarted(started);
    await adapter.start();
    await adapter.stop();
    await adapter.start();
    expect(started).toHaveBeenCalledTimes(2);
  });
});
