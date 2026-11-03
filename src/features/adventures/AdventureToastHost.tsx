import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdventureBanners } from './AdventureBanners';

/**
 * Adventure news (arrived at a checkpoint, badge earned, finished) shows as a banner over every
 * tab except the Map, which stays free of overlays. News waits and appears on the next tab.
 * The shell passes the current tab in, because this sits outside the tab navigator.
 */
export function AdventureToastHost({
  tab,
  onNavigate,
}: {
  tab: string | undefined;
  onNavigate: (screen: 'Activity', params: object) => void;
}) {
  const insets = useSafeAreaInsets();
  if (tab === 'Map') {
    return null;
  }
  return (
    <View style={[styles.toastHost, { top: insets.top + 8 }]} pointerEvents="box-none">
      <AdventureBanners
        onOpenAchievements={() => onNavigate('Activity', { screen: 'Achievements' })}
        onOpenCheckpoint={(adventureId, checkpointId) =>
          onNavigate('Activity', {
            screen: 'CheckpointDetails',
            params: { adventureId, checkpointId },
          })
        }
        onOpenSummary={adventureId =>
          onNavigate('Activity', { screen: 'AdventureSummary', params: { adventureId } })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toastHost: { position: 'absolute', left: 16, right: 16 },
});
