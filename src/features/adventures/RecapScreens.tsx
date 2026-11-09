import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { AchievementCategory, achievementById } from '../../domain/adventures/achievements';
import { completedAt } from '../../domain/adventures/lifecycle';
import { placeOf } from '../../domain/adventures/model';
import { buildRecap, formatDuration } from '../../domain/adventures/stats';
import { formatDistanceIn } from '../../domain/geo/pace';
import {
  AchievementView,
  useAchievementRuntime,
  useAchievements,
  useAdventureDetail,
  useAdventureRoute,
  useGroupPoints,
  useNavPrefs,
  useUnlocksFor,
} from '../../runtime/hooks';
import { ActivityStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ListRow,
  Screen,
  Text,
} from '../../ui/components';
import { BadgeMark } from '../../ui/BadgeMark';
import { AnimatedProgress, Reveal } from '../../ui/motion';
import { radius, space, useTheme } from '../../ui/theme';
import { formatDate, formatTime } from './format';
import { RouteSketch } from './RouteSketch';

type Nav<T extends keyof ActivityStackParamList> = NativeStackScreenProps<
  ActivityStackParamList,
  T
>;

const noteKey = (id: string) => `adventure.note.${id}`;

export function AdventureSummaryScreen({ navigation, route }: Nav<'AdventureSummary'>) {
  const { adventureId, celebrate } = route.params;
  const { c } = useTheme();
  const { kv, adventures: service } = useServices();
  const { units } = useNavPrefs();
  const { width } = useWindowDimensions();
  const detail = useAdventureDetail(adventureId);
  const track = useAdventureRoute(adventureId);
  const unlockedIds = useUnlocksFor(adventureId);
  const points = useGroupPoints(detail?.adventure.groupId ?? '').filter(p => !p.deleted);
  const [note, setNote] = useState('');
  useEffect(() => {
    void kv.get(noteKey(adventureId)).then(v => setNote(v ?? ''));
  }, [kv, adventureId]);

  const recap = useMemo(
    () =>
      detail
        ? buildRecap({
            adventure: detail.adventure,
            checkpoints: detail.checkpoints,
            completions: detail.completions,
            participants: detail.participants,
            track,
            unlockedIds,
            me: detail.self,
            now: Date.now(),
          })
        : null,
    [detail, track, unlockedIds],
  );

  if (!detail || !recap) {
    return (
      <Screen title="Recap" onBack={() => navigation.goBack()}>
        <EmptyState
          title="Adventure not found"
          body="It may have been deleted from this device."
          actionLabel="Back to adventures"
          onAction={() => navigation.navigate('Adventures')}
        />
      </Screen>
    );
  }
  const a = detail.adventure;
  const cancelled = a.status === 'cancelled' && completedAt(a) === null;
  const step = celebrate ? 90 : 0;
  const boxW = Math.min(width, 520) - 2 * space.gutter - 2 * space.lg;
  const stat = (label: string, value: string, id: string) => (
    <View style={{ flex: 1 }} key={id}>
      <Text variant="heading" testID={`recap-${id}`} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );

  return (
    <Screen
      title={cancelled ? 'Cancelled adventure' : 'Adventure recap'}
      onBack={() => navigation.goBack()}
    >
      <ScrollView contentContainerStyle={styles.list}>
        <Reveal>
          <Text variant="title" testID="recap-name">
            {recap.name}
          </Text>
          <Text muted>
            {formatDate(recap.endedAt ?? a.createdAt)}
            {recap.startedAt ? ` · started ${formatTime(recap.startedAt)}` : ''}
            {recap.isGroup ? ' · group adventure' : ''}
          </Text>
          {a.description ? <Text muted>{a.description}</Text> : null}
        </Reveal>

        <Reveal delay={step}>
          <Card>
            <View style={styles.stats}>
              {stat('Time moving', formatDuration(recap.durationMs), 'duration')}
              {stat(
                'Distance',
                recap.distanceM === null
                  ? 'Not recorded'
                  : formatDistanceIn(recap.distanceM, units),
                'distance',
              )}
            </View>
            <View style={styles.stats}>
              {stat(
                'Checkpoints',
                `${recap.checkpointsDone.length} of ${recap.checkpointsTotal}`,
                'checkpoints',
              )}
              {stat('People', String(Math.max(1, recap.participants.length)), 'people')}
            </View>
            <Text variant="caption" muted>
              Time counts only while the adventure was running. Distance and route come from this
              phone's GPS; where nothing was recorded, nothing is shown.
            </Text>
          </Card>
        </Reveal>

        {recap.route.length >= 2 ? (
          <Reveal delay={step * 2}>
            <Card>
              <Text variant="label" muted style={{ marginBottom: space.sm }}>
                Route
              </Text>
              <RouteSketch
                route={recap.route}
                checkpoints={detail.checkpoints.flatMap(cp => {
                  const place = placeOf(cp);
                  return place
                    ? [
                        {
                          ...place,
                          reached: recap.checkpointsDone.some(d => d.checkpoint.id === cp.id),
                        },
                      ]
                    : [];
                })}
                width={boxW}
              />
              <Button
                testID="route-on-map"
                variant="secondary"
                icon="map"
                label="View on map"
                style={{ marginTop: space.md }}
                onPress={() =>
                  (
                    navigation.getParent() as
                      | { navigate: (n: string, p: object) => void }
                      | undefined
                  )?.navigate('Map', {
                    showAdventure: a.id,
                    nonce: Date.now(),
                  })
                }
              />
            </Card>
          </Reveal>
        ) : (
          <Reveal delay={step * 2}>
            <Banner
              title="No route recorded"
              body="The route is recorded from GPS while an adventure is running. This one has none."
            />
          </Reveal>
        )}

        <Reveal delay={step * 3}>
          <Text variant="heading">Checkpoints</Text>
          <Card style={styles.flat}>
            {detail.checkpoints.length === 0 ? (
              <Text muted>This adventure had no checkpoints.</Text>
            ) : (
              detail.checkpoints.map((cp, i) => {
                const done = recap.checkpointsDone.find(d => d.checkpoint.id === cp.id);
                return (
                  <ListRow
                    key={cp.id}
                    title={cp.name}
                    subtitle={
                      done
                        ? `Reached ${formatTime(done.at)}${
                            done.method === 'manual' ? ' · confirmed by you' : ''
                          }`
                        : 'Not reached'
                    }
                    trailing={done ? <Badge label="Reached" tone="good" /> : undefined}
                    divider={i < detail.checkpoints.length - 1}
                  />
                );
              })
            )}
          </Card>
        </Reveal>

        {recap.isGroup ? (
          <Reveal delay={step * 4}>
            <Text variant="heading">Together</Text>
            <Card>
              <Text>
                {recap.participants.map(p => p.name).join(', ') || 'No participants recorded'}
              </Text>
              {recap.groupExplored !== null ? (
                <Text variant="caption" muted>
                  {recap.groupExplored} of {recap.checkpointsTotal} checkpoints reached by everyone
                  who joined
                </Text>
              ) : null}
            </Card>
            {points.length > 0 ? (
              <Card style={[styles.flat, { marginTop: space.md }]}>
                <Text variant="label" muted style={{ padding: space.md, paddingBottom: 0 }}>
                  Meeting points
                </Text>
                {points.map((p, i) => (
                  <ListRow
                    key={p.id}
                    title={p.name}
                    subtitle={p.note ?? undefined}
                    divider={i < points.length - 1}
                  />
                ))}
              </Card>
            ) : null}
          </Reveal>
        ) : null}

        {recap.unlockedIds.length > 0 ? (
          <Reveal delay={step * 5}>
            <Text variant="heading">Milestones unlocked</Text>
            <Card style={styles.flat}>
              {recap.unlockedIds.map((id, i) => {
                const def = achievementById(id);
                return def ? (
                  <ListRow
                    key={id}
                    title={def.name}
                    subtitle={def.description}
                    leading={<BadgeMark icon={def.icon} unlocked size={36} />}
                    divider={i < recap.unlockedIds.length - 1}
                  />
                ) : null;
              })}
            </Card>
          </Reveal>
        ) : null}

        <Reveal delay={step * 6}>
          <Text variant="heading">Notes</Text>
          <TextInput
            testID="recap-note"
            style={[
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surface },
            ]}
            value={note}
            onChangeText={setNote}
            onBlur={() => void kv.set(noteKey(adventureId), note)}
            multiline
            maxLength={1000}
            placeholder="What do you want to remember?"
            accessibilityLabel="Personal notes about this adventure"
          />
          <Text variant="caption" muted>
            Notes and your route stay on this phone. Nothing from your journal is shared with the
            group.
          </Text>
        </Reveal>

        <Button
          variant="ghost"
          label="Delete from journal"
          onPress={() =>
            Alert.alert(
              'Delete this adventure?',
              'It is removed from this device. Badges you earned stay earned.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    void service
                      .deleteAdventure(a.id)
                      .then(() => navigation.navigate('Adventures'));
                  },
                },
              ],
            )
          }
        />
      </ScrollView>
    </Screen>
  );
}

const CATEGORY_TITLE: Record<AchievementCategory, string> = {
  exploration: 'Exploration',
  group: 'Together',
  offline: 'Off the grid',
};

export function AchievementsScreen({ navigation }: Nav<'Achievements'>) {
  const views = useAchievements();
  const rt = useAchievementRuntime();
  const { achievements } = useServices();
  const fresh = useMemo(() => new Set(rt.fresh), [rt.fresh]);
  // The reveal has been seen once the list is on screen; clear the "new" marker shortly after.
  useEffect(() => {
    if (rt.fresh.length === 0) {
      return;
    }
    const t = setTimeout(() => rt.fresh.forEach(id => achievements.dismissFresh(id)), 2500);
    return () => clearTimeout(t);
  }, [rt.fresh, achievements]);
  const earned = views.filter(v => v.unlockedAt !== null).length;

  return (
    <Screen title="Achievements" onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text muted testID="achievements-count">
          {earned} of {views.length} earned
        </Text>
        {(['exploration', 'group', 'offline'] as AchievementCategory[]).map(cat => (
          <View key={cat} style={{ gap: space.sm }}>
            <Text variant="heading">{CATEGORY_TITLE[cat]}</Text>
            {views
              .filter(v => v.def.category === cat)
              .map(v => (
                <BadgeRow key={v.def.id} v={v} isNew={fresh.has(v.def.id)} />
              ))}
          </View>
        ))}
        <Text variant="caption" muted>
          Badges are worked out on this phone from your own adventures and are not independently
          verified. There are no streaks, rankings or leaderboards, and resting or ending early
          never costs you anything.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function BadgeRow({ v, isNew }: { v: AchievementView; isNew: boolean }) {
  const { c } = useTheme();
  const unlocked = v.unlockedAt !== null;
  const body = (
    <Card testID={`badge-${v.def.id}`} style={styles.badge}>
      <BadgeMark icon={v.def.icon} unlocked={unlocked} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.badgeTitle}>
          <Text variant="cardTitle" color={unlocked ? c.text : c.textMuted}>
            {v.def.name}
          </Text>
          {isNew ? <Badge label="New" tone="good" /> : null}
        </View>
        <Text variant="caption" muted>
          {unlocked ? v.def.description : v.def.requirement}
        </Text>
        {unlocked ? (
          <Text variant="caption" color={c.primary}>
            Earned {formatDate(v.unlockedAt as number)}
          </Text>
        ) : v.def.target && v.def.target > 1 ? (
          <View style={{ gap: 4, marginTop: 4 }}>
            <AnimatedProgress
              value={v.progress.current / v.def.target}
              color={c.primary}
              track={c.surfaceAlt}
            />
            <Text variant="caption" muted>
              {v.progress.current} of {v.def.target}
            </Text>
          </View>
        ) : (
          <Text variant="caption" muted>
            Locked
          </Text>
        )}
      </View>
    </Card>
  );
  return isNew ? <Reveal>{body}</Reveal> : body;
}

const styles = StyleSheet.create({
  list: { padding: space.gutter, paddingTop: 0, gap: space.md, paddingBottom: space.xxl },
  flat: { paddingVertical: space.xs },
  stats: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    padding: space.lg,
    minHeight: 96,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badgeTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
