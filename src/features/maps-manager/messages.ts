import { formatBytes } from '../../domain/geo';
import { RegionRecord, requiredFreeBytes } from '../../domain/maps/region';

/** User-facing text for a failed/paused region (ARCHITECTURE.md 11: plain language, what to do next). */
export function describeRegionProblem(r: RegionRecord, freeBytes: number | null): string | null {
  switch (r.errorCode) {
    case null:
      return null;
    case 'interrupted':
      return 'Download was interrupted. Resume to continue where it stopped.';
    case 'network':
      return 'The connection dropped. Resume when you are back online.';
    case 'insufficient_space': {
      const need = requiredFreeBytes(Math.max(0, r.bytes - r.progressBytes));
      return `Not enough free space: about ${formatBytes(need)} needed${
        freeBytes === null ? '' : `, ${formatBytes(freeBytes)} available`
      }. Free some space and retry.`;
    }
    case 'checksum_mismatch':
      return 'The file failed its integrity check and was deleted. Download it again.';
    case 'invalid_pmtiles':
      return 'The downloaded file is not a valid map archive and was deleted.';
    case 'incomplete':
      return 'The download ended early. Resume to finish it.';
    case 'file_missing':
      return 'The map file is missing from this device. Download it again.';
    case 'disk_error':
      return 'The map file could not be written. Check free storage and retry.';
    case 'source_unreachable':
      return 'Could not reach the map server. Check your connection and try the area again.';
    case 'range_unsupported':
      return 'The map server does not support custom areas. Choose a listed region instead.';
    default:
      if (r.errorCode.startsWith('http_')) {
        return `The map server returned an error (${r.errorCode.slice(5)}). Try again later.`;
      }
      return 'Something went wrong with this download. Try again.';
  }
}

export function formatEta(secondsLeft: number): string {
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) {
    return '';
  }
  if (secondsLeft < 90) {
    return `${Math.ceil(secondsLeft)} s left`;
  }
  if (secondsLeft < 5400) {
    return `${Math.ceil(secondsLeft / 60)} min left`;
  }
  return `${(secondsLeft / 3600).toFixed(1)} h left`;
}
