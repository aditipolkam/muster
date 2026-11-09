import type { Adventure } from '../../domain/adventures/model';
import { isEnabled } from '../../shared/features';

/**
 * Show this adventure as a group activity? Only while the feature is on; otherwise an activity
 * received from someone else's phone is shown as a plain group adventure.
 */
export const isActivity = (a: Pick<Adventure, 'activity'>): boolean =>
  isEnabled('groupActivities') && a.activity === true;
