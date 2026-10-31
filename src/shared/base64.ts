const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128).fill(255);
for (let i = 0; i < ALPHABET.length; i++) {
  LOOKUP[ALPHABET.charCodeAt(i)] = i;
}

/** Decodes standard base64 without relying on atob (large payloads, Hermes-safe). */
export function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && b64.charCodeAt(len - 1) === 61) {
    len--;
  }
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const code = b64.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code] : 255;
    if (v === undefined || v === 255) {
      throw new Error('invalid base64 character');
    }
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
      buf &= (1 << bits) - 1;
    }
  }
  return out;
}
