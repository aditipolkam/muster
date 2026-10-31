/**
 * The ONLY file that imports the Offline Protocol SDK (CLAUDE.md; enforced by ESLint).
 * Everything else depends on `MeshPort`. Switching between the local build and the published
 * package is a dependency change (`scripts/sdk-source.sh`), not a code change.
 */
import { MeshServices, OfflineProtocol } from '@offline-protocol/mesh-sdk';
import type {
  NeighborDiscoveredEvent,
  NeighborLostEvent,
  DiagnosticEvent,
  ProtocolConfig,
  ServiceSubscribeReceivedEvent,
  ServiceSubscriptionChangedEvent,
  ServiceUpdateReceivedEvent,
  NetworkTopology,
  SubscriptionPolicy as SdkSubscriptionPolicy,
} from '@offline-protocol/mesh-sdk';

export type {
  NeighborDiscoveredEvent,
  NeighborLostEvent,
  DiagnosticEvent,
  ProtocolConfig,
  ServiceSubscribeReceivedEvent,
  ServiceSubscriptionChangedEvent,
  ServiceUpdateReceivedEvent,
  NetworkTopology,
  SdkSubscriptionPolicy,
};

/** Exactly the SDK surface the adapter uses; a test double implements this. */
export type SdkProtocol = Pick<
  OfflineProtocol,
  | 'start'
  | 'stop'
  | 'destroy'
  | 'getState'
  | 'localAddress'
  | 'isBluetoothEnabled'
  | 'requestEnableBluetooth'
  | 'getTopology'
  | 'getBLePeerCount'
  | 'setBatteryState'
> & {
  on(type: 'neighbor_discovered', l: (e: NeighborDiscoveredEvent) => void): unknown;
  on(type: 'neighbor_lost', l: (e: NeighborLostEvent) => void): unknown;
  on(type: 'diagnostic', l: (e: DiagnosticEvent) => void): unknown;
  on(type: 'mesh_stopped_by_user', l: () => void): unknown;
  on(type: 'identity_ready', l: (e: { address: string }) => void): unknown;
  on(type: 'service_update_received', l: (e: ServiceUpdateReceivedEvent) => void): unknown;
  on(
    type: 'service_subscription_changed',
    l: (e: ServiceSubscriptionChangedEvent) => void,
  ): unknown;
  on(type: 'service_subscribe_received', l: (e: ServiceSubscribeReceivedEvent) => void): unknown;
};

export type SdkServices = Pick<
  MeshServices,
  | 'registerService'
  | 'unregisterService'
  | 'setServiceSubscriptionPolicy'
  | 'subscribeService'
  | 'unsubscribeService'
  | 'publishServiceUpdate'
  | 'acceptServiceSubscription'
  | 'rejectServiceSubscription'
  | 'endServiceSubscription'
  | 'serviceSubscriptions'
>;

export type SdkFactory = {
  createProtocol(config: ProtocolConfig): SdkProtocol;
  createServices(): SdkServices;
};

export const realSdk: SdkFactory = {
  createProtocol: config => new OfflineProtocol(config) as unknown as SdkProtocol,
  createServices: () => new MeshServices(),
};
