import type { SdkFactory, SdkProtocol, SdkServices } from '../mesh/sdk';

type Listener = (e: any) => void;

/** Scriptable stand-in for the SDK module. Records every call so tests can assert ordering. */
export class FakeSdk implements SdkFactory {
  calls: string[] = [];
  listeners = new Map<string, Listener[]>();
  state: 'Stopped' | 'Running' | 'Paused' = 'Stopped';
  bluetooth = true;
  enableBluetoothResult = false;
  address = 'off1localaddress';
  links: { from: string; to: string }[] = [];
  startError: Error | null = null;
  createdProtocols = 0;
  destroyed = 0;
  batteryCalls: [number, boolean][] = [];
  telemetryCalls = 0;
  subscribeCounter = 0;
  published: { serviceId: string; topic: string; body: string; key?: string }[] = [];
  publishReport = { subscribers: 1, sentLive: 1, queued: 0, coalesced: 0, failed: 0 };
  subscriptions: {
    subId: string;
    provider: string;
    serviceId: string;
    topic: string;
    mode: 'latest' | 'log';
  }[] = [];
  unsubscribed: string[] = [];

  emit(type: string, e: unknown = {}): void {
    for (const l of this.listeners.get(type) ?? []) {
      l(e);
    }
  }

  createProtocol(): SdkProtocol {
    this.createdProtocols++;
    const self = this;
    const p = {
      on(type: string, l: Listener) {
        self.calls.push(`on:${type}`);
        self.listeners.set(type, [...(self.listeners.get(type) ?? []), l]);
        return p;
      },
      async start() {
        self.calls.push('start');
        if (self.startError) {
          throw self.startError;
        }
        self.state = 'Running';
      },
      async stop() {
        self.calls.push('stop');
        self.state = 'Stopped';
      },
      async destroy() {
        self.calls.push('destroy');
        self.destroyed++;
        self.listeners.clear();
      },
      async getState() {
        return self.state;
      },
      async localAddress() {
        return self.address;
      },
      async isBluetoothEnabled() {
        return self.bluetooth;
      },
      async requestEnableBluetooth() {
        self.calls.push('requestEnableBluetooth');
        self.bluetooth = self.enableBluetoothResult;
        return self.enableBluetoothResult;
      },
      async getTopology() {
        return {
          timestamp: 0,
          local_user_id: self.address,
          nodes: [],
          links: self.links.map(l => ({ ...l, quality: 1, transport: 'BLE' })),
          stats: {
            total_nodes: 0,
            relay_nodes: 0,
            total_connections: self.links.length,
            avg_link_quality: 1,
          },
        };
      },
      async getBLePeerCount() {
        return self.links.length;
      },
      async setBatteryState(level: number, charging: boolean) {
        self.batteryCalls.push([level, charging]);
      },
      // Never part of the real surface we use: if any code reaches for it, the telemetry test fails.
      enableTelemetry() {
        self.telemetryCalls++;
      },
    };
    return p as unknown as SdkProtocol;
  }

  createServices(): SdkServices {
    const self = this;
    const s = {
      async registerService(id: string, v: string) {
        self.calls.push(`registerService:${id}:${v}`);
      },
      async unregisterService(id: string) {
        self.calls.push(`unregisterService:${id}`);
        return true;
      },
      async setServiceSubscriptionPolicy(id: string, policy: { kind: string }) {
        self.calls.push(`setPolicy:${id}:${policy.kind}`);
      },
      async subscribeService(
        provider: string,
        serviceId: string,
        topic: string,
        mode: 'latest' | 'log',
      ) {
        const subId = `sub-${++self.subscribeCounter}`;
        self.subscriptions.push({ subId, provider, serviceId, topic, mode });
        self.calls.push(`subscribe:${subId}`);
        return subId;
      },
      async unsubscribeService(subId: string) {
        self.unsubscribed.push(subId);
        self.subscriptions = self.subscriptions.filter(x => x.subId !== subId);
        return true;
      },
      async publishServiceUpdate(serviceId: string, topic: string, body: string, key?: string) {
        self.published.push({ serviceId, topic, body, key });
        return self.publishReport;
      },
      async acceptServiceSubscription(subId: string) {
        self.calls.push(`accept:${subId}`);
      },
      async rejectServiceSubscription(subId: string) {
        self.calls.push(`reject:${subId}`);
      },
      async endServiceSubscription(subId: string) {
        self.calls.push(`end:${subId}`);
      },
      async serviceSubscriptions() {
        return self.subscriptions.map(x => ({
          ...x,
          state: 'active' as const,
          keys: [],
          topics: [x.topic],
        }));
      },
    };
    return s as unknown as SdkServices;
  }
}
