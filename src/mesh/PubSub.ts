import type { Clock } from '../shared/clock';
import { Emitter, Unsubscribe } from '../shared/emitter';
import { createLogger } from '../shared/logger';
import { utf8Length } from '../shared/utf8';
import { AppError, appError, err, ok, Result } from '../shared/result';
import {
  createEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  Envelope,
  MAX_ENVELOPE_BYTES,
} from './envelope';
import { SeenIds } from './SeenIds';
import { isValidTopic, patternMatches } from './topics';
import type {
  MeshPort,
  PublishReport,
  SubscribeRequest,
  SubscriptionChange,
  SubscriptionInfo,
  SubscriptionMode,
  SubscriptionPolicy,
  SubscriptionState,
} from './types';

const log = createLogger('pubsub');
const LOG_CAP = 100;

/** Where inbound envelopes are persisted before anything else runs (CLAUDE.md rule 4). */
export interface InboxPort {
  /** Resolves true when the envelope is new, false when its id is already stored. */
  record(entry: {
    id: string;
    scope: string;
    type: string;
    author: string;
    sentTs: number;
    receivedAt: number;
    body: string;
  }): Promise<boolean>;
}

export type PublishedRecord = {
  envelopeId: string;
  serviceId: string;
  topic: string;
  key: string | null;
  type: string;
  at: number;
  bytes: number;
  /** `sending` until the SDK answers; `failed` when the call threw or every subscriber send failed. */
  state: 'sending' | 'sent' | 'no_subscribers' | 'failed';
  report: PublishReport | null;
  error: string | null;
};

export type ReceivedRecord = {
  envelopeId: string;
  topic: string;
  key: string | null;
  type: string;
  from: string;
  at: number;
  seq: number;
  snapshot: boolean;
  /** Duplicates are recorded but never dispatched to handlers. */
  duplicate: boolean;
  payload: Record<string, unknown>;
};

export type PubSubError = { at: number; code: string; message: string };

export type TrackedSubscription = SubscriptionInfo & { desired: boolean };

export type PubSubSnapshot = {
  providing: { serviceId: string; policy: SubscriptionPolicy } | null;
  subscriptions: TrackedSubscription[];
  /** Subscribers (other devices) following this device. */
  subscribers: { subId: string; subscriber: string; topic: string; state: SubscriptionState }[];
  pendingRequests: SubscribeRequest[];
  published: PublishedRecord[];
  received: ReceivedRecord[];
  duplicates: number;
  rejected: number;
  errors: PubSubError[];
};

export type MessageHandler = (
  env: Envelope,
  meta: { topic: string; from: string; key: string | null; snapshot: boolean },
) => void;

type Desired = { provider: string; serviceId: string; topic: string; mode: SubscriptionMode };

const keyOf = (d: Desired) => `${d.provider}|${d.serviceId}|${d.topic}|${d.mode}`;

export type PubSubDeps = {
  mesh: Pick<MeshPort, 'services' | 'getSnapshot'>;
  clock: Clock;
  newId: () => string;
  inbox?: InboxPort;
  /**
   * Which provided/followed services belong to this instance. The SDK reports every update and
   * request for the whole device, so two instances (diagnostics, groups) each filter their own.
   * Default: everything.
   */
  owns?: (serviceId: string) => boolean;
};

export type RequestHandler = (r: SubscribeRequest) => void;
export type SubscriptionEventHandler = (c: SubscriptionChange) => void;

/**
 * TrailMesh's reusable pub/sub layer over the SDK's service subscriptions (ADR 0035).
 *
 * The SDK has no mesh-wide topics: a topic belongs to one provider's service, and consumers
 * subscribe to that provider (docs/SDK_INTEGRATION.md section 4). So `publish` writes to a
 * service this device provides, and `subscribe` follows one named provider.
 * No UI imports; screens consume `getSnapshot()` through runtime hooks.
 */
export class PubSub {
  private readonly changes = new Emitter<void>();
  private readonly seen = new SeenIds();
  private readonly handlers = new Map<number, { pattern: string; fn: MessageHandler }>();
  private nextHandler = 1;
  private readonly requestHandlers = new Set<RequestHandler>();
  private readonly eventHandlers = new Set<SubscriptionEventHandler>();
  private desired = new Map<string, Desired & { subId: string | null }>();
  private snap: PubSubSnapshot = {
    providing: null,
    subscriptions: [],
    subscribers: [],
    pendingRequests: [],
    published: [],
    received: [],
    duplicates: 0,
    rejected: 0,
    errors: [],
  };
  private providing: { serviceId: string; version: string; policy: SubscriptionPolicy } | null =
    null;
  private readonly unsubs: Unsubscribe[] = [];

  constructor(private readonly deps: PubSubDeps) {
    const s = deps.mesh.services;
    this.unsubs.push(
      s.onUpdate(u => void this.handleUpdate(u)),
      s.onSubscriptionChanged(c => this.handleChange(c)),
      s.onSubscribeRequest(r => {
        if (!this.owned(r.serviceId)) {
          return;
        }
        this.set({
          pendingRequests: [...this.snap.pendingRequests.filter(p => p.subId !== r.subId), r],
        });
        for (const h of [...this.requestHandlers]) {
          try {
            h(r);
          } catch (e) {
            log.error(`request handler threw: ${String(e)}`);
          }
        }
      }),
      s.onStarted(() => void this.restore()),
    );
  }

  getSnapshot = (): PubSubSnapshot => this.snap;

  subscribeChanges = (fn: () => void): Unsubscribe => this.changes.subscribe(fn);

  /** Detach from the transport. After this the instance is unusable. */
  dispose(): void {
    this.unsubs.splice(0).forEach(u => u());
    this.handlers.clear();
    this.requestHandlers.clear();
    this.eventHandlers.clear();
  }

  /** Called for each subscription request to a service this instance provides. */
  onRequest(fn: RequestHandler): Unsubscribe {
    this.requestHandlers.add(fn);
    return () => {
      this.requestHandlers.delete(fn);
    };
  }

  /** Called for each subscription lifecycle change (consumer and provider role) of an owned service. */
  onSubscriptionEvent(fn: SubscriptionEventHandler): Unsubscribe {
    this.eventHandlers.add(fn);
    return () => {
      this.eventHandlers.delete(fn);
    };
  }

  private owned(serviceId: string): boolean {
    return this.deps.owns ? this.deps.owns(serviceId) : true;
  }

  // ---- consumer side -------------------------------------------------------------------------

  /** Calls `fn` for each valid, non-duplicate envelope whose topic matches `pattern`. */
  onMessage(pattern: string, fn: MessageHandler): Unsubscribe {
    const id = this.nextHandler++;
    this.handlers.set(id, { pattern, fn });
    return () => {
      this.handlers.delete(id);
    };
  }

  get handlerCount(): number {
    return this.handlers.size;
  }

  async subscribe(d: Desired): Promise<Result<string>> {
    if (!isValidTopic(d.topic, true)) {
      return this.fail('pubsub.invalid_topic', 'That topic is not valid.');
    }
    const notReady = this.requireRunning();
    if (notReady) {
      return notReady;
    }
    const k = keyOf(d);
    const existing = this.desired.get(k);
    if (existing?.subId) {
      return ok(existing.subId);
    }
    try {
      const subId = await this.deps.mesh.services.subscribe(
        d.provider,
        d.serviceId,
        d.topic,
        d.mode,
      );
      this.desired.set(k, { ...d, subId });
      this.upsertSub({ subId, ...d, state: 'pending', desired: true });
      return ok(subId);
    } catch (e) {
      return this.fail('pubsub.subscribe_failed', 'Could not subscribe.', e);
    }
  }

  async unsubscribe(subId: string): Promise<Result<void>> {
    for (const [k, d] of this.desired) {
      if (d.subId === subId) {
        this.desired.delete(k);
      }
    }
    try {
      await this.deps.mesh.services.unsubscribe(subId);
    } catch (e) {
      return this.fail('pubsub.unsubscribe_failed', 'Could not unsubscribe.', e);
    } finally {
      this.set({ subscriptions: this.snap.subscriptions.filter(s => s.subId !== subId) });
    }
    return ok(undefined);
  }

  /** Cleanup: ends every subscription this layer holds. Errors are reported, not thrown. */
  async unsubscribeAll(): Promise<void> {
    for (const s of [...this.snap.subscriptions]) {
      await this.unsubscribe(s.subId);
    }
    this.desired.clear();
  }

  // ---- provider side -------------------------------------------------------------------------

  async provide(
    serviceId: string,
    version: string,
    policy: SubscriptionPolicy = 'restricted',
  ): Promise<Result<void>> {
    const notReady = this.requireRunning();
    if (notReady) {
      return notReady;
    }
    try {
      await this.deps.mesh.services.registerService(serviceId, version);
      await this.deps.mesh.services.setPolicy(serviceId, policy);
      this.providing = { serviceId, version, policy };
      this.set({ providing: { serviceId, policy } });
      return ok(undefined);
    } catch (e) {
      return this.fail('pubsub.register_failed', 'Could not start publishing.', e);
    }
  }

  async setPolicy(policy: SubscriptionPolicy): Promise<Result<void>> {
    if (!this.providing) {
      return this.fail('pubsub.not_registered', 'Start publishing first.');
    }
    try {
      await this.deps.mesh.services.setPolicy(this.providing.serviceId, policy);
      this.providing = { ...this.providing, policy };
      this.set({ providing: { serviceId: this.providing.serviceId, policy } });
      return ok(undefined);
    } catch (e) {
      return this.fail('pubsub.policy_failed', 'Could not change who may subscribe.', e);
    }
  }

  async stopProviding(): Promise<Result<void>> {
    if (!this.providing) {
      return ok(undefined);
    }
    const { serviceId } = this.providing;
    this.providing = null;
    this.set({ providing: null, subscribers: [], pendingRequests: [] });
    try {
      await this.deps.mesh.services.unregisterService(serviceId);
      return ok(undefined);
    } catch (e) {
      return this.fail('pubsub.unregister_failed', 'Could not stop publishing.', e);
    }
  }

  async acceptRequest(subId: string): Promise<Result<void>> {
    return this.answer(subId, () => this.deps.mesh.services.acceptSubscriber(subId));
  }

  async rejectRequest(subId: string): Promise<Result<void>> {
    return this.answer(subId, () =>
      this.deps.mesh.services.rejectSubscriber(subId, 'rejected by user'),
    );
  }

  async endSubscriber(subId: string): Promise<Result<void>> {
    return this.answer(subId, () =>
      this.deps.mesh.services.endSubscriber(subId, 'removed by user'),
    );
  }

  async publish(input: {
    topic: string;
    type: string;
    payload?: Record<string, unknown>;
    /** With a key the topic is `latest` (newest wins); without, `log` (every update in order). */
    key?: string;
  }): Promise<Result<PublishedRecord>> {
    if (!this.providing) {
      return this.fail('pubsub.not_registered', 'Start publishing first.');
    }
    const notReady = this.requireRunning();
    if (notReady) {
      return notReady;
    }
    if (!isValidTopic(input.topic, false)) {
      return this.fail('pubsub.invalid_topic', 'That topic is not valid.');
    }
    const author = this.deps.mesh.getSnapshot().localAddress ?? '';
    const env = createEnvelope({ type: input.type, author, payload: input.payload }, this.deps);
    const body = encodeEnvelope(env);
    if (!body.ok) {
      this.pushError(body.error);
      return body;
    }
    const base: PublishedRecord = {
      envelopeId: env.id,
      serviceId: this.providing.serviceId,
      topic: input.topic,
      key: input.key ?? null,
      type: env.t,
      at: this.deps.clock.now(),
      bytes: utf8Length(body.value),
      state: 'sending',
      report: null,
      error: null,
    };
    this.pushPublished(base);
    try {
      const report = await this.deps.mesh.services.publish(
        this.providing.serviceId,
        input.topic,
        body.value,
        input.key,
      );
      const state: PublishedRecord['state'] =
        report.subscribers === 0
          ? 'no_subscribers'
          : report.failed > 0 && report.sentLive + report.queued + report.coalesced === 0
          ? 'failed'
          : 'sent';
      const done = { ...base, state, report };
      this.updatePublished(done);
      return ok(done);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const failed = { ...base, state: 'failed' as const, error };
      this.updatePublished(failed);
      return this.fail('pubsub.publish_failed', 'Could not publish.', e);
    }
  }

  // ---- inbound -------------------------------------------------------------------------------

  private async handleUpdate(u: {
    serviceId: string;
    subId: string;
    topic: string;
    key: string | null;
    seq: number;
    body: string;
    snapshot: boolean;
    provider: string;
  }): Promise<void> {
    if (!this.owned(u.serviceId)) {
      return;
    }
    const at = this.deps.clock.now();
    const decoded = decodeEnvelope(u.body);
    if (!decoded.ok) {
      this.set({ rejected: this.snap.rejected + 1 });
      this.pushError(decoded.error);
      return;
    }
    const env = decoded.value;
    // Memory dedupe is synchronous so two events for one id cannot both pass the await below.
    const isNew = this.seen.add(env.id);
    let duplicate = !isNew;
    if (isNew && this.deps.inbox) {
      try {
        const stored = await this.deps.inbox.record({
          id: env.id,
          scope: u.topic.split('/')[2] ?? '',
          type: env.t,
          author: u.provider,
          sentTs: env.ts,
          receivedAt: at,
          body: u.body,
        });
        duplicate = !stored;
      } catch (e) {
        // Persisting failed: still deliver, but say so.
        this.pushError(
          appError('inbox.write_failed', 'Could not save a received message.', {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }
    const rec: ReceivedRecord = {
      envelopeId: env.id,
      topic: u.topic,
      key: u.key,
      type: env.t,
      from: u.provider,
      at,
      seq: u.seq,
      snapshot: u.snapshot,
      duplicate,
      payload: env.p,
    };
    this.set({
      received: [rec, ...this.snap.received].slice(0, LOG_CAP),
      duplicates: this.snap.duplicates + (duplicate ? 1 : 0),
    });
    if (duplicate) {
      return;
    }
    for (const { pattern, fn } of [...this.handlers.values()]) {
      if (patternMatches(pattern, u.topic)) {
        try {
          fn(env, { topic: u.topic, from: u.provider, key: u.key, snapshot: u.snapshot });
        } catch (e) {
          log.error(`handler threw: ${String(e)}`);
        }
      }
    }
  }

  private handleChange(c: SubscriptionChange): void {
    if (!this.owned(c.serviceId)) {
      return;
    }
    this.notifyEvent(c);
    if (c.role === 'consumer') {
      this.set({
        subscriptions: this.snap.subscriptions
          .map(s => (s.subId === c.subId ? { ...s, state: c.state } : s))
          .filter(s => s.state !== 'ended' || s.desired),
      });
      return;
    }
    const others = this.snap.subscribers.filter(s => s.subId !== c.subId);
    this.set({
      subscribers:
        c.state === 'ended'
          ? others
          : [...others, { subId: c.subId, subscriber: c.peer, topic: c.topic, state: c.state }],
      pendingRequests:
        c.state === 'pending'
          ? this.snap.pendingRequests
          : this.snap.pendingRequests.filter(r => r.subId !== c.subId),
    });
  }

  private notifyEvent(c: SubscriptionChange): void {
    for (const h of [...this.eventHandlers]) {
      try {
        h(c);
      } catch (e) {
        log.error(`subscription handler threw: ${String(e)}`);
      }
    }
  }

  /** The SDK does not persist registrations or subscriptions across a restart: redo them. */
  private async restore(): Promise<void> {
    const s = this.deps.mesh.services;
    if (this.providing) {
      try {
        await s.registerService(this.providing.serviceId, this.providing.version);
        await s.setPolicy(this.providing.serviceId, this.providing.policy);
      } catch (e) {
        this.pushError(
          appError('pubsub.restore_failed', 'Could not resume publishing.', { message: String(e) }),
        );
      }
    }
    for (const [k, { subId: oldId, ...d }] of [...this.desired]) {
      try {
        const subId = await s.subscribe(d.provider, d.serviceId, d.topic, d.mode);
        this.desired.set(k, { ...d, subId });
        this.set({ subscriptions: this.snap.subscriptions.filter(x => x.subId !== oldId) });
        this.upsertSub({ subId, ...d, state: 'pending', desired: true });
      } catch (e) {
        this.pushError(
          appError('pubsub.restore_failed', 'Could not resume a subscription.', {
            message: String(e),
          }),
        );
      }
    }
  }

  // ---- helpers -------------------------------------------------------------------------------

  private async answer(subId: string, call: () => Promise<void>): Promise<Result<void>> {
    try {
      await call();
      this.set({ pendingRequests: this.snap.pendingRequests.filter(r => r.subId !== subId) });
      return ok(undefined);
    } catch (e) {
      return this.fail('pubsub.answer_failed', 'That request could not be answered.', e);
    }
  }

  private requireRunning(): Result<never> | null {
    return this.deps.mesh.getSnapshot().lifecycle === 'running'
      ? null
      : this.fail('mesh.not_running', 'Start the mesh first.');
  }

  private fail(code: string, userMessage: string, cause?: unknown): Result<never> {
    const error = appError(code, userMessage, {
      message:
        cause === undefined
          ? userMessage
          : `${userMessage} ${cause instanceof Error ? cause.message : String(cause)}`,
    });
    this.pushError(error);
    return err(error);
  }

  private pushError(e: AppError): void {
    this.set({
      errors: [
        { at: this.deps.clock.now(), code: e.code, message: e.message },
        ...this.snap.errors,
      ].slice(0, LOG_CAP),
    });
  }

  private upsertSub(s: TrackedSubscription): void {
    this.set({ subscriptions: [...this.snap.subscriptions.filter(x => x.subId !== s.subId), s] });
  }

  private pushPublished(r: PublishedRecord): void {
    this.set({ published: [r, ...this.snap.published].slice(0, LOG_CAP) });
  }

  private updatePublished(r: PublishedRecord): void {
    this.set({ published: this.snap.published.map(p => (p.envelopeId === r.envelopeId ? r : p)) });
  }

  private set(patch: Partial<PubSubSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.changes.emit();
  }
}

export { MAX_ENVELOPE_BYTES };
