import {
  FADE_AFTER_MS,
  LAST_SEEN_AFTER_MS,
  agoText,
  freshnessOf,
  meshStatus,
  presenceOf,
  presenceText,
  sortByPresence,
} from '../src/domain/groups/presence';
import {
  cardinalOf,
  clampPace,
  etaMinutes,
  formatDistanceIn,
  formatEta,
} from '../src/domain/geo/pace';

const NOW = 10_000_000;

describe('freshness thresholds', () => {
  it('is live under 5 min, fading to 15 min, then last seen', () => {
    expect(freshnessOf(NOW, NOW - (FADE_AFTER_MS - 1), true)).toBe('live');
    expect(freshnessOf(NOW, NOW - FADE_AFTER_MS, false)).toBe('fading');
    expect(freshnessOf(NOW, NOW - (LAST_SEEN_AFTER_MS - 1), false)).toBe('fading');
    expect(freshnessOf(NOW, NOW - LAST_SEEN_AFTER_MS, false)).toBe('last_seen');
  });
  it('never heard is never, unless reachable now', () => {
    expect(freshnessOf(NOW, null, false)).toBe('never');
    expect(freshnessOf(NOW, null, true)).toBe('live');
  });
  it('a future timestamp (clock skew) is treated as just now', () => {
    expect(presenceOf(NOW, { address: 'a', reachable: false, lastHeardAt: NOW + 5000 }).ageMs).toBe(
      0,
    );
  });
});

describe('text', () => {
  it('formats ages', () => {
    expect(agoText(30_000)).toBe('just now');
    expect(agoText(2 * 60_000)).toBe('2 min ago');
    expect(agoText(3 * 3_600_000)).toBe('3 h ago');
    expect(agoText(2 * 86_400_000)).toBe('2 d ago');
  });
  it('says what is known', () => {
    const p = (reachable: boolean, lastHeardAt: number | null) =>
      presenceText(presenceOf(NOW, { address: 'a', reachable, lastHeardAt }));
    expect(p(true, NOW - 1000)).toBe('In range');
    expect(p(false, NOW - 60_000)).toBe('Heard 1 min ago');
    expect(p(false, NOW - 14 * 60_000)).toBe('Last heard 14 min ago');
    expect(p(false, null)).toBe('Not heard yet');
  });
});

describe('sortByPresence', () => {
  it('reachable first, then recency, never last', () => {
    const mk = (address: string, reachable: boolean, lastHeardAt: number | null) => ({
      presence: presenceOf(NOW, { address, reachable, lastHeardAt }),
    });
    const sorted = sortByPresence([
      mk('never', false, null),
      mk('old', false, NOW - 20 * 60_000),
      mk('near-old', true, NOW - 60_000),
      mk('recent', false, NOW - 2 * 60_000),
      mk('near-new', true, NOW - 1000),
    ]).map(x => x.presence.address);
    expect(sorted).toEqual(['near-new', 'near-old', 'recent', 'old', 'never']);
  });
});

describe('meshStatus', () => {
  const base = { running: true, bluetoothOn: true, hasGroup: true, total: 4, reachable: 3 };
  it('is green only when someone is reachable', () => {
    expect(meshStatus(base)).toMatchObject({ tone: 'good', label: '3 of 4 in range' });
    expect(meshStatus({ ...base, reachable: 0 }).tone).toBe('warn');
    expect(meshStatus({ ...base, reachable: 0 }).label).toBe('Nobody in range · 0 of 4');
  });
  it('never claims connection when the mesh is off or Bluetooth is off', () => {
    expect(meshStatus({ ...base, running: false })).toMatchObject({
      tone: 'bad',
      label: 'Mesh off',
    });
    expect(meshStatus({ ...base, running: false, bluetoothOn: false }).label).toBe('Bluetooth off');
  });
  it('handles no group and an empty group', () => {
    expect(meshStatus({ ...base, hasGroup: false }).label).toBe('Mesh on · no group');
    expect(meshStatus({ ...base, total: 0, reachable: 0 }).tone).toBe('warn');
  });
});

describe('pace and units', () => {
  it('computes ETA at a pace, at least one minute', () => {
    expect(etaMinutes(4000, 4)).toBe(60);
    expect(etaMinutes(10, 4)).toBe(1);
    expect(etaMinutes(null, 4)).toBeNull();
    expect(etaMinutes(2000, 2)).toBe(60);
  });
  it('clamps absurd pace', () => {
    expect(clampPace(0)).toBe(1);
    expect(clampPace(50)).toBe(8);
    expect(clampPace(NaN)).toBe(4);
  });
  it('formats ETA', () => {
    expect(formatEta(45)).toBe('45 min');
    expect(formatEta(60)).toBe('1 h');
    expect(formatEta(95)).toBe('1 h 35 min');
  });
  it('formats imperial and metric', () => {
    expect(formatDistanceIn(340, 'metric')).toBe('340 m');
    expect(formatDistanceIn(1500, 'metric')).toBe('1.50 km');
    expect(formatDistanceIn(100, 'imperial')).toBe('328 ft');
    expect(formatDistanceIn(1609.344, 'imperial')).toBe('1.00 mi');
  });
  it('names the cardinal', () => {
    expect(cardinalOf(0)).toBe('N');
    expect(cardinalOf(359)).toBe('N');
    expect(cardinalOf(92)).toBe('E');
    expect(cardinalOf(-90)).toBe('W');
  });
});
