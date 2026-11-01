// Hermes lacks these globals. Import this module before anything else in index.js.
import { getRandomValues } from 'expo-crypto';
import 'web-streams-polyfill/polyfill';

// `ulid` (record ids) looks for crypto.getRandomValues and throws without it. Back it with the
// native secure generator.
const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== 'function') {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues };
}
