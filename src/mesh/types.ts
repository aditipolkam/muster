import type { Unsubscribe } from '../shared/emitter';
import type { AppError, Result } from '../shared/result';

/** `ProtocolState` as the SDK reports it (`getState()`), plus states only the app can know. */
export type MeshLifecycle =
  | 'idle' // adapter constructed, SDK not created yet
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'stoppedByUser' // Android: user tapped Stop on the foreground-service notification
  | 'error';

/** The SDK only exposes a boolean (`isBluetoothEnabled`); iOS authorisation cannot be queried. */
export type BluetoothStatus = 'unknown' | 'on' | 'off';

export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'blocked';

export type PeerState = 'nearby' | 'lost';

export type Peer = {
  /** Canonical `off1…` address, as reported by `neighbor_discovered`. */
  address: string;
  state: PeerState;
  transport: string;
  rssi: number | null;
  /** True when `getTopology()` shows a link between this device and the peer (a live connection, not just an advertisement). */
  linked: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  lostAt: number | null;
};

export type MeshDiagnosticLine = {
  at: number;
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
};

export type MeshSnapshot = {
  lifecycle: MeshLifecycle;
  /** Raw `getState()` of the SDK at the last reconcile, or null when never read. */
  sdkState: string | null;
  bluetooth: BluetoothStatus;
  permissions: PermissionStatus;
  localAddress: string | null;
  /** `getBLePeerCount()` at the last refresh; null when unavailable. */
  blePeerCount: number | null;
  peers: Peer[];
  lastError: AppError | null;
  startedAt: number | null;
  /** Native event-gap / replay diagnostics seen, by SDK message. */
  diagnostics: MeshDiagnosticLine[];
};

export type PublishReport = {
  subscribers: number;
  sentLive: number;
  queued: number;
  coalesced: number;
  failed: number;
};

export type SubscriptionMode = 'latest' | 'log';

export type SubscriptionState = 'pending' | 'active' | 'paused' | 'ended';

export type SubscriptionInfo = {
  subId: string;
  provider: string;
  serviceId: string;
  topic: string;
  mode: SubscriptionMode;
  state: SubscriptionState;
};

export type SubscriptionPolicy = 'restricted' | 'accept_all';

export type ServiceUpdate = {
  subId: string;
  serviceId: string;
  topic: string;
  key: string | null;
  seq: number;
  body: string;
  snapshot: boolean;
  provider: string;
};

export type SubscriptionChange = {
  subId: string;
  role: 'consumer' | 'provider';
  serviceId: string;
  topic: string;
  peer: string;
  state: SubscriptionState;
  reason: string;
};

export type SubscribeRequest = {
  subId: string;
  serviceId: string;
  topic: string;
  mode: SubscriptionMode;
  sender: string;
};

/**
 * The subset of the SDK's service-subscription API (ADR 0035) that the pub/sub layer needs.
 * Every method maps 1:1 to `MeshServices` in `bindings/react-native/src/index.ts`.
 */
export interface ServiceTransport {
  registerService(serviceId: string, version: string): Promise<void>;
  unregisterService(serviceId: string): Promise<boolean>;
  setPolicy(serviceId: string, policy: SubscriptionPolicy): Promise<void>;
  subscribe(
    provider: string,
    serviceId: string,
    topic: string,
    mode: SubscriptionMode,
  ): Promise<string>;
  unsubscribe(subId: string): Promise<boolean>;
  publish(serviceId: string, topic: string, body: string, key?: string): Promise<PublishReport>;
  acceptSubscriber(subId: string): Promise<void>;
  rejectSubscriber(subId: string, reason?: string): Promise<void>;
  endSubscriber(subId: string, reason?: string): Promise<void>;
  listSubscriptions(): Promise<SubscriptionInfo[]>;
  onUpdate(handler: (u: ServiceUpdate) => void): Unsubscribe;
  onSubscriptionChanged(handler: (c: SubscriptionChange) => void): Unsubscribe;
  onSubscribeRequest(handler: (r: SubscribeRequest) => void): Unsubscribe;
  /** Fires after the mesh (re)starts: service registrations and subscriptions are not persisted by the SDK. */
  onStarted(handler: () => void): Unsubscribe;
}

export type BatteryReading = { level: number; charging: boolean };

/** Source of battery readings; the SDK needs them for relay scoring and cannot observe the battery itself. */
export interface BatteryPort {
  read(): Promise<BatteryReading | null>;
  subscribe(fn: (r: BatteryReading) => void): Unsubscribe;
}

export interface MeshPort {
  readonly services: ServiceTransport;
  /** Immutable; a new object on every change. */
  getSnapshot(): MeshSnapshot;
  subscribe(listener: () => void): Unsubscribe;
  /** Check permissions, create the SDK instance on first use, `start()`. Idempotent while running. */
  start(): Promise<Result<void>>;
  /** `stop()`; the SDK instance is kept so `start()` can be called again. */
  stop(): Promise<Result<void>>;
  /** `destroy()`; the instance is never reused. */
  destroy(): Promise<void>;
  /** Reconcile with the SDK after the app returns to the foreground. */
  reconcile(): Promise<void>;
  /** Android: shows the system dialog; iOS: always false. */
  requestEnableBluetooth(): Promise<boolean>;
  setBattery(level: number, charging: boolean): Promise<void>;
}
