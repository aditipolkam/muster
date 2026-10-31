import type { MeshLifecycle, Peer } from '../../mesh/types';

export function lifecycleLabel(l: MeshLifecycle): {
  label: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
} {
  switch (l) {
    case 'running':
      return { label: 'Running', tone: 'good' };
    case 'starting':
      return { label: 'Starting…', tone: 'warn' };
    case 'stopping':
      return { label: 'Stopping…', tone: 'warn' };
    case 'stoppedByUser':
      return { label: 'Stopped from notification', tone: 'warn' };
    case 'error':
      return { label: 'Error', tone: 'bad' };
    case 'stopped':
      return { label: 'Stopped', tone: 'neutral' };
    default:
      return { label: 'Not started', tone: 'neutral' };
  }
}

export function peerStatus(p: Peer): { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' } {
  if (p.state === 'lost') {
    return { label: 'Lost', tone: 'neutral' };
  }
  return p.linked ? { label: 'Connected', tone: 'good' } : { label: 'Nearby', tone: 'warn' };
}

export function shortAddress(a: string): string {
  return a.length <= 16 ? a : `${a.slice(0, 9)}…${a.slice(-6)}`;
}

export function ago(now: number, at: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
