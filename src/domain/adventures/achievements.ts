/**
 * Achievement definitions and the pure engine that decides which are earned.
 *
 * Everything here is judged only from facts recorded on this device (see `AchievementFacts`). They
 * are local records, not independently verified claims, and the UI says so.
 */

export type AchievementIcon =
  | 'summit'
  | 'trail'
  | 'compass'
  | 'forest'
  | 'camp'
  | 'flag'
  | 'mesh'
  | 'map';
export type AchievementCategory = 'exploration' | 'group' | 'offline';

export type AchievementDef = {
  id: string;
  name: string;
  description: string;
  /** Plain-language unlock criteria, shown for locked badges. */
  requirement: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  /** Count to reach, for badges that are a running total. */
  target: number | null;
};

/** Minimum running time for "Off the Grid", so a quick start-and-stop cannot earn it. */
export const OFF_GRID_MIN_ACTIVE_MS = 30 * 60_000;

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_adventure',
    name: 'First Adventure',
    description: 'You set out and finished your first adventure.',
    requirement: 'Complete your first adventure.',
    category: 'exploration',
    icon: 'trail',
    target: 1,
  },
  {
    id: 'trail_starter',
    name: 'Trail Starter',
    description: 'Three adventures behind you.',
    requirement: 'Complete three adventures.',
    category: 'exploration',
    icon: 'trail',
    target: 3,
  },
  {
    id: 'explorer',
    name: 'Explorer',
    description: 'Ten adventures, each with its own story.',
    requirement: 'Complete ten adventures.',
    category: 'exploration',
    icon: 'compass',
    target: 10,
  },
  {
    id: 'first_summit',
    name: 'First Summit',
    description: 'You reached a summit on one of your adventures.',
    requirement: 'Complete an adventure and reach a checkpoint marked as a summit.',
    category: 'exploration',
    icon: 'summit',
    target: null,
  },
  {
    id: 'trail_collector',
    name: 'Trail Collector',
    description: 'Ten different places explored.',
    requirement: 'Reach ten different checkpoints.',
    category: 'exploration',
    icon: 'forest',
    target: 10,
  },
  {
    id: 'weekend_wanderer',
    name: 'Weekend Wanderer',
    description: 'Time outside on three different weekends.',
    requirement: 'Complete adventures on three different weekends.',
    category: 'exploration',
    icon: 'camp',
    target: 3,
  },
  {
    id: 'first_expedition',
    name: 'First Expedition',
    description: 'You finished an adventure together.',
    requirement: 'Complete an adventure that at least two people took part in.',
    category: 'group',
    icon: 'flag',
    target: null,
  },
  {
    id: 'together_we_go',
    name: 'Together We Go',
    description: 'Five group adventures completed.',
    requirement: 'Complete five group adventures.',
    category: 'group',
    icon: 'flag',
    target: 5,
  },
  {
    id: 'rally_point',
    name: 'Rally Point',
    description: 'A meeting point that your group really received.',
    requirement:
      'Share a meeting point and have a member acknowledge it, or acknowledge one shared with you.',
    category: 'group',
    icon: 'flag',
    target: null,
  },
  {
    id: 'trail_companions',
    name: 'Trail Companions',
    description: 'The same group, more than once.',
    requirement: 'Complete two or more adventures with the same group.',
    category: 'group',
    icon: 'forest',
    target: 2,
  },
  {
    id: 'off_the_grid',
    name: 'Off the Grid',
    description: 'An adventure that ran entirely on saved data.',
    requirement:
      'Complete a 30-minute adventure on downloaded maps during which TrailMesh used no network.',
    category: 'offline',
    icon: 'camp',
    target: null,
  },
  {
    id: 'mesh_connected',
    name: 'Mesh Connected',
    description: 'A message from your group reached you over the mesh.',
    requirement: 'During an adventure, receive a message from a group member over the mesh.',
    category: 'offline',
    icon: 'mesh',
    target: null,
  },
  {
    id: 'local_explorer',
    name: 'Local Explorer',
    description: 'An adventure planned and finished on downloaded maps.',
    requirement: 'Complete an adventure whose places are all inside your downloaded map regions.',
    category: 'offline',
    icon: 'map',
    target: null,
  },
];

export const achievementById = (id: string): AchievementDef | undefined =>
  ACHIEVEMENTS.find(a => a.id === id);

export type AdventureFact = {
  id: string;
  groupId: string | null;
  endedAt: number;
  tzOffsetMin: number;
  /** People who joined, including this device. */
  joinedCount: number;
  qualifying: boolean;
  summitReached: boolean;
  offlineMapsCovered: boolean;
  networkUsed: boolean;
  activeMs: number;
};

export type AchievementFacts = {
  /** Completed adventures only. */
  completed: AdventureFact[];
  /** Distinct checkpoints this person has reached, across all adventures. */
  distinctCheckpoints: number;
  /** A mesh message from a group member arrived while some adventure was running. */
  meshExchanged: boolean;
  /** A meeting point was acknowledged by or for another member. */
  rallyPoint: boolean;
};

export type AchievementProgress = {
  id: string;
  met: boolean;
  current: number;
  target: number | null;
  /** The adventure that decided it, when one did. */
  evidenceAdventureId: string | null;
};

/** The Saturday (as `YYYY-MM-DD`) of the weekend `ms` falls on, or null on a weekday. */
export function weekendKey(ms: number, tzOffsetMin: number): string | null {
  const local = new Date(ms - tzOffsetMin * 60_000);
  const dow = local.getUTCDay();
  if (dow !== 6 && dow !== 0) {
    return null;
  }
  const sat = new Date(local.getTime() - (dow === 0 ? 86_400_000 : 0));
  return sat.toISOString().slice(0, 10);
}

export function evaluate(facts: AchievementFacts): AchievementProgress[] {
  const done = facts.completed.filter(a => a.qualifying).sort((a, b) => a.endedAt - b.endedAt);
  const groupDone = done.filter(a => a.groupId !== null && a.joinedCount >= 2);
  const weekends = new Set<string>();
  const weekendFirst = new Map<string, string>();
  for (const a of done) {
    const k = weekendKey(a.endedAt, a.tzOffsetMin);
    if (k && !weekends.has(k)) {
      weekends.add(k);
      weekendFirst.set(k, a.id);
    }
  }
  const byGroup = new Map<string, AdventureFact[]>();
  for (const a of groupDone) {
    byGroup.set(a.groupId as string, [...(byGroup.get(a.groupId as string) ?? []), a]);
  }
  const bestGroup = [...byGroup.values()].sort((x, y) => y.length - x.length)[0] ?? [];
  const nth = (list: AdventureFact[], n: number) => list[n - 1]?.id ?? null;
  const count = (id: string, current: number, target: number, evidence: string | null) => ({
    id,
    met: current >= target,
    current: Math.min(current, target),
    target,
    evidenceAdventureId: current >= target ? evidence : null,
  });
  const flag = (id: string, hit: AdventureFact | null | undefined, extra = false) => ({
    id,
    met: !!hit || extra,
    current: hit || extra ? 1 : 0,
    target: null,
    evidenceAdventureId: hit?.id ?? null,
  });
  const weekendIds = [...weekendFirst.values()];
  return [
    count('first_adventure', done.length, 1, nth(done, 1)),
    count('trail_starter', done.length, 3, nth(done, 3)),
    count('explorer', done.length, 10, nth(done, 10)),
    flag(
      'first_summit',
      done.find(a => a.summitReached),
    ),
    count('trail_collector', facts.distinctCheckpoints, 10, null),
    count('weekend_wanderer', weekends.size, 3, weekendIds[2] ?? null),
    flag('first_expedition', groupDone[0]),
    count('together_we_go', groupDone.length, 5, nth(groupDone, 5)),
    flag('rally_point', null, facts.rallyPoint),
    count('trail_companions', bestGroup.length, 2, nth(bestGroup, 2)),
    flag(
      'off_the_grid',
      done.find(
        a => a.offlineMapsCovered && !a.networkUsed && a.activeMs >= OFF_GRID_MIN_ACTIVE_MS,
      ),
    ),
    flag('mesh_connected', null, facts.meshExchanged),
    flag(
      'local_explorer',
      done.find(a => a.offlineMapsCovered),
    ),
  ];
}
