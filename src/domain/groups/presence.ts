/** How recently each group member was heard over the mesh. Presence only: no positions exist yet. */

export const FADE_AFTER_MS = 5 * 60_000;
export const LAST_SEEN_AFTER_MS = 15 * 60_000;

export type Freshness = 'live' | 'fading' | 'last_seen' | 'never';

export type PresenceInput = {
  address: string;
  /** Linked or advertising right now, or holding an active group subscription. */
  reachable: boolean;
  /** Latest of peer sighting and received group message; null when never heard. */
  lastHeardAt: number | null;
};

export type Presence = PresenceInput & { freshness: Freshness; ageMs: number | null };

export function freshnessOf(
  now: number,
  lastHeardAt: number | null,
  reachable: boolean,
): Freshness {
  if (lastHeardAt === null) {
    return reachable ? 'live' : 'never';
  }
  const age = Math.max(0, now - lastHeardAt);
  return age < FADE_AFTER_MS ? 'live' : age < LAST_SEEN_AFTER_MS ? 'fading' : 'last_seen';
}

export function presenceOf(now: number, p: PresenceInput): Presence {
  return {
    ...p,
    freshness: freshnessOf(now, p.lastHeardAt, p.reachable),
    ageMs: p.lastHeardAt === null ? null : Math.max(0, now - p.lastHeardAt),
  };
}

/** "just now", "2 min ago", "3 h ago", "2 d ago". */
export function agoText(ageMs: number): string {
  const min = Math.floor(Math.max(0, ageMs) / 60_000);
  if (min < 1) {
    return 'just now';
  }
  if (min < 60) {
    return `${min} min ago`;
  }
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export function presenceText(p: Presence): string {
  if (p.ageMs === null) {
    return p.reachable ? 'In range' : 'Not heard yet';
  }
  if (p.freshness === 'live') {
    return p.reachable ? 'In range' : `Heard ${agoText(p.ageMs)}`;
  }
  return `Last heard ${agoText(p.ageMs)}`;
}

const RANK: Record<Freshness, number> = { live: 0, fading: 1, last_seen: 2, never: 3 };

/** Reachable first, then most recently heard; never-heard last. Stable for equal keys. */
export function sortByPresence<T extends { presence: Presence }>(items: T[]): T[] {
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => {
      const pa = a.x.presence;
      const pb = b.x.presence;
      if (pa.reachable !== pb.reachable) {
        return pa.reachable ? -1 : 1;
      }
      if (RANK[pa.freshness] !== RANK[pb.freshness]) {
        return RANK[pa.freshness] - RANK[pb.freshness];
      }
      return (pa.ageMs ?? Infinity) - (pb.ageMs ?? Infinity) || a.i - b.i;
    })
    .map(e => e.x);
}

export type MeshStatus = {
  tone: 'good' | 'warn' | 'bad';
  label: string;
  /** Plain-language explanation for the status sheet. */
  detail: string;
};

/**
 * One honest line for the mesh. Green only when someone is actually reachable: a running mesh with
 * nobody in range is a warning, not "Connected".
 */
export function meshStatus(i: {
  running: boolean;
  bluetoothOn: boolean;
  /** Group members other than me. */
  total: number;
  reachable: number;
  hasGroup: boolean;
}): MeshStatus {
  if (!i.running) {
    return {
      tone: 'bad',
      label: i.bluetoothOn ? 'Mesh off' : 'Bluetooth off',
      detail: i.bluetoothOn
        ? 'The mesh is not running, so you will not receive group updates. Start it from Mesh diagnostics.'
        : 'Bluetooth is off, so you will not receive group updates. Turn Bluetooth on in system Settings.',
    };
  }
  if (!i.hasGroup) {
    return {
      tone: 'warn',
      label: 'Mesh on · no group',
      detail: 'The mesh is running but you have not joined a group yet.',
    };
  }
  if (i.total === 0) {
    return {
      tone: 'warn',
      label: 'Mesh on · nobody else yet',
      detail: 'Your group has no other members yet.',
    };
  }
  if (i.reachable === 0) {
    return {
      tone: 'warn',
      label: `Nobody in range · 0 of ${i.total}`,
      detail:
        'No one in your group is within range right now. You will get updates when someone comes close.',
    };
  }
  return {
    tone: 'good',
    label: `${i.reachable} of ${i.total} in range`,
    detail: `${i.reachable} of ${i.total} group members are reachable right now.`,
  };
}
