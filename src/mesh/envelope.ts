import { z } from 'zod';
import type { Clock } from '../shared/clock';
import { AppError, appError, err, ok, Result } from '../shared/result';
import { utf8Length } from '../shared/utf8';

/** MESH_PROTOCOL.md section 4. Wire major version. */
export const PROTOCOL_MAJOR = 1;
/** Size budget for an event envelope (MESH_PROTOCOL.md section 4). */
export const MAX_ENVELOPE_BYTES = 2048;

export const EnvelopeSchema = z.object({
  tm: z.number().int().min(1),
  id: z.string().min(1).max(64),
  t: z.string().min(1).max(32),
  a: z.string().max(128),
  ts: z.number().int().nonnegative(),
  p: z.record(z.string(), z.unknown()).default({}),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

export type DecodeFailure = 'too_large' | 'not_json' | 'invalid_shape' | 'unsupported_version';

export type DecodeError = AppError & { reason: DecodeFailure };

function decodeError(reason: DecodeFailure, message: string): DecodeError {
  return {
    ...appError(`envelope.${reason}`, 'Received an invalid mesh message.', { message }),
    reason,
  };
}

export function createEnvelope(
  input: { type: string; author: string; payload?: Record<string, unknown> },
  deps: { clock: Clock; newId: () => string },
): Envelope {
  return {
    tm: PROTOCOL_MAJOR,
    id: deps.newId(),
    t: input.type,
    a: input.author,
    ts: deps.clock.now(),
    p: input.payload ?? {},
  };
}

/** Serialises and validates. Refuses anything the receiver would refuse. */
export function encodeEnvelope(env: Envelope): Result<string> {
  const parsed = EnvelopeSchema.safeParse(env);
  if (!parsed.success) {
    return err(
      appError('envelope.invalid', 'Message is malformed.', { message: parsed.error.message }),
    );
  }
  const json = JSON.stringify(parsed.data);
  if (utf8Length(json) > MAX_ENVELOPE_BYTES) {
    return err(
      appError('envelope.too_large', `Message is larger than ${MAX_ENVELOPE_BYTES} bytes.`),
    );
  }
  return ok(json);
}

/**
 * Untrusted input from the mesh: bound size, parse, validate. Unknown `t` is accepted (forward
 * compatibility); a higher major is refused so the caller can tell the user to update.
 */
export function decodeEnvelope(raw: string): Result<Envelope, DecodeError> {
  if (utf8Length(raw) > MAX_ENVELOPE_BYTES) {
    return err(decodeError('too_large', 'envelope exceeds size budget'));
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err(decodeError('not_json', 'body is not JSON'));
  }
  const parsed = EnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return err(decodeError('invalid_shape', parsed.error.message));
  }
  if (parsed.data.tm > PROTOCOL_MAJOR) {
    return err(
      decodeError('unsupported_version', `protocol major ${parsed.data.tm} not supported`),
    );
  }
  return ok(parsed.data);
}
