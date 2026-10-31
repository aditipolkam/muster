import {
  bboxAreaKm2,
  bboxContains,
  bboxOverlaps,
  bearingDeg,
  circleRing,
  destination,
  distanceM,
  formatBytes,
  formatCoord,
  formatDistance,
  isValidLatLon,
  normalizeLon,
  sectorRing,
} from '../src/domain/geo';

describe('geo', () => {
  const london = { lat: 51.5074, lon: -0.1278 };
  const paris = { lat: 48.8566, lon: 2.3522 };

  it('computes great-circle distance (London-Paris ~343.5 km)', () => {
    expect(distanceM(london, paris) / 1000).toBeCloseTo(343.5, 0);
  });

  it('is symmetric and zero for identical points', () => {
    expect(distanceM(london, london)).toBe(0);
    expect(distanceM(london, paris)).toBeCloseTo(distanceM(paris, london), 6);
  });

  it('handles antipodal and dateline points without NaN', () => {
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(
      Math.PI * 6371008.8,
      -2,
    );
    expect(distanceM({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 })).toBeCloseTo(22239, -2);
    expect(Number.isNaN(distanceM({ lat: 90, lon: 0 }, { lat: -90, lon: 0 }))).toBe(false);
  });

  it('computes initial bearings', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 5);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 5);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 5);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 5);
    expect(bearingDeg(london, paris)).toBeCloseTo(148.1, 0);
  });

  it('destination is the inverse of distance+bearing', () => {
    const p = destination(london, 148.1, 343_500);
    expect(distanceM(p, paris)).toBeLessThan(2000);
    const q = destination({ lat: 10, lon: 10 }, 45, 1234);
    expect(distanceM({ lat: 10, lon: 10 }, q)).toBeCloseTo(1234, 1);
  });

  it('validates lat/lon', () => {
    expect(isValidLatLon(0, 0)).toBe(true);
    expect(isValidLatLon(90.0001, 0)).toBe(false);
    expect(isValidLatLon(0, 180.1)).toBe(false);
    expect(isValidLatLon(NaN, 0)).toBe(false);
  });

  it('normalises longitude', () => {
    expect(normalizeLon(190)).toBeCloseTo(-170);
    expect(normalizeLon(-190)).toBeCloseTo(170);
    expect(normalizeLon(180)).toBe(180);
    expect(normalizeLon(10)).toBe(10);
  });

  it('bbox helpers', () => {
    const b: [number, number, number, number] = [-1, -1, 1, 1];
    expect(bboxContains(b, { lat: 0, lon: 0 })).toBe(true);
    expect(bboxContains(b, { lat: 1, lon: 1 })).toBe(true);
    expect(bboxContains(b, { lat: 1.01, lon: 0 })).toBe(false);
    expect(bboxOverlaps(b, [0.5, 0.5, 2, 2])).toBe(true);
    expect(bboxOverlaps(b, [1.1, 1.1, 2, 2])).toBe(false);
    expect(bboxAreaKm2([0, 0, 1, 1])).toBeCloseTo(12308, -2);
  });

  it('builds closed rings of the requested radius', () => {
    const ring = circleRing(london, 100, 16);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
    for (const [lon, lat] of ring) {
      expect(distanceM(london, { lat, lon })).toBeCloseTo(100, 0);
    }
    const sector = sectorRing(london, 0, 100, 60, 6);
    expect(sector[0]).toEqual([london.lon, london.lat]);
    expect(sector[sector.length - 1]).toEqual([london.lon, london.lat]);
  });

  it('formats values for people', () => {
    expect(formatDistance(42.4)).toBe('42 m');
    expect(formatDistance(1500)).toBe('1.50 km');
    expect(formatDistance(25000)).toBe('25.0 km');
    expect(formatDistance(NaN)).toBe('-');
    expect(formatCoord({ lat: -33.8688, lon: 151.2093 }, 4)).toBe('33.8688° S, 151.2093° E');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(27017895)).toBe('25.8 MB');
    expect(formatBytes(-1)).toBe('-');
  });
});
