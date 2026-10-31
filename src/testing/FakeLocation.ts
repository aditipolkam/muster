import { Fix } from '../domain/location/fix';
import { RawPermission } from '../domain/location/permission';
import { LocationPort, Stop, WatchOptions } from '../platform/LocationPort';

export class FakeLocation implements LocationPort {
  perm: RawPermission = {
    status: 'undetermined',
    canAskAgain: true,
    coarseOnly: false,
    servicesEnabled: true,
  };
  nextRequestResult: RawPermission | null = null;
  last: Fix | null = null;
  fixHandler: ((f: Fix) => void) | null = null;
  headingHandler: ((d: number) => void) | null = null;
  settingsOpened = 0;
  watchStarts = 0;
  watchStops = 0;

  permission = async () => this.perm;
  requestPermission = async () => {
    if (this.nextRequestResult) {
      this.perm = this.nextRequestResult;
    }
    return this.perm;
  };
  openSettings = async () => {
    this.settingsOpened++;
  };
  getCurrentFix = async () => this.last;
  watch = async (_o: WatchOptions, onFix: (f: Fix) => void): Promise<Stop> => {
    this.watchStarts++;
    this.fixHandler = onFix;
    return () => {
      this.watchStops++;
      this.fixHandler = null;
    };
  };
  watchHeading = async (on: (d: number) => void): Promise<Stop> => {
    this.headingHandler = on;
    return () => {
      this.headingHandler = null;
    };
  };
  emit(f: Fix) {
    this.fixHandler?.(f);
  }
}
