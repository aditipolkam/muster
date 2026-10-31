import { appError, err, ok, Result } from '../shared/result';

/**
 * Logical topic grammar, MESH_PROTOCOL.md section 2: `tm/<v>/<groupShort>/<channel>[/<detail>]`.
 *
 * Groups do not exist before Phase 3, so Phase 2 uses the reserved scope `diag` in the
 * `<groupShort>` position. The SDK topic charset is `A-Z a-z 0-9 . _ - /` (1-128 bytes, a
 * trailing `*` allowed in a subscription pattern), so the logical topic is used verbatim as the
 * SDK topic.
 */
export const TOPIC_VERSION = 1;
export const DIAG_SCOPE = 'diag';
/** MESH_PROTOCOL.md section 2.1 names live services `tm.live.1.<g>`. */
export const DIAG_SERVICE_ID = 'tm.live.1.diag';
export const DIAG_SERVICE_VERSION = '1';

const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;
const SDK_TOPIC = /^[A-Za-z0-9._\-/]{1,128}$/;
const SDK_PATTERN = /^[A-Za-z0-9._\-/]{0,127}\*$/;

export function buildTopic(scope: string, channel: string, detail?: string): Result<string> {
  const parts = [scope, channel, ...(detail ? [detail] : [])];
  if (!parts.every(p => SEGMENT.test(p))) {
    return err(appError('topic.invalid', 'Topic contains characters the mesh does not allow.'));
  }
  const topic = `tm/${TOPIC_VERSION}/${parts.join('/')}`;
  return SDK_TOPIC.test(topic)
    ? ok(topic)
    : err(appError('topic.too_long', 'Topic is longer than the mesh allows.'));
}

export const diagTopics = {
  /** log-mode event stream: every update, in order. */
  event: 'tm/1/diag/event',
  /** latest-mode state: newest value per key wins. */
  state: 'tm/1/diag/state',
  /** pattern covering both. */
  all: 'tm/1/diag/*',
} as const;

export function isValidTopic(topic: string, allowPattern: boolean): boolean {
  return (
    topic.startsWith(`tm/${TOPIC_VERSION}/`) &&
    (SDK_TOPIC.test(topic) || (allowPattern && SDK_PATTERN.test(topic)))
  );
}

/** Does subscription `pattern` (exact or trailing `*`) cover `topic`? */
export function patternMatches(pattern: string, topic: string): boolean {
  return pattern.endsWith('*') ? topic.startsWith(pattern.slice(0, -1)) : pattern === topic;
}
