import * as Battery from 'expo-battery';

export type BatteryReading = { level: number; charging: boolean };

/** Structurally matches mesh `BatteryPort` (platform/ may not import mesh/). */
export function createExpoBatteryPort() {
  const charging = (s: Battery.BatteryState) =>
    s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL;
  return {
    async read(): Promise<BatteryReading | null> {
      const [level, state] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
      ]);
      // expo reports -1 when the level is unknown (simulators).
      return level < 0 ? null : { level: level * 100, charging: charging(state) };
    },
    subscribe(fn: (r: BatteryReading) => void): () => void {
      let level = -1;
      let state = Battery.BatteryState.UNKNOWN;
      const push = () => level >= 0 && fn({ level: level * 100, charging: charging(state) });
      void Battery.getBatteryLevelAsync().then(l => (level = l));
      const a = Battery.addBatteryLevelListener(e => {
        level = e.batteryLevel;
        push();
      });
      const b = Battery.addBatteryStateListener(e => {
        state = e.batteryState;
        push();
      });
      return () => {
        a.remove();
        b.remove();
      };
    },
  };
}
