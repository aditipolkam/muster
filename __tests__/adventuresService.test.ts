import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { destination } from '../src/domain/geo';
import { SOLO_ADDRESS } from '../src/domain/adventures/model';
import { FakeNetwork } from '../src/testing/FakeMesh';
import { AdventureNode, fixAt, makeAdventureNode } from '../src/testing/adventureNode';

const START = { lat: 46.8, lon: 8.2 };
const VIEW = destination(START, 90, 800);
const TOP = destination(START, 45, 1500);

async function solo(node: AdventureNode, name = 'Ridge walk') {
  const r = await node.service.createAdventure({ name, start: { ...START, label: 'Car park' } });
  if (!r.ok) {
    throw new Error(r.error.code);
  }
  return r.value;
}

async function withCheckpoints(node: AdventureNode, id: string) {
  const a = await node.service.addCheckpoint(id, { name: 'Viewpoint', kind: 'viewpoint', ...VIEW });
  const b = await node.service.addCheckpoint(id, { name: 'Summit', kind: 'summit', ...TOP });
  if (!a.ok || !b.ok) {
    throw new Error('checkpoint');
  }
  return { view: a.value, top: b.value };
}

/** Feed fixes the way the location store would: one every `stepMs`, `count` times. */
async function stand(
  node: AdventureNode,
  at: { lat: number; lon: number },
  count: number,
  accM = 5,
  stepMs = 2_000,
) {
  for (let i = 0; i < count; i++) {
    node.clock.advance(stepMs);
    await node.tracker.onFix(fixAt(at.lat, at.lon, node.clock.now(), accM));
  }
}

describe('adventure lifecycle (solo)', () => {
  it('creates a planned adventure with a name, description and start, and rejects an empty name', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const bad = await n.service.createAdventure({ name: '   ' });
    expect(!bad.ok && bad.error.code).toBe('adventures.invalid');
    const r = await n.service.createAdventure({
      name: ' Ridge ',
      description: 'Long day',
      start: { ...START, label: 'Car park' },
    });
    expect(r.ok && r.value).toMatchObject({
      name: 'Ridge',
      description: 'Long day',
      status: 'planned',
      groupId: null,
      startLabel: 'Car park',
      rev: 1,
    });
    expect(await n.repo.list()).toHaveLength(1);
  });

  it('walks Planned -> Active -> Paused -> Active -> Completed and refuses everything else', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    const bad = await n.service.act(a.id, 'pause');
    expect(!bad.ok && bad.error.code).toBe('adventures.bad_transition');
    for (const [action, status] of [
      ['start', 'active'],
      ['pause', 'paused'],
      ['resume', 'active'],
      ['complete', 'completed'],
    ] as const) {
      const r = await n.service.act(a.id, action);
      expect(r.ok && r.value.status).toBe(status);
    }
    expect((await n.service.act(a.id, 'resume')).ok).toBe(false);
    expect((await n.repo.log(a.id)).map(l => l.status)).toEqual([
      'planned',
      'active',
      'paused',
      'active',
      'completed',
    ]);
  });

  it('cancelling is separate from completing and keeps what was recorded', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    await n.service.act(a.id, 'start');
    const r = await n.service.act(a.id, 'cancel');
    expect(r.ok && r.value.status).toBe('cancelled');
    expect(r.ok && r.value.endedAt).not.toBeNull();
    expect((await n.repo.get(a.id))?.status).toBe('cancelled');
  });

  it('elapsed time counts only running time: pauses and rests are free', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    await n.service.act(a.id, 'start');
    n.clock.advance(10 * 60_000);
    await n.service.act(a.id, 'pause');
    n.clock.advance(3 * 3_600_000); // a long lunch
    await n.service.act(a.id, 'resume');
    n.clock.advance(5 * 60_000);
    const done = await n.service.act(a.id, 'complete');
    expect(done.ok && done.value.progress.activeMs).toBe(15 * 60_000);
    expect(done.ok && done.value.progress.resumedAt).toBeNull();
  });

  it('only one solo adventure runs at a time, but it can be paused to start another', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n, 'A');
    const b = await solo(n, 'B');
    await n.service.act(a.id, 'start');
    const blocked = await n.service.act(b.id, 'start');
    expect(!blocked.ok && blocked.error.code).toBe('adventures.already_running');
    await n.service.act(a.id, 'pause');
    expect((await n.service.act(b.id, 'start')).ok).toBe(true);
  });

  it('deleting is only for planned or finished adventures and removes everything stored for it', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    await withCheckpoints(n, a.id);
    await n.service.act(a.id, 'start');
    expect((await n.service.deleteAdventure(a.id)).ok).toBe(false);
    await n.service.act(a.id, 'cancel');
    expect((await n.service.deleteAdventure(a.id)).ok).toBe(true);
    expect(await n.repo.get(a.id)).toBeNull();
    expect(await n.repo.checkpoints(a.id, true)).toEqual([]);
  });
});

describe('checkpoints', () => {
  it('adds, edits and removes checkpoints with name, position, description and kind', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    const c = await n.service.addCheckpoint(a.id, {
      name: 'Falls',
      kind: 'waterfall',
      description: 'Cold!',
      ...VIEW,
    });
    expect(c.ok && c.value).toMatchObject({
      name: 'Falls',
      kind: 'waterfall',
      description: 'Cold!',
      rev: 1,
      ord: 0,
      deleted: false,
    });
    const id = c.ok ? c.value.id : '';
    const e = await n.service.updateCheckpoint(a.id, id, {
      name: 'Upper falls',
      kind: 'waterfall',
      ...TOP,
    });
    expect(e.ok && e.value).toMatchObject({ name: 'Upper falls', rev: 2 });
    expect((await n.service.removeCheckpoint(a.id, id)).ok).toBe(true);
    expect(await n.repo.checkpoints(a.id)).toEqual([]);
    expect((await n.repo.checkpoints(a.id, true))[0]).toMatchObject({ deleted: true, rev: 3 });
  });

  it('rejects bad positions and more than the maximum', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    const bad = await n.service.addCheckpoint(a.id, { name: 'X', kind: 'other', lat: 95, lon: 0 });
    expect(!bad.ok && bad.error.code).toBe('adventures.invalid_checkpoint');
    for (let i = 0; i < 20; i++) {
      expect(
        (
          await n.service.addCheckpoint(a.id, {
            name: `C${i}`,
            kind: 'other',
            ...destination(START, 0, 100 * (i + 1)),
          })
        ).ok,
      ).toBe(true);
    }
    const over = await n.service.addCheckpoint(a.id, {
      name: 'One too many',
      kind: 'other',
      ...START,
    });
    expect(!over.ok && over.error.code).toBe('adventures.too_many');
  });

  it('cannot change a finished adventure', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    await n.service.act(a.id, 'start');
    await n.service.act(a.id, 'complete');
    const r = await n.service.addCheckpoint(a.id, { name: 'Late', kind: 'other', ...START });
    expect(!r.ok && r.error.code).toBe('adventures.closed');
  });
});

describe('arrival detection end to end', () => {
  async function running(n: AdventureNode) {
    const a = await solo(n);
    const cps = await withCheckpoints(n, a.id);
    await n.service.act(a.id, 'start');
    return { a, ...cps };
  }

  it('confirms an arrival after steady good fixes and shows a quiet hint on the way in', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const { a, view } = await running(n);
    await stand(n, destination(VIEW, 270, 90), 1);
    expect(n.service.getSnapshot().hint).toMatchObject({ name: 'Viewpoint', state: 'approaching' });
    await stand(n, VIEW, 1);
    expect(await n.repo.completions(a.id)).toEqual([]); // one reading is never enough
    await stand(n, VIEW, 2);
    const done = await n.repo.completions(a.id);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ checkpointId: view.id, address: SOLO_ADDRESS, method: 'auto' });
    expect(n.service.getSnapshot().hint).toBeNull();
    expect(n.service.getSnapshot().celebrations.map(c => c.kind)).toEqual(['checkpoint']);
  });

  it('never confirms from a weak GPS fix, and offers the manual route instead', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const { a } = await running(n);
    await stand(n, VIEW, 6, 90);
    expect(await n.repo.completions(a.id)).toEqual([]);
    expect(n.service.getSnapshot().hint).toMatchObject({ state: 'uncertain', name: 'Viewpoint' });
  });

  it('a lone reading from a passing GPS spike does not count', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const { a } = await running(n);
    await stand(n, VIEW, 1);
    await stand(n, destination(VIEW, 0, 400), 1);
    await stand(n, VIEW, 1);
    expect(await n.repo.completions(a.id)).toEqual([]);
  });

  it('does not detect arrivals while paused, and a paused adventure refuses manual confirmation', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const { a, view } = await running(n);
    await n.service.act(a.id, 'pause');
    await stand(n, VIEW, 5);
    expect(await n.repo.completions(a.id)).toEqual([]);
    const m = await n.service.confirmArrival(a.id, view.id, 'manual');
    expect(!m.ok && m.error.code).toBe('adventures.not_running');
  });

  it('manual confirmation works anywhere the adventure is running and is idempotent', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const { a, top } = await running(n);
    const first = await n.service.confirmArrival(a.id, top.id, 'manual');
    const again = await n.service.confirmArrival(a.id, top.id, 'manual');
    expect(first.ok && again.ok && first.value.id === again.value.id).toBe(true);
    expect(await n.repo.completions(a.id)).toHaveLength(1);
    expect((await n.repo.completions(a.id))[0]?.method).toBe('manual');
  });

  it('marks the last checkpoint as "all explored" for the celebration', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const { a, view, top } = await running(n);
    await n.service.confirmArrival(a.id, view.id, 'manual');
    await n.service.confirmArrival(a.id, top.id, 'manual');
    expect(n.service.getSnapshot().celebrations.map(c => c.kind)).toEqual([
      'checkpoint',
      'all_checkpoints',
    ]);
    n.service.dismissCelebration(n.service.getSnapshot().celebrations[0]!.id);
    expect(n.service.getSnapshot().celebrations).toHaveLength(1);
  });
});

describe('recorded distance and route', () => {
  it('records the walked distance while running and nothing while paused', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    await n.service.act(a.id, 'start');
    let p = START;
    for (let i = 0; i < 8; i++) {
      p = destination(p, 90, 25);
      await stand(n, p, 1, 5, 12_000);
    }
    const walked = (await n.repo.get(a.id))!.progress.distanceM;
    expect(walked).toBeGreaterThan(150);
    expect(walked).toBeLessThan(180);
    expect((await n.repo.track(a.id)).length).toBe(8);
    await n.service.act(a.id, 'pause');
    for (let i = 0; i < 8; i++) {
      p = destination(p, 90, 25);
      await stand(n, p, 1, 5, 12_000);
    }
    expect((await n.repo.get(a.id))!.progress.distanceM).toBe(walked);
  });

  it('does not join the gap between two legs with a straight line', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    await n.service.act(a.id, 'start');
    await stand(n, START, 1);
    await n.service.act(a.id, 'pause');
    await n.service.act(a.id, 'resume');
    await stand(n, destination(START, 0, 3000), 1, 5, 3_600_000);
    expect((await n.repo.get(a.id))!.progress.distanceM).toBe(0);
  });
});

describe('finishing: offline map coverage and the network flag', () => {
  const region = {
    id: 'r',
    bbox: [8.0, 46.7, 8.4, 46.9] as [number, number, number, number],
    minZoom: 0,
    maxZoom: 14,
  };

  it('records whether every place was inside a downloaded region', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me', { regions: [region] });
    const a = await solo(n);
    await withCheckpoints(n, a.id);
    await n.service.act(a.id, 'start');
    const done = await n.service.act(a.id, 'complete');
    expect(done.ok && done.value.progress.offlineMapsCovered).toBe(true);

    const m = await makeAdventureNode(new FakeNetwork(), 'off1me2', { regions: [] });
    const b = await solo(m);
    await withCheckpoints(m, b.id);
    await m.service.act(b.id, 'start');
    const none = await m.service.act(b.id, 'complete');
    expect(none.ok && none.value.progress.offlineMapsCovered).toBe(false);
  });

  it('an adventure with no places cannot claim offline coverage', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me', { regions: [region] });
    const r = await n.service.createAdventure({ name: 'Wander' });
    const id = r.ok ? r.value.id : '';
    await n.service.act(id, 'start');
    const done = await n.service.act(id, 'complete');
    expect(done.ok && done.value.progress.offlineMapsCovered).toBe(false);
  });

  it('network use marks only adventures that are running', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n, 'running');
    const b = await solo(n, 'planned');
    await n.service.act(a.id, 'start');
    await n.service.noteNetworkUse();
    expect((await n.repo.get(a.id))?.progress.networkUsed).toBe(true);
    expect((await n.repo.get(b.id))?.progress.networkUsed).toBe(false);
  });
});

describe('achievements from real adventures', () => {
  const region = {
    id: 'r',
    bbox: [8.0, 46.7, 8.4, 46.9] as [number, number, number, number],
    minZoom: 0,
    maxZoom: 14,
  };

  async function finish(n: AdventureNode, opts: { reach?: boolean; minutes?: number } = {}) {
    const a = await solo(n);
    const { view } = await withCheckpoints(n, a.id);
    await n.service.act(a.id, 'start');
    if (opts.reach !== false) {
      await n.service.confirmArrival(a.id, view.id, 'manual');
    }
    n.clock.advance((opts.minutes ?? 5) * 60_000);
    await n.service.act(a.id, 'complete');
    return a;
  }

  it('unlocks First Adventure once, with a timestamp, and never twice', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    expect(await n.unlocks.list()).toEqual([]);
    const a = await finish(n);
    await n.engine.evaluateNow();
    const first = (await n.unlocks.list()).find(u => u.id === 'first_adventure');
    expect(first).toMatchObject({ unlockedAt: n.clock.now(), adventureId: a.id });
    expect(n.engine.getSnapshot().fresh).toContain('first_adventure');
    n.clock.advance(1000);
    await n.engine.evaluateNow();
    expect((await n.unlocks.list()).filter(u => u.id === 'first_adventure')).toHaveLength(1);
    expect((await n.unlocks.list()).find(u => u.id === 'first_adventure')?.unlockedAt).toBe(
      first!.unlockedAt,
    );
  });

  it('pressing start then finish unlocks nothing', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    await finish(n, { reach: false, minutes: 1 });
    await n.engine.evaluateNow();
    expect(await n.unlocks.list()).toEqual([]);
  });

  it('cancelled adventures earn nothing', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    await withCheckpoints(n, a.id);
    await n.service.act(a.id, 'start');
    const cps = await n.repo.checkpoints(a.id);
    await n.service.confirmArrival(a.id, cps[0]!.id, 'manual');
    await n.service.act(a.id, 'cancel');
    await n.engine.evaluateNow();
    expect((await n.unlocks.list()).map(u => u.id)).not.toContain('first_adventure');
  });

  it('Local Explorer needs saved maps; Off the Grid also needs 30 quiet minutes', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me', { regions: [region] });
    await finish(n, { minutes: 45 });
    await n.engine.evaluateNow();
    const ids = (await n.unlocks.list()).map(u => u.id);
    expect(ids).toEqual(
      expect.arrayContaining(['first_adventure', 'local_explorer', 'off_the_grid']),
    );

    const m = await makeAdventureNode(new FakeNetwork(), 'off1me2', { regions: [region] });
    const a = await solo(m);
    const { view } = await withCheckpoints(m, a.id);
    await m.service.act(a.id, 'start');
    await m.service.noteNetworkUse(); // a download happened during the trip
    await m.service.confirmArrival(a.id, view.id, 'manual');
    m.clock.advance(45 * 60_000);
    await m.service.act(a.id, 'complete');
    await m.engine.evaluateNow();
    const ids2 = (await m.unlocks.list()).map(u => u.id);
    expect(ids2).toContain('local_explorer');
    expect(ids2).not.toContain('off_the_grid');
  });

  it('badges stay earned when the adventure is deleted from the journal', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await finish(n);
    await n.engine.evaluateNow();
    await n.service.deleteAdventure(a.id);
    const row = (await n.unlocks.list()).find(u => u.id === 'first_adventure');
    expect(row).toMatchObject({ adventureId: null });
  });

  it('a summit checkpoint that was reached unlocks First Summit', async () => {
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me');
    const a = await solo(n);
    const { top } = await withCheckpoints(n, a.id);
    await n.service.act(a.id, 'start');
    await n.service.confirmArrival(a.id, top.id, 'manual');
    await n.service.act(a.id, 'complete');
    await n.engine.evaluateNow();
    expect((await n.unlocks.list()).map(u => u.id)).toContain('first_summit');
  });
});

describe('app restart recovery', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adv-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a running adventure, its checkpoints, arrivals, route and badges survive a restart', async () => {
    const path = join(dir, 'a.db');
    const n = await makeAdventureNode(new FakeNetwork(), 'off1me', { dbPath: path });
    const a = await solo(n);
    const { view } = await withCheckpoints(n, a.id);
    await n.service.act(a.id, 'start');
    n.clock.advance(60_000);
    await n.service.confirmArrival(a.id, view.id, 'manual');
    await stand(n, START, 1);
    await stand(n, destination(START, 0, 100), 1, 5, 20_000);
    await n.engine.evaluateNow();

    // The app is killed and relaunched later.
    const again = await makeAdventureNode(new FakeNetwork(), 'off1me', {
      dbPath: path,
      clock: n.clock,
    });
    again.clock.advance(120_000);
    const back = (await again.repo.get(a.id))!;
    expect(back.status).toBe('active');
    expect(back.progress.resumedAt).not.toBeNull();
    expect((await again.repo.checkpoints(a.id)).map(c => c.name)).toEqual(['Viewpoint', 'Summit']);
    expect(await again.repo.completions(a.id)).toHaveLength(1);
    expect((await again.repo.track(a.id)).length).toBe(2);
    expect(back.progress.distanceM).toBeGreaterThan(90);
    expect((await again.service.runningAdventures()).map(r => r.id)).toEqual([a.id]);

    // The clock kept counting while the app was closed, and finishing still works.
    const done = await again.service.act(a.id, 'complete');
    expect(done.ok && done.value.progress.activeMs).toBe(60_000 + 20_000 + 2_000 + 120_000);
  });
});
