import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';

export const INVITE_VERSION = 1;
/** MESH_PROTOCOL.md section 6: default token lifetime. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const NEARBY_WINDOW_MS = 10 * 60 * 1000;
export const TOKEN_BYTES = 16;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 128-bit random token, RFC 4648 base32 without padding (26 characters, topic-safe). */
export function generateToken(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(TOKEN_BYTES);
  if (bytes.length !== TOKEN_BYTES) {
    throw new Error('random source returned the wrong length');
  }
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    out += B32[(value << (5 - bits)) & 31];
  }
  return out;
}

export const TOKEN_PATTERN = /^[A-Z2-7]{26}$/;

/** Only the hash is stored on the organizer's device (the token is a bearer secret). */
export function hashToken(token: string): string {
  return Array.from(sha256(new TextEncoder().encode(token)), x =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}

export type InviteRecord = {
  groupId: string;
  expiresAt: number;
  status: 'open' | 'used' | 'revoked';
  usedBy: string | null;
};

export type InviteCheck =
  | { ok: true; rejoin: boolean }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'used' | 'wrong_group' };

/** A used token only admits the device that used it (a retry after a dropped connection). */
export function checkInvite(
  invite: InviteRecord | null,
  groupId: string,
  sender: string,
  now: number,
): InviteCheck {
  if (!invite) {
    return { ok: false, reason: 'unknown' };
  }
  if (invite.groupId !== groupId) {
    return { ok: false, reason: 'wrong_group' };
  }
  if (invite.status === 'revoked') {
    return { ok: false, reason: 'revoked' };
  }
  if (now > invite.expiresAt) {
    return { ok: false, reason: 'expired' };
  }
  if (invite.status === 'used') {
    return invite.usedBy === sender ? { ok: true, rejoin: true } : { ok: false, reason: 'used' };
  }
  return { ok: true, rejoin: false };
}

const InviteLinkSchema = z.object({
  v: z.literal(String(INVITE_VERSION)),
  g: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  o: z.string().min(1).max(128),
  t: z.string().regex(TOKEN_PATTERN),
  n: z.string().trim().min(1).max(60),
});

export type Invite = { groupId: string; organizer: string; token: string; groupName: string };

export function buildInviteLink(i: Invite): string {
  const q = [
    `v=${INVITE_VERSION}`,
    `g=${encodeURIComponent(i.groupId)}`,
    `o=${encodeURIComponent(i.organizer)}`,
    `t=${encodeURIComponent(i.token)}`,
    `n=${encodeURIComponent(i.groupName)}`,
  ];
  return `muster://join?${q.join('&')}`;
}

export type InviteParseError = 'not_an_invite' | 'unsupported_version' | 'malformed';

/** Parses scanned or pasted text. Hermes has no complete `URL`, so this is a small manual parser. */
export function parseInviteLink(
  text: string,
): { ok: true; invite: Invite } | { ok: false; error: InviteParseError } {
  // Invitations made before the rename (TrailMesh) use the old scheme; keep reading them.
  const m = /^(?:muster|trailmesh):\/\/join\?(.*)$/.exec(text.trim());
  if (!m || m[1] === undefined) {
    return { ok: false, error: 'not_an_invite' };
  }
  const params: Record<string, string> = {};
  for (const pair of m[1].split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 1) {
      return { ok: false, error: 'malformed' };
    }
    try {
      params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return { ok: false, error: 'malformed' };
    }
  }
  if (params.v !== undefined && params.v !== String(INVITE_VERSION)) {
    return { ok: false, error: 'unsupported_version' };
  }
  const parsed = InviteLinkSchema.safeParse(params);
  if (!parsed.success) {
    return { ok: false, error: 'malformed' };
  }
  const { g, o, t, n } = parsed.data;
  return { ok: true, invite: { groupId: g, organizer: o, token: t, groupName: n } };
}
