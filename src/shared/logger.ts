/* eslint-disable no-console -- the logger is the one sanctioned console user */

type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let debugPositions = false;
let minLevel: Level =
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
    ? 'error'
    : __DEV__
    ? 'debug'
    : 'info';

export function setDebugPositions(enabled: boolean): void {
  debugPositions = enabled;
}

export function setLogLevel(level: Level): void {
  minLevel = level;
}

/** Coordinates are redacted at info level and above unless the debug flag is on (CLAUDE.md rule 8). */
export function redactCoords(text: string): string {
  if (debugPositions) {
    return text;
  }
  return text.replace(/-?\d{1,3}\.\d{3,}/g, '<redacted>');
}

function emit(level: Level, scope: string, msg: string): void {
  if (RANK[level] < RANK[minLevel]) {
    return;
  }
  const line = `[${scope}] ${level === 'debug' ? msg : redactCoords(msg)}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string) => emit('debug', scope, msg),
    info: (msg: string) => emit('info', scope, msg),
    warn: (msg: string) => emit('warn', scope, msg),
    error: (msg: string) => emit('error', scope, msg),
  };
}
