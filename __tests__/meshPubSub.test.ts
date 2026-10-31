import { PubSub } from '../src/mesh/PubSub';
import { DIAG_SERVICE_ID, diagTopics } from '../src/mesh/topics';
import { EventsRepo } from '../src/data/repositories/EventsRepo';
import { runMigrations } from '../src/data/migrations';
import { FakeMesh, FakeNetwork } from '../src/testing/FakeMesh';
import { ManualClock, testId } from '../src/testing/services';
import { openNodeSqlite } from '../src/testing/nodeSqlite';
import { encodeEnvelope } from '../src/mesh/envelope';

type Node = { mesh: FakeMesh; ps: PubSub; clock: ManualClock };

function setup(opts: { inbox?: EventsRepo } = {}) {
  const net = new FakeNetwork();
  const mk = (addr: string, inbox?: EventsRepo): Node => {
    const mesh = new FakeMesh(addr, net);
    const clock = new ManualClock();
    return { mesh, clock, ps: new PubSub({ mesh, clock, newId: testId, inbox }) };
  };
  return { net, a: mk('off1alice'), b: mk('off1bob', opts.inbox) };
}

async function connect(a: Node, b: Node, policy: 'accept_all' | 'restricted' = 'accept_all') {
  await a.mesh.start();
  await b.mesh.start();
  expect((await a.ps.provide(DIAG_SERVICE_ID, '1', policy)).ok).toBe(true);
  const sub = await b.ps.subscribe({
    provider: 'off1alice',
    serviceId: DIAG_SERVICE_ID,
    topic: diagTopics.all,
    mode: 'log',
  });
  expect(sub.ok).toBe(true);
}

describe('PubSub over the service transport', () => {
  it('delivers a published event to a subscriber and shows it as received', async () => {
    const { a, b } = setup();
    await connect(a, b);
    const got: unknown[] = [];
    b.ps.onMessage(diagTopics.all, (env, meta) => got.push([env.t, env.p, meta.topic, meta.from]));

    const pub = await a.ps.publish({
      topic: diagTopics.event,
      type: 'ping',
      payload: { text: 'hi' },
    });

    expect(pub.ok && pub.value.state).toBe('sent');
    expect(pub.ok && pub.value.report?.sentLive).toBe(1);
    await new Promise(r => setImmediate(r));
    expect(got).toEqual([['ping', { text: 'hi' }, diagTopics.event, 'off1alice']]);
    expect(b.ps.getSnapshot().received[0]).toMatchObject({
      type: 'ping',
      from: 'off1alice',
      duplicate: false,
    });
    expect(a.ps.getSnapshot().published[0]).toMatchObject({ state: 'sent', type: 'ping' });
  });

  it('gives every envelope a distinct message id', async () => {
    const { a, b } = setup();
    await connect(a, b);
    const r1 = await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
    const r2 = await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
    expect(r1.ok && r2.ok && r1.value.envelopeId !== r2.value.envelopeId).toBe(true);
  });

  it('reports no_subscribers honestly instead of claiming delivery', async () => {
    const { a } = setup();
    await a.mesh.start();
    await a.ps.provide(DIAG_SERVICE_ID, '1');
    const r = await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
    expect(r.ok && r.value.state).toBe('no_subscribers');
  });

  it('reports failure when every send to subscribers failed', async () => {
    const { a, b, net } = setup();
    await connect(a, b);
    net.lossRate = 1;
    const r = await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
    expect(r.ok && r.value.state).toBe('failed');
    expect(r.ok && r.value.report?.failed).toBe(1);
  });

  it('records the error and marks the message failed when the SDK call throws', async () => {
    const { a } = setup();
    await a.mesh.start();
    await a.ps.provide(DIAG_SERVICE_ID, '1');
    a.mesh.services.publish = async () => {
      throw new Error('native boom');
    };
    const r = await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('pubsub.publish_failed');
    expect(a.ps.getSnapshot().published[0]).toMatchObject({
      state: 'failed',
      error: 'native boom',
    });
    expect(a.ps.getSnapshot().errors[0]?.code).toBe('pubsub.publish_failed');
  });

  it('refuses to publish before publishing is started, when the mesh is down, or for an invalid topic', async () => {
    const { a } = setup();
    expect((await a.ps.publish({ topic: diagTopics.event, type: 'x' })).ok).toBe(false);
    await a.mesh.start();
    await a.ps.provide(DIAG_SERVICE_ID, '1');
    expect((await a.ps.publish({ topic: 'tm/1/diag/has space', type: 'x' })).ok).toBe(false);
    expect((await a.ps.publish({ topic: diagTopics.all, type: 'x' })).ok).toBe(false);
    await a.mesh.stop();
    const down = await a.ps.publish({ topic: diagTopics.event, type: 'x' });
    expect(!down.ok && down.error.code).toBe('mesh.not_running');
  });

  it('refuses an oversized message before it reaches the SDK', async () => {
    const { a } = setup();
    await a.mesh.start();
    await a.ps.provide(DIAG_SERVICE_ID, '1');
    const spy = jest.spyOn(a.mesh.services, 'publish');
    const r = await a.ps.publish({
      topic: diagTopics.event,
      type: 'ping',
      payload: { text: 'x'.repeat(5000) },
    });
    expect(!r.ok && r.error.code).toBe('envelope.too_large');
    expect(spy).not.toHaveBeenCalled();
  });

  it('latest-mode publishes carry a key; log-mode subscribers do not receive them', async () => {
    const { a, b } = setup();
    await connect(a, b); // b subscribed in log mode
    const got: string[] = [];
    b.ps.onMessage(diagTopics.all, env => got.push(env.t));
    await a.ps.publish({ topic: diagTopics.state, type: 'state', key: 'state' });
    await a.ps.publish({ topic: diagTopics.event, type: 'event' });
    expect(got).toEqual(['event']);
  });

  describe('duplicate detection', () => {
    it('dispatches a redelivered update once and counts the duplicate', async () => {
      const { a, b, net } = setup();
      await connect(a, b);
      net.duplicate = true;
      const handler = jest.fn();
      b.ps.onMessage(diagTopics.all, handler);
      await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
      await new Promise(r => setImmediate(r));
      expect(handler).toHaveBeenCalledTimes(1);
      const snap = b.ps.getSnapshot();
      expect(snap.received).toHaveLength(2);
      expect(snap.received.filter(r => r.duplicate)).toHaveLength(1);
      expect(snap.duplicates).toBe(1);
    });

    it('survives a restart: an id already in the SQLite inbox is not dispatched again', async () => {
      const db = openNodeSqlite();
      await runMigrations(db);
      const inbox = new EventsRepo(db);
      const first = setup({ inbox });
      await connect(first.a, first.b);
      const handler = jest.fn();
      first.b.ps.onMessage(diagTopics.all, handler);
      const pub = await first.a.ps.publish({ topic: diagTopics.event, type: 'ping' });
      await new Promise(r => setImmediate(r));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(await inbox.count()).toBe(1);

      // New process: empty memory, same database. The SDK re-sends the catch-up snapshot.
      const second = setup({ inbox });
      const again = jest.fn();
      second.b.ps.onMessage(diagTopics.all, again);
      const env = pub.ok ? pub.value.envelopeId : '';
      const body = encodeEnvelope({ tm: 1, id: env, t: 'ping', a: 'off1alice', ts: 1, p: {} });
      second.b.mesh.services.onUpdate(() => undefined);
      await (second.b.ps as any).handleUpdate({
        subId: 's',
        topic: diagTopics.event,
        key: null,
        seq: 9,
        snapshot: true,
        provider: 'off1alice',
        body: body.ok ? body.value : '',
      });
      expect(again).not.toHaveBeenCalled();
      expect(second.b.ps.getSnapshot().duplicates).toBe(1);
      expect(await inbox.count()).toBe(1);
    });

    it('persists in the handler before dispatching to application handlers', async () => {
      const db = openNodeSqlite();
      await runMigrations(db);
      const inbox = new EventsRepo(db);
      const { a, b } = setup({ inbox });
      await connect(a, b);
      let countWhenHandled = -1;
      b.ps.onMessage(diagTopics.all, () => {
        void inbox.count().then(n => (countWhenHandled = n));
      });
      await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
      await new Promise(r => setTimeout(r, 20));
      expect(countWhenHandled).toBe(1);
    });
  });

  describe('untrusted input', () => {
    it('drops malformed bodies, counts them and keeps working', async () => {
      const { a, b } = setup();
      await connect(a, b);
      const handler = jest.fn();
      b.ps.onMessage(diagTopics.all, handler);
      const raw = (body: string) =>
        (b.ps as any).handleUpdate({
          subId: 's',
          topic: diagTopics.event,
          key: null,
          seq: 1,
          snapshot: false,
          provider: 'off1alice',
          body,
        });
      await raw('not json');
      await raw(JSON.stringify({ tm: 9, id: 'x', t: 'x', a: '', ts: 1 }));
      await raw('x'.repeat(5000));
      expect(handler).not.toHaveBeenCalled();
      expect(b.ps.getSnapshot().rejected).toBe(3);
      expect(b.ps.getSnapshot().errors.map(e => e.code)).toEqual(
        expect.arrayContaining([
          'envelope.not_json',
          'envelope.unsupported_version',
          'envelope.too_large',
        ]),
      );
      await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
      await new Promise(r => setImmediate(r));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('a throwing application handler does not stop the others', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { a, b } = setup();
      await connect(a, b);
      const ok = jest.fn();
      b.ps.onMessage(diagTopics.all, () => {
        throw new Error('bad handler');
      });
      b.ps.onMessage(diagTopics.all, ok);
      await a.ps.publish({ topic: diagTopics.event, type: 'ping' });
      await new Promise(r => setImmediate(r));
      expect(ok).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  describe('provider consent', () => {
    it('holds a subscriber under the restricted policy until the user accepts', async () => {
      const { a, b } = setup();
      await connect(a, b, 'restricted');
      expect(a.ps.getSnapshot().pendingRequests).toHaveLength(1);
      const handler = jest.fn();
      b.ps.onMessage(diagTopics.all, handler);
      await a.ps.publish({ topic: diagTopics.event, type: 'before' });
      expect(handler).not.toHaveBeenCalled();

      const req = a.ps.getSnapshot().pendingRequests[0]!;
      expect((await a.ps.acceptRequest(req.subId)).ok).toBe(true);
      expect(a.ps.getSnapshot().pendingRequests).toHaveLength(0);
      expect(b.ps.getSnapshot().subscriptions[0]?.state).toBe('active');

      await a.ps.publish({ topic: diagTopics.event, type: 'after' });
      await new Promise(r => setImmediate(r));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('rejecting clears the request and delivers nothing', async () => {
      const { a, b } = setup();
      await connect(a, b, 'restricted');
      const req = a.ps.getSnapshot().pendingRequests[0]!;
      await a.ps.rejectRequest(req.subId);
      expect(a.ps.getSnapshot().pendingRequests).toHaveLength(0);
      const handler = jest.fn();
      b.ps.onMessage(diagTopics.all, handler);
      await a.ps.publish({ topic: diagTopics.event, type: 'x' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('subscription cleanup', () => {
    it('unsubscribe removes the subscription at both ends and stops delivery', async () => {
      const { a, b } = setup();
      await connect(a, b);
      const handler = jest.fn();
      b.ps.onMessage(diagTopics.all, handler);
      const subId = b.ps.getSnapshot().subscriptions[0]!.subId;
      expect((await b.ps.unsubscribe(subId)).ok).toBe(true);
      expect(b.ps.getSnapshot().subscriptions).toHaveLength(0);
      expect(a.mesh.held.size).toBe(0);
      await a.ps.publish({ topic: diagTopics.event, type: 'x' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribeAll empties everything, including the desired set used for restore', async () => {
      const { a, b } = setup();
      await connect(a, b);
      await b.ps.unsubscribeAll();
      expect(b.ps.getSnapshot().subscriptions).toHaveLength(0);
      b.mesh.simulateRestart();
      await new Promise(r => setImmediate(r));
      expect(b.mesh.mine.size).toBe(0); // nothing resubscribed
    });

    it('handler unsubscribe functions detach, and dispose releases every transport listener', async () => {
      const { a, b } = setup();
      await connect(a, b);
      const handler = jest.fn();
      const off = b.ps.onMessage(diagTopics.all, handler);
      expect(b.ps.handlerCount).toBe(1);
      off();
      expect(b.ps.handlerCount).toBe(0);
      await a.ps.publish({ topic: diagTopics.event, type: 'x' });
      await new Promise(r => setImmediate(r));
      expect(handler).not.toHaveBeenCalled();

      expect(b.mesh.listenerCounts).toEqual({ updates: 1, changes: 1, requests: 1, started: 1 });
      b.ps.dispose();
      expect(b.mesh.listenerCounts).toEqual({ updates: 0, changes: 0, requests: 0, started: 0 });
    });

    it('stopProviding unregisters the service and clears subscriber state', async () => {
      const { a, b } = setup();
      await connect(a, b);
      expect((await a.ps.stopProviding()).ok).toBe(true);
      expect(a.ps.getSnapshot().providing).toBeNull();
      expect(a.mesh.held.size).toBe(0);
    });

    it('rejects an invalid topic or an unstarted mesh when subscribing', async () => {
      const { b } = setup();
      const r1 = await b.ps.subscribe({
        provider: 'off1alice',
        serviceId: DIAG_SERVICE_ID,
        topic: 'bad topic',
        mode: 'log',
      });
      expect(!r1.ok && r1.error.code).toBe('pubsub.invalid_topic');
      const r2 = await b.ps.subscribe({
        provider: 'off1alice',
        serviceId: DIAG_SERVICE_ID,
        topic: diagTopics.all,
        mode: 'log',
      });
      expect(!r2.ok && r2.error.code).toBe('mesh.not_running');
    });
  });

  describe('SDK restart', () => {
    it('re-registers the service and re-subscribes, because the SDK persists neither', async () => {
      const { a, b } = setup();
      await connect(a, b);
      // Provider comes back first. Whether the real SDK copes with a consumer that re-subscribes
      // before the provider re-registers is a device question (PROGRESS.md, open items).
      a.mesh.simulateRestart();
      await new Promise(r => setTimeout(r, 10));
      b.mesh.simulateRestart();
      await new Promise(r => setTimeout(r, 10));
      expect(a.mesh.held.size).toBe(1);
      const sub = b.ps.getSnapshot().subscriptions;
      expect(sub).toHaveLength(1);
      expect(sub[0]?.state === 'active' || sub[0]?.state === 'pending').toBe(true);

      const handler = jest.fn();
      b.ps.onMessage(diagTopics.all, handler);
      await a.ps.publish({ topic: diagTopics.event, type: 'afterRestart' });
      await new Promise(r => setImmediate(r));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
