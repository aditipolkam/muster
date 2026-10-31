import {
  MAX_ENVELOPE_BYTES,
  PROTOCOL_MAJOR,
  createEnvelope,
  decodeEnvelope,
  encodeEnvelope,
} from '../src/mesh/envelope';
import { buildTopic, diagTopics, isValidTopic, patternMatches } from '../src/mesh/topics';
import { SeenIds } from '../src/mesh/SeenIds';
import { utf8Length } from '../src/shared/utf8';
import { ManualClock, testId } from '../src/testing/services';

const deps = { clock: new ManualClock(), newId: testId };

describe('event envelope (MESH_PROTOCOL.md section 4)', () => {
  it('creates a v1 envelope with the documented fields', () => {
    const e = createEnvelope({ type: 'ping', author: 'off1abc', payload: { text: 'hi' } }, deps);
    expect(e).toEqual({
      tm: PROTOCOL_MAJOR,
      id: expect.stringMatching(/^01TEST/),
      t: 'ping',
      a: 'off1abc',
      ts: deps.clock.now(),
      p: { text: 'hi' },
    });
  });

  it('round-trips through JSON unchanged, including unicode', () => {
    const e = createEnvelope(
      { type: 'ping', author: 'off1abc', payload: { text: 'héllo ⛰️ 日本' } },
      deps,
    );
    const wire = encodeEnvelope(e);
    expect(wire.ok).toBe(true);
    if (!wire.ok) {
      return;
    }
    const back = decodeEnvelope(wire.value);
    expect(back).toEqual({ ok: true, value: e });
  });

  it('keeps unknown payload fields and unknown event types (forward compatibility)', () => {
    const raw = JSON.stringify({
      tm: 1,
      id: 'x',
      t: 'future-type',
      a: '',
      ts: 1,
      p: { newField: [1, 2] },
      extra: true,
    });
    const r = decodeEnvelope(raw);
    expect(r.ok && r.value.t).toBe('future-type');
    expect(r.ok && r.value.p).toEqual({ newField: [1, 2] });
  });

  it('defaults a missing payload to {}', () => {
    const r = decodeEnvelope(JSON.stringify({ tm: 1, id: 'x', t: 'ping', a: '', ts: 1 }));
    expect(r.ok && r.value.p).toEqual({});
  });

  it('refuses to encode over the 2 KB budget, measured in bytes not characters', () => {
    const big = createEnvelope(
      { type: 'ping', author: 'a', payload: { text: '日'.repeat(800) } },
      deps,
    );
    const r = encodeEnvelope(big);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('envelope.too_large');
    expect(utf8Length('日'.repeat(800))).toBe(2400);
  });

  it('accepts an envelope right under the budget', () => {
    const e = createEnvelope(
      { type: 'ping', author: 'a', payload: { text: 'x'.repeat(1800) } },
      deps,
    );
    const r = encodeEnvelope(e);
    expect(r.ok && utf8Length(r.value)).toBeLessThanOrEqual(MAX_ENVELOPE_BYTES);
  });

  it.each([
    ['not json', '{nope', 'not_json'],
    ['array', '[]', 'invalid_shape'],
    ['missing id', JSON.stringify({ tm: 1, t: 'x', a: '', ts: 1 }), 'invalid_shape'],
    ['empty type', JSON.stringify({ tm: 1, id: 'x', t: '', a: '', ts: 1 }), 'invalid_shape'],
    ['negative ts', JSON.stringify({ tm: 1, id: 'x', t: 'x', a: '', ts: -1 }), 'invalid_shape'],
    [
      'non-integer major',
      JSON.stringify({ tm: 1.5, id: 'x', t: 'x', a: '', ts: 1 }),
      'invalid_shape',
    ],
    [
      'payload not an object',
      JSON.stringify({ tm: 1, id: 'x', t: 'x', a: '', ts: 1, p: 5 }),
      'invalid_shape',
    ],
    ['too large', 'x'.repeat(MAX_ENVELOPE_BYTES + 1), 'too_large'],
  ])('rejects untrusted input: %s', (_name, raw, reason) => {
    const r = decodeEnvelope(raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.reason).toBe(reason);
  });

  it('refuses a higher protocol major so the app can ask for an update', () => {
    const r = decodeEnvelope(JSON.stringify({ tm: 2, id: 'x', t: 'x', a: '', ts: 1, p: {} }));
    expect(!r.ok && r.error.reason).toBe('unsupported_version');
  });
});

describe('topics (MESH_PROTOCOL.md section 2)', () => {
  it('builds tm/<v>/<scope>/<channel>[/<detail>]', () => {
    expect(buildTopic('diag', 'event')).toEqual({ ok: true, value: 'tm/1/diag/event' });
    expect(buildTopic('01J0ABC', 'live', 'off1xyz')).toEqual({
      ok: true,
      value: 'tm/1/01J0ABC/live/off1xyz',
    });
  });

  it('refuses characters the SDK topic charset does not allow (no colon, no spaces)', () => {
    expect(buildTopic('group:abc', 'event').ok).toBe(false);
    expect(buildTopic('diag', 'a b').ok).toBe(false);
    expect(buildTopic('diag', '').ok).toBe(false);
  });

  it('validates publish topics and subscription patterns separately', () => {
    expect(isValidTopic(diagTopics.event, false)).toBe(true);
    expect(isValidTopic(diagTopics.all, false)).toBe(false);
    expect(isValidTopic(diagTopics.all, true)).toBe(true);
    expect(isValidTopic('other/1/x', true)).toBe(false);
    expect(isValidTopic(`tm/1/${'a'.repeat(200)}`, false)).toBe(false);
  });

  it('matches trailing-star patterns only', () => {
    expect(patternMatches(diagTopics.all, diagTopics.event)).toBe(true);
    expect(patternMatches(diagTopics.event, diagTopics.state)).toBe(false);
    expect(patternMatches(diagTopics.event, diagTopics.event)).toBe(true);
  });
});

describe('SeenIds', () => {
  it('reports duplicates and evicts the oldest beyond capacity', () => {
    const s = new SeenIds(3);
    expect(s.add('a')).toBe(true);
    expect(s.add('a')).toBe(false);
    s.add('b');
    s.add('c');
    s.add('d'); // evicts a
    expect(s.size).toBe(3);
    expect(s.has('a')).toBe(false);
    expect(s.add('a')).toBe(true);
  });
});
