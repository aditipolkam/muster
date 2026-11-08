import { AdventuresRepo } from '../src/data/repositories/AdventuresRepo';
import { MIGRATIONS, runMigrations } from '../src/data/migrations';
import { openNodeSqlite } from '../src/testing/nodeSqlite';
import { authorizeAdventureInbound, KnownAdventure } from '../src/domain/adventures/authorize';
import { boxIsInstalled, areaForPlaces } from '../src/domain/adventures/area';
import {
  activityStanding,
  isAcceptableRemoteStatus,
  transition,
} from '../src/domain/adventures/lifecycle';
import { judgeHeader } from '../src/domain/adventures/merge';
import {
  AdventureHeaderSchema,
  CheckpointInputSchema,
  CheckpointWireSchema,
  MapAreaWireSchema,
  ParticipantSchema,
  toMapArea,
  toMapAreaWire,
} from '../src/domain/adventures/model';
import {
  phaseStatuses,
  isPhaseUnlocked,
  needsSelfConfirmation,
  nextPhase,
  phaseKind,
  phaseProgress,
} from '../src/domain/adventures/phases';
import type { Group, GroupMember } from '../src/domain/groups/model';

const ph = (id: string, ord: number, deleted = false) => ({ id, ord, deleted });

describe('draft and publish', () => {
  it('publishing a draft starts it; a draft can only be published or cancelled', () => {
    expect(transition('draft', 'publish')).toBe('active');
    expect(transition('draft', 'cancel')).toBe('cancelled');
    for (const a of ['start', 'pause', 'resume', 'complete'] as const) {
      expect(transition('draft', a)).toBeNull();
    }
    expect(transition('active', 'publish')).toBeNull();
    expect(transition('planned', 'publish')).toBeNull();
  });

  it('a draft is never accepted from the wire, and nothing returns to draft', () => {
    expect(isAcceptableRemoteStatus('active', 'draft')).toBe(false);
    expect(isAcceptableRemoteStatus('planned', 'draft')).toBe(false);
    expect(AdventureHeaderSchema.safeParse({ ...header, status: 'draft' }).success).toBe(false);
  });

  it('a received header may move a local draft forward but not the other way', () => {
    expect(isAcceptableRemoteStatus('draft', 'active')).toBe(true);
    const cur = { rev: 1, status: 'active' as const, groupId: 'g' };
    const next = AdventureHeaderSchema.parse({ ...header, rev: 2, status: 'completed' });
    expect(judgeHeader(cur, next, 'g').accept).toBe(true);
  });
});

const header = {
  id: 'a1',
  rev: 1,
  name: 'Ridge walk',
  status: 'active',
  ca: 1,
  ts: 2,
};

describe('activity header: order flag and map area', () => {
  const area = { b: [73.1, 18.5, 73.4, 18.8], n: 'Sinhagad', z: [10, 15] };

  it('accepts a header without the new fields (older senders)', () => {
    expect(AdventureHeaderSchema.safeParse(header).success).toBe(true);
  });

  it('carries the order flag and a valid area', () => {
    const r = AdventureHeaderSchema.safeParse({ ...header, ord: 1, rg: area });
    expect(r.success).toBe(true);
    expect(AdventureHeaderSchema.safeParse({ ...header, ord: 0 }).success).toBe(false);
  });

  it('refuses an area that is empty, inverted, too large or too deep', () => {
    const bad = (over: Partial<typeof area>) => MapAreaWireSchema.safeParse({ ...area, ...over });
    expect(bad({}).success).toBe(true);
    expect(bad({ b: [73.4, 18.5, 73.1, 18.8] }).success).toBe(false); // west > east
    expect(bad({ b: [73.1, 18.8, 73.4, 18.5] }).success).toBe(false); // south > north
    expect(bad({ b: [73.1, 18.5, 73.1, 18.8] }).success).toBe(false); // zero width
    expect(bad({ b: [73.0, 18.0, 73.6, 18.4] }).success).toBe(false); // 0.6 deg wide
    expect(bad({ b: [73.0, 18.0, 73.4, 18.6] }).success).toBe(false); // 0.6 deg tall
    expect(bad({ b: [73.0, 18.0, 73.5, 18.5] }).success).toBe(true); // exactly 0.5
    expect(bad({ z: [10, 17] }).success).toBe(false);
    expect(bad({ z: [12, 10] }).success).toBe(false);
    expect(bad({ b: [73.1, 18.5, 200, 18.8] }).success).toBe(false);
    expect(bad({ n: '' }).success).toBe(false);
  });

  it('round-trips between the model and the wire', () => {
    const parsed = MapAreaWireSchema.parse(area);
    expect(toMapAreaWire(toMapArea(parsed))).toEqual(parsed);
  });
});

describe('phases: place, task, or both', () => {
  const input = (over: object) =>
    CheckpointInputSchema.safeParse({ name: 'Flower', kind: 'other', ...over });

  it('a location checkpoint needs a place; the other types do not', () => {
    expect(input({}).success).toBe(false);
    expect(input({ type: 'checkpoint', task: 'x' }).success).toBe(false);
    expect(input({ lat: 18.6, lon: 73.2 }).success).toBe(true);
    for (const type of ['collect', 'photo', 'task']) {
      expect(input({ type }).success).toBe(true);
    }
    expect(input({ type: 'collect', lat: 18.6, lon: 73.2, task: 'Take a photo' }).success).toBe(
      true,
    );
  });

  it('radius, photo rule and region are validated', () => {
    const at = { lat: 18.6, lon: 73.2 };
    expect(input({ ...at, radiusM: 50 }).success).toBe(true);
    expect(input({ ...at, radiusM: 10 }).success).toBe(false);
    expect(input({ ...at, radiusM: 151 }).success).toBe(false);
    expect(input({ ...at, requirePhoto: true }).data?.requirePhoto).toBe(true);
    expect(input(at).data).toMatchObject({ type: 'checkpoint', requirePhoto: false });
    expect(input({ ...at, region: [73.1, 18.5, 73.3, 18.7] }).success).toBe(true);
    expect(input({ ...at, region: null }).success).toBe(true);
    expect(input({ ...at, region: [73.0, 18.0, 74.0, 19.0] }).success).toBe(false); // over 0.5 deg
    expect(input({ ...at, region: [73.3, 18.5, 73.1, 18.7] }).success).toBe(false); // inverted
  });

  it('latitude and longitude go together and stay in range', () => {
    expect(input({ type: 'task', lat: 18.6 }).success).toBe(false);
    expect(input({ type: 'task', lon: 73.2 }).success).toBe(false);
    expect(input({ lat: 91, lon: 73.2 }).success).toBe(false);
  });

  it('the task text is trimmed and limited', () => {
    expect(input({ type: 'task', task: ' Find a stream ' }).data?.task).toBe('Find a stream');
    expect(input({ type: 'task', task: 'x'.repeat(141) }).success).toBe(false);
  });

  const wire = {
    adv: 'a1',
    id: 'p1',
    rev: 1,
    ord: 0,
    name: 'Flower',
    kind: 'other',
    ts: 1,
  };

  it('accepts older wire phases (a place, no task) and place-less task phases', () => {
    expect(CheckpointWireSchema.safeParse({ ...wire, lat: 1, lon: 2 }).success).toBe(true);
    expect(CheckpointWireSchema.safeParse({ ...wire, tx: 'Collect a flower' }).success).toBe(true);
    expect(CheckpointWireSchema.safeParse({ ...wire, ty: 'photo' }).success).toBe(true);
  });

  it('refuses a phase with neither, or half a place; a removal needs neither', () => {
    expect(CheckpointWireSchema.safeParse(wire).success).toBe(false);
    expect(CheckpointWireSchema.safeParse({ ...wire, lat: 1, tx: 'x' }).success).toBe(false);
    expect(CheckpointWireSchema.safeParse({ ...wire, del: true }).success).toBe(true);
  });

  it('classifies a phase and says which ones the person must confirm', () => {
    expect(phaseKind({ lat: 1, lon: 2, task: null })).toBe('place');
    expect(phaseKind({ lat: null, lon: null, task: 'x' })).toBe('task');
    expect(phaseKind({ lat: 1, lon: 2, task: 'x' })).toBe('place_task');
    expect(needsSelfConfirmation({ lat: null, lon: null })).toBe(true);
    expect(needsSelfConfirmation({ lat: 1, lon: 2 })).toBe(false);
  });
});

describe('ordered and any-order progress', () => {
  const phases = [ph('c', 2), ph('a', 0), ph('b', 1), ph('x', 3, true)];
  const done = (...ids: string[]) => new Set(ids);

  it('any order allows every live phase and refuses unknown or removed ones', () => {
    expect(isPhaseUnlocked(false, phases, done(), 'c')).toBe(true);
    expect(isPhaseUnlocked(false, phases, done(), 'x')).toBe(false);
    expect(isPhaseUnlocked(false, phases, done(), 'nope')).toBe(false);
  });

  it('ordered unlocks a phase only when all earlier live phases are done', () => {
    expect(isPhaseUnlocked(true, phases, done(), 'a')).toBe(true);
    expect(isPhaseUnlocked(true, phases, done(), 'b')).toBe(false);
    expect(isPhaseUnlocked(true, phases, done('a'), 'b')).toBe(true);
    expect(isPhaseUnlocked(true, phases, done('a'), 'c')).toBe(false);
    expect(isPhaseUnlocked(true, phases, done('a', 'b'), 'c')).toBe(true);
  });

  it('a removed phase never blocks the ones after it', () => {
    const p = [ph('a', 0), ph('b', 1, true), ph('c', 2)];
    expect(isPhaseUnlocked(true, p, done('a'), 'c')).toBe(true);
  });

  it('finds the next phase and reports progress; finished needs at least one phase', () => {
    expect(nextPhase(phases, done('a'))?.id).toBe('b');
    expect(nextPhase(phases, done('a', 'b', 'c'))).toBeNull();
    expect(phaseProgress(phases, done('a'))).toEqual({ done: 1, total: 3, finished: false });
    expect(phaseProgress(phases, done('a', 'b', 'c', 'x'))).toEqual({
      done: 3,
      total: 3,
      finished: true,
    });
    expect(phaseProgress([], done())).toEqual({ done: 0, total: 0, finished: false });
  });
});

describe('the organizer enforces order on arrivals', () => {
  const group: Group = {
    id: 'g',
    name: 'Crew',
    role: 'organizer',
    organizer: 'off1org',
    status: 'active',
    createdAt: 0,
    joinedAt: 0,
    memberRev: 1,
  } as Group;
  const members: GroupMember[] = [
    {
      groupId: 'g',
      address: 'off1bob',
      name: 'Bob',
      role: 'member',
      state: 'active',
      rev: 1,
      updatedAt: 0,
    },
  ];
  const known = (over: Partial<KnownAdventure> = {}): KnownAdventure => ({
    groupId: 'g',
    owner: 'off1org',
    status: 'active',
    liveCheckpointIds: ['a', 'b', 'c'],
    senderState: 'joined',
    ordered: true,
    liveCheckpoints: [
      { id: 'a', ord: 0 },
      { id: 'b', ord: 1 },
      { id: 'c', ord: 2 },
    ],
    senderDoneCheckpointIds: [],
    ...over,
  });
  const reach = (checkpointId: string, adventure: KnownAdventure) =>
    authorizeAdventureInbound({
      kind: 'reached',
      group,
      members,
      from: 'off1bob',
      claimedAuthor: 'off1bob',
      adventure,
      checkpointId,
    });

  it('refuses an arrival that skips ahead in an ordered activity, then accepts it', () => {
    expect(reach('a', known()).ok).toBe(true);
    expect(reach('b', known()).ok).toBe(false);
    expect(reach('b', known({ senderDoneCheckpointIds: ['a'] })).ok).toBe(true);
    expect(reach('c', known({ senderDoneCheckpointIds: ['a'] })).ok).toBe(false);
  });

  it('accepts any phase when the activity is not ordered', () => {
    expect(reach('c', known({ ordered: false })).ok).toBe(true);
  });

  it('refuses arrivals and participation on an unpublished draft', () => {
    expect(reach('a', known({ status: 'draft' })).ok).toBe(false);
    expect(
      authorizeAdventureInbound({
        kind: 'participant',
        group,
        members,
        from: 'off1bob',
        claimedAuthor: 'off1bob',
        adventure: known({ status: 'draft' }),
      }).ok,
    ).toBe(false);
  });

  it('a finished participant still counts as a participant record', () => {
    const p = ParticipantSchema.safeParse({ adv: 'a1', pid: 'p', state: 'done', seq: 3, ts: 1 });
    expect(p.success).toBe(true);
  });
});

describe('activity persistence', () => {
  it('upgrading from v4 keeps existing checkpoints and makes places optional', async () => {
    const db = openNodeSqlite();
    await runMigrations(
      db,
      MIGRATIONS.filter(m => m.version <= 4),
    );
    await db.run(
      `INSERT INTO adventure_checkpoints(adventure_id, id, rev, ord, name, description, kind, lat, lon, deleted)
       VALUES('a','c1',2,0,'Viewpoint',NULL,'viewpoint',46.8,8.2,0)`,
    );
    await runMigrations(db);
    const repo = new AdventuresRepo(db);
    const [old] = await repo.checkpoints('a');
    expect(old).toMatchObject({ id: 'c1', rev: 2, lat: 46.8, lon: 8.2, task: null });
  });

  it('stores a task phase without a place, the order flag and the map area', async () => {
    const db = openNodeSqlite();
    await runMigrations(db);
    const repo = new AdventuresRepo(db);
    await repo.applyCheckpoint({
      adventureId: 'a',
      id: 'c2',
      rev: 1,
      ord: 1,
      name: 'Flower',
      description: null,
      kind: 'other',
      lat: null,
      lon: null,
      task: 'Collect a yellow flower',
      type: 'task',
      radiusM: null,
      requirePhoto: false,
      region: null,
      deleted: false,
    });
    const [cp] = await repo.checkpoints('a');
    expect(cp).toMatchObject({ lat: null, lon: null, task: 'Collect a yellow flower' });

    await repo.save({
      id: 'a',
      groupId: 'g',
      owner: 'off1org',
      name: 'Ridge walk',
      description: null,
      status: 'active',
      rev: 1,
      startLat: null,
      startLon: null,
      startLabel: null,
      ordered: true,
      region: { bbox: [73.1, 18.5, 73.4, 18.8], name: 'Sinhagad', minZoom: 10, maxZoom: 15 },
      createdAt: 1,
      startedAt: null,
      endedAt: null,
      tzOffsetMin: 0,
      progress: {
        resumedAt: null,
        activeMs: 0,
        distanceM: 0,
        offlineMapsCovered: null,
        networkUsed: false,
        meshExchangeAt: null,
      },
    });
    const a = await repo.get('a');
    expect(a?.ordered).toBe(true);
    expect(a?.region).toEqual({
      bbox: [73.1, 18.5, 73.4, 18.8],
      name: 'Sinhagad',
      minZoom: 10,
      maxZoom: 15,
    });
  });

  it('ignores a stored area that no longer validates instead of crashing', async () => {
    const db = openNodeSqlite();
    await runMigrations(db);
    const repo = new AdventuresRepo(db);
    await db.run(
      `INSERT INTO adventures(id, group_id, owner, name, status, rev, created_at, region)
       VALUES('b','g','o','x','active',1,1,'{"b":[0,0,9,9],"n":"huge","z":[1,2]}')`,
    );
    expect((await repo.get('b'))?.region).toBeNull();
  });
});

describe('the map area an activity needs', () => {
  it('pads the bounds of the places and names it', () => {
    const r = areaForPlaces(
      [
        { lat: 18.5, lon: 73.2 },
        { lat: 18.6, lon: 73.3 },
      ],
      'Flower hunt',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.area.bbox).toEqual([73.19, 18.49, 73.31, 18.61]);
      expect(r.area.name).toBe('Flower hunt');
      expect(MapAreaWireSchema.safeParse(toMapAreaWire(r.area)).success).toBe(true);
    }
  });

  it('a single place still gets an area, and a blank name gets a default', () => {
    const r = areaForPlaces([{ lat: 18.5, lon: 73.2 }], '  ');
    expect(r.ok && r.area.name).toBe('Activity area');
  });

  it('refuses places too far apart for one download, and no places at all', () => {
    expect(
      areaForPlaces(
        [
          { lat: 18.5, lon: 73.2 },
          { lat: 19.5, lon: 73.2 },
        ],
        'x',
      ),
    ).toEqual({ ok: false, reason: 'too_wide' });
    expect(areaForPlaces([], 'x')).toEqual({ ok: false, reason: 'no_places' });
  });
});

describe('where an activity stands for a person', () => {
  const progress = {
    resumedAt: null,
    activeMs: 0,
    distanceM: 0,
    offlineMapsCovered: null,
    networkUsed: false,
    meshExchangeAt: null,
    finishedAt: null,
  };
  const a = (
    status: Parameters<typeof activityStanding>[0]['status'],
    finishedAt: number | null = null,
  ) => ({
    status,
    endedAt: null,
    progress: { ...progress, finishedAt },
  });

  it('is waiting until they start, running after, finished at their last phase', () => {
    expect(activityStanding(a('draft'), null)).toBe('draft');
    expect(activityStanding(a('active'), null)).toBe('waiting');
    expect(activityStanding(a('active'), 'left')).toBe('waiting');
    expect(activityStanding(a('active'), 'joined')).toBe('running');
    expect(activityStanding(a('active'), 'done')).toBe('finished');
    expect(activityStanding(a('active', 5), 'joined')).toBe('finished');
  });

  it('a cancel ends it for people who did not finish, not for those who did', () => {
    expect(activityStanding(a('cancelled'), 'joined')).toBe('closed');
    expect(activityStanding(a('cancelled'), null)).toBe('closed');
    expect(activityStanding(a('cancelled', 5), 'done')).toBe('finished');
  });
});

describe('phase timeline states', () => {
  const phases = [ph('a', 0), ph('b', 1), ph('c', 2), ph('x', 3, true)];
  const states = (done: string[], ordered: boolean) =>
    phaseStatuses(phases, new Set(done), ordered).map(s => `${s.phase.id}:${s.status}`);

  it('ordered: done, then the current one, then locked', () => {
    expect(states([], true)).toEqual(['a:current', 'b:locked', 'c:locked']);
    expect(states(['a'], true)).toEqual(['a:done', 'b:current', 'c:locked']);
    expect(states(['a', 'b', 'c'], true)).toEqual(['a:done', 'b:done', 'c:done']);
  });

  it('any order: the first undone is current and the rest are open', () => {
    expect(states(['b'], false)).toEqual(['a:current', 'b:done', 'c:open']);
  });
});

describe('is an area already downloaded', () => {
  const region = {
    id: 'r',
    bbox: [0, 0, 10, 10] as [number, number, number, number],
    minZoom: 0,
    maxZoom: 15,
  };
  it('only when the whole box is inside installed regions', () => {
    expect(boxIsInstalled([region], [1, 1, 9, 9])).toBe(true);
    expect(boxIsInstalled([region], [5, 5, 12, 9])).toBe(false);
    expect(boxIsInstalled([], [1, 1, 9, 9])).toBe(false);
  });
  it('two regions that together cover it are not enough unless each corner is inside one', () => {
    const right = { ...region, id: 'r2', bbox: [9, 0, 20, 10] as [number, number, number, number] };
    expect(boxIsInstalled([region, right], [1, 1, 15, 9])).toBe(true);
  });
});
