/**
 * Features that are built but not released. Each is off until the owner turns it on here; while
 * off, the app behaves as it did before the feature existed. Tests switch one with `setFeature`.
 */
const flags = {
  /**
   * Group activities (docs/phases/EXT_GROUP_ACTIVITIES.md): drafts, phases, publish, per-person
   * runs. Off: a group's adventure is planned and run as a plain group adventure.
   */
  groupActivities: false,
};

export type Feature = keyof typeof flags;

export const isEnabled = (f: Feature): boolean => flags[f];

/** Tests only. */
export function setFeature(f: Feature, on: boolean): void {
  flags[f] = on;
}
