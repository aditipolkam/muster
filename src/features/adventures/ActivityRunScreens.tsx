import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { proximity } from '../../domain/adventures/arrival';
import { boxIsInstalled, estimateAreaBytes } from '../../domain/adventures/area';
import { activityStanding, completedAt, elapsedMs } from '../../domain/adventures/lifecycle';
import { CHECKPOINT_DESC_MAX, MapArea, placeOf } from '../../domain/adventures/model';
import {
  formatBytesShort,
  formatDurationRange,
  isPhaseUnlocked,
  PhaseStatus,
  phaseStatuses,
  summarizeActivity,
} from '../../domain/adventures/phases';
import { buildTimeline } from '../../domain/adventures/stats';
import { formatDistanceIn } from '../../domain/geo/pace';
import { useLocationStore } from '../../platform/locationStore';
import {
  AdventureDetail,
  useAdventureDetail,
  useCheckpointRadius,
  useGroupMembers,
  useGroups,
  useNavPrefs,
  usePhaseRecords,
  useRegions,
} from '../../runtime/hooks';
import { ActivityStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import { CoverArt } from '../../ui/activity';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Icon,
  IconName,
  ListRow,
  ProgressBar,
  Screen,
  SegmentedTabs,
  Text,
} from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow } from '../../ui/useNow';
import { formatTime, PHASE_ICON, timelineText } from './format';

type Nav<T extends keyof ActivityStackParamList> = NativeStackScreenProps<
  ActivityStackParamList,
  T
>;
type Navigation = Nav<'AdventureDetails'>['navigation'];

/** 00:47:32 */
export function clockText(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

const kmText = (m: number | null) => (m === null ? '–' : `${(m / 1000).toFixed(1)} km`);

// ---- The published activity: one page that changes with where you are in it --------------------

export function ActivityHome({
  detail,
  navigation,
}: {
  detail: AdventureDetail;
  navigation: Navigation;
}) {
  const mine = detail.participants.find(p => p.address === detail.self)?.state ?? null;
  const standing = activityStanding(detail.adventure, mine);
  return standing === 'running' || standing === 'finished' ? (
    <RunningView detail={detail} navigation={navigation} finished={standing === 'finished'} />
  ) : (
    <Overview detail={detail} navigation={navigation} closed={standing === 'closed'} />
  );
}

// ---- Overview (not started) ------------------------------------------------------------------

function Overview({
  detail,
  navigation,
  closed,
}: {
  detail: AdventureDetail;
  navigation: Navigation;
  closed: boolean;
}) {
  const { c } = useTheme();
  const { adventures: service } = useServices();
  const a = detail.adventure;
  const group = useGroups().find(g => g.id === a.groupId) ?? null;
  const summary = summarizeActivity(detail.checkpoints);
  const [showPhases, setShowPhases] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOrganizer = group?.role === 'organizer';

  const start = async () => {
    const r = await service.join(a.id);
    setError(r.ok ? null : r.error.userMessage);
  };
  const rules = () =>
    Alert.alert(
      'Activity rules',
      [
        a.ordered
          ? 'Do the phases in order. Each one unlocks when the one before it is done.'
          : 'Do the phases in any order.',
        'Your timer starts when you press Start and stops when you finish your last phase.',
        'Photos and notes stay on your phone.',
        'Choose safe, public, accessible places. TrailMesh does not know about closures, weather or terrain: turn back if conditions change.',
      ].join('\n\n'),
    );

  return (
    <Screen title={a.name} onBack={() => navigation.goBack()}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.list}>
          <View style={[styles.banner, { backgroundColor: c.primarySoft }]}>
            <CoverArt size={96} round={radius.lg} />
          </View>
          <View style={styles.rowGap}>
            <Badge label={closed ? 'Ended' : 'Published'} tone={closed ? 'warn' : 'good'} />
            <Text muted>
              {group?.name ?? 'Group'} · {summary.phases}{' '}
              {summary.phases === 1 ? 'phase' : 'phases'}
            </Text>
          </View>
          <View style={styles.rowGap}>
            <View style={styles.fact}>
              <Icon name="pin" size={18} color={c.primary} />
              <Text testID="overview-distance">
                {summary.distanceM === null ? '–' : `≈ ${kmText(summary.distanceM)}`}
              </Text>
            </View>
            <View style={styles.fact}>
              <Icon name="time" size={18} color={c.primary} />
              <Text testID="overview-time">
                {summary.minutes ? `Est. ${formatDurationRange(summary.minutes)}` : 'Est. –'}
              </Text>
            </View>
          </View>
          {a.description ? <Text>{a.description}</Text> : null}
          {closed ? (
            <Banner
              tone="warn"
              title="The organizer ended this activity"
              body="It cannot be started any more."
            />
          ) : null}
          {a.region ? <MapRegionCard area={a.region} /> : null}

          <Card style={styles.flatCard}>
            <ListRow
              testID="row-phases"
              title="Phases"
              leading={<Icon name="list" size={22} color={c.primary} />}
              trailing={<Text muted>{summary.phases}</Text>}
              chevron
              onPress={() => setShowPhases(v => !v)}
            />
            {showPhases
              ? detail.checkpoints.map((p, i) => (
                  <ListRow
                    key={p.id}
                    testID={`overview-phase-${p.id}`}
                    title={`${i + 1}. ${p.name}`}
                    leading={<Icon name={PHASE_ICON[p.type]} size={20} color={c.textMuted} />}
                  />
                ))
              : null}
            <ListRow
              testID="row-preview"
              title="Preview on Map"
              leading={<Icon name="map" size={22} color={c.primary} />}
              chevron
              onPress={() =>
                (
                  navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined
                )?.navigate('Map', { showAdventure: a.id, nonce: Date.now() })
              }
            />
            <ListRow
              testID="row-rules"
              title="Activity Rules"
              leading={<Icon name="rules" size={22} color={c.primary} />}
              chevron
              divider={false}
              onPress={rules}
            />
          </Card>
          {error ? <Banner tone="error" title={error} /> : null}
          {isOrganizer && !closed ? (
            <Button
              testID="action-cancel"
              variant="ghost"
              label="Cancel activity"
              onPress={() =>
                Alert.alert('Cancel this activity?', 'It ends for everyone who has not finished.', [
                  { text: 'Keep it', style: 'cancel' },
                  {
                    text: 'Cancel activity',
                    style: 'destructive',
                    onPress: () => void service.act(a.id, 'cancel'),
                  },
                ])
              }
            />
          ) : null}
        </ScrollView>
        {!closed ? (
          <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>
            <Button
              testID="join-adventure"
              style={{ flex: 1 }}
              label="Start Activity"
              onPress={() => void start()}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

// ---- One-tap download of the activity's map area -----------------------------------------------

const boxHas = (outer: [number, number, number, number], inner: [number, number, number, number]) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

/**
 * Download Map Region: one tap plans the area and starts the download, which is the only place
 * the activity uses the network and only because the person pressed it.
 */
export function MapRegionCard({ area }: { area: MapArea }) {
  const { c } = useTheme();
  const { packs } = useServices();
  const regions = useRegions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installed = regions.filter(r => r.state === 'installed' && r.filePath);
  const covered = boxIsInstalled(installed, area.bbox);
  const inFlight = regions.find(
    r =>
      (r.state === 'downloading' || r.state === 'paused' || r.state === 'verifying') &&
      boxHas(r.bbox, area.bbox),
  );
  const size = formatBytesShort(estimateAreaBytes(area.bbox, area.minZoom, area.maxZoom));

  const download = async () => {
    setBusy(true);
    setError(null);
    const plan = await packs.planArea(area.bbox, area.maxZoom);
    if (!plan.ok) {
      setBusy(false);
      setError(plan.error.userMessage);
      return;
    }
    const r = await packs.startArea(plan.value, area.name);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        testID="download-region"
        accessibilityRole="button"
        accessibilityState={{ disabled: covered || !!inFlight || busy }}
        accessibilityLabel={covered ? 'Map region downloaded' : 'Download Map Region'}
        disabled={covered || !!inFlight || busy}
        onPress={() => void download()}
        style={[styles.regionCard, { backgroundColor: c.primarySoft, borderColor: c.border }]}
      >
        <Icon name={covered ? 'done' : 'download'} size={26} color={c.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="cardTitle">
            {covered
              ? 'Map region downloaded'
              : inFlight
              ? 'Downloading map region'
              : 'Download Map Region'}
          </Text>
          <Text variant="caption" muted testID="region-caption">
            {covered
              ? 'Ready for offline use'
              : inFlight
              ? `${Math.round(
                  inFlight.bytes > 0 ? (inFlight.progressBytes / inFlight.bytes) * 100 : 0,
                )}%`
              : `About ${size}  ·  Offline use`}
          </Text>
          {inFlight ? (
            <ProgressBar value={inFlight.bytes > 0 ? inFlight.progressBytes / inFlight.bytes : 0} />
          ) : null}
        </View>
      </Pressable>
      {error ? <Banner tone="error" title={error} /> : null}
    </View>
  );
}

// ---- Running / finished ---------------------------------------------------------------------

type RunTab = 'progress' | 'updates';

function RunningView({
  detail,
  navigation,
  finished,
}: {
  detail: AdventureDetail;
  navigation: Navigation;
  finished: boolean;
}) {
  const { c } = useTheme();
  const { adventures: service } = useServices();
  const now = useNow();
  const { units } = useNavPrefs();
  const { radiusM } = useCheckpointRadius();
  const fix = useLocationStore(s => s.fix);
  const a = detail.adventure;
  const records = usePhaseRecords(a.id);
  const members = useGroupMembers(a.groupId ?? '').filter(m => m.state === 'active');
  const [tab, setTab] = useState<RunTab>('progress');
  const done = new Set(
    detail.completions.filter(x => x.address === detail.self).map(x => x.checkpointId),
  );
  const rows = phaseStatuses(detail.checkpoints, done, a.ordered === true);
  const started = detail.participants.filter(p => p.state !== 'left').length;
  const elapsed = elapsedMs(a.progress, finished ? completedAt(a) ?? now : now);
  const nameOf = (addr: string) =>
    addr === detail.self
      ? 'You'
      : members.find(m => m.address === addr)?.name ??
        detail.participants.find(p => p.address === addr)?.name ??
        'Someone';
  const timeline = buildTimeline({
    adventure: a,
    log: detail.log,
    completions: detail.completions,
    participants: detail.participants,
    checkpoints: detail.checkpoints,
    me: detail.self,
  });

  const hint = (phase: (typeof rows)[number]['phase'], status: PhaseStatus): string => {
    if (status === 'locked') {
      return 'Locked';
    }
    const place = placeOf(phase);
    if (place) {
      const p = proximity({ fix, target: place, radiusM: phase.radiusM ?? radiusM, now });
      if (p.state === 'inside') {
        return 'At location · Tap to complete';
      }
      if (p.state === 'no_fix') {
        return 'Waiting for GPS';
      }
      return `${formatDistanceIn(p.distM, units)} away`;
    }
    return phase.requirePhoto && !records[phase.id]?.photoUri
      ? 'Photo needed · Tap to open'
      : 'Tap to complete';
  };

  return (
    <Screen
      title={a.name}
      onBack={() => navigation.goBack()}
      right={<Badge label={finished ? 'Finished' : 'In Progress'} tone="good" />}
    >
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.list}>
          <Card style={styles.statRow} testID="run-stats">
            <View style={styles.stat}>
              <Icon name="time" size={22} color={c.primary} />
              <View>
                <Text
                  variant="heading"
                  style={{ fontVariant: ['tabular-nums'] }}
                  testID="run-clock"
                >
                  {clockText(elapsed)}
                </Text>
                <Text variant="caption" muted>
                  Activity time
                </Text>
              </View>
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.border }]} />
            <View style={styles.stat}>
              <Icon name="group" size={22} color={c.primary} />
              <View>
                <Text variant="heading" testID="run-participants">
                  {started} / {Math.max(members.length, started)}
                </Text>
                <Text variant="caption" muted>
                  Participants
                </Text>
              </View>
            </View>
          </Card>

          <SegmentedTabs<RunTab>
            options={[
              { value: 'progress', label: 'Progress' },
              { value: 'updates', label: 'Updates' },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'progress' ? (
            <View style={{ gap: space.sm }}>
              <Text variant="heading" testID="run-phases-heading">
                Phases ({done.size} / {rows.length})
              </Text>
              {rows.map(({ phase, status }, i) => (
                <Pressable
                  key={phase.id}
                  testID={`run-phase-${phase.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}. ${phase.name}, ${status}`}
                  onPress={() =>
                    navigation.navigate('CheckpointDetails', {
                      adventureId: a.id,
                      checkpointId: phase.id,
                    })
                  }
                  style={[
                    styles.phaseRow,
                    status === 'current' && { backgroundColor: c.primarySoft },
                  ]}
                >
                  <View style={styles.railCol}>
                    <View
                      style={[
                        styles.dot,
                        status === 'done'
                          ? { backgroundColor: c.primary, borderColor: c.primary }
                          : { borderColor: status === 'locked' ? c.border : c.primary },
                      ]}
                    >
                      {status === 'done' ? (
                        <Icon name="check" size={16} color={c.onPrimary} />
                      ) : null}
                    </View>
                    {i < rows.length - 1 ? (
                      <View style={[styles.rail, { backgroundColor: c.border }]} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="cardTitle" color={status === 'locked' ? c.textMuted : c.text}>
                      {i + 1}. {phase.name}
                    </Text>
                    <Text variant="caption" muted>
                      {status === 'done'
                        ? `Completed ${formatTime(
                            detail.completions.find(
                              x => x.address === detail.self && x.checkpointId === phase.id,
                            )?.at ?? now,
                          )}`
                        : hint(phase, status)}
                    </Text>
                  </View>
                  {records[phase.id]?.photoUri ? (
                    <Image
                      testID={`run-thumb-${phase.id}`}
                      source={{ uri: records[phase.id]?.photoUri as string }}
                      style={styles.thumb}
                    />
                  ) : (
                    <Icon name={PHASE_ICON[phase.type]} size={20} color={c.textMuted} />
                  )}
                </Pressable>
              ))}
            </View>
          ) : (
            <Card style={styles.flatCard} testID="run-updates">
              {timeline.map((e, i) => (
                <ListRow
                  key={e.key}
                  title={timelineText(
                    e,
                    nameOf,
                    detail.checkpoints.map(p => ({ id: p.id, name: p.name })),
                  )}
                  subtitle={formatTime(e.at)}
                  divider={i < timeline.length - 1}
                />
              ))}
            </Card>
          )}

          {!finished ? (
            <Button
              testID="leave-activity"
              variant="ghost"
              label="Stop and leave"
              onPress={() =>
                Alert.alert(
                  'Leave this activity?',
                  'Your timer stops. You can start again later.',
                  [
                    { text: 'Stay', style: 'cancel' },
                    {
                      text: 'Leave',
                      style: 'destructive',
                      onPress: () => void service.leave(a.id),
                    },
                  ],
                )
              }
            />
          ) : null}
        </ScrollView>
        {finished ? (
          <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>
            <Button
              testID="view-recap"
              style={{ flex: 1 }}
              label="View Summary"
              onPress={() => navigation.navigate('AdventureSummary', { adventureId: a.id })}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

// ---- One phase ---------------------------------------------------------------------------------

export function PhaseScreen({ navigation, route }: Nav<'CheckpointDetails'>) {
  const { adventureId, checkpointId } = route.params;
  const { c } = useTheme();
  const { adventures: service, photos } = useServices();
  const detail = useAdventureDetail(adventureId);
  const records = usePhaseRecords(adventureId);
  const { radiusM } = useCheckpointRadius();
  const { units } = useNavPrefs();
  const fix = useLocationStore(s => s.fix);
  const now = useNow();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteLoaded = useRef(false);
  const record = records[checkpointId];

  useEffect(() => {
    if (record && !noteLoaded.current) {
      noteLoaded.current = true;
      setNote(record.note ?? '');
    }
  }, [record]);

  const cp = detail?.checkpoints.find(x => x.id === checkpointId) ?? null;
  if (!detail || !cp) {
    return (
      <Screen title="Phase" onBack={() => navigation.goBack()}>
        <EmptyState
          title="Phase not found"
          body="It is no longer part of this activity."
          actionLabel="Back"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }
  const a = detail.adventure;
  const mine = detail.completions.find(x => x.checkpointId === cp.id && x.address === detail.self);
  const myDone = new Set(
    detail.completions.filter(x => x.address === detail.self).map(x => x.checkpointId),
  );
  const locked = a.ordered === true && !isPhaseUnlocked(true, detail.checkpoints, myDone, cp.id);
  const place = placeOf(cp);
  const radiusUsed = cp.radiusM ?? radiusM;
  const prox = place ? proximity({ fix, target: place, radiusM: radiusUsed, now }) : null;
  const photoUri = record?.photoUri ?? null;
  const active = a.status === 'active' && detail.joined;
  const needsPhoto = cp.requirePhoto && !photoUri;
  const canComplete = active && !mine && !locked && !needsPhoto;

  const attach = async () => {
    const r = await photos.pick();
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    if (r.value) {
      if (photoUri) {
        await photos.discard(photoUri);
      }
      await service.setPhasePhoto(a.id, cp.id, r.value);
      setError(null);
    }
  };
  const removePhoto = async () => {
    if (photoUri) {
      await photos.discard(photoUri);
    }
    await service.setPhasePhoto(a.id, cp.id, null);
  };

  const complete = async () => {
    setBusy(true);
    setError(null);
    await service.setPhaseNote(a.id, cp.id, note);
    const r = await service.confirmArrival(a.id, cp.id, 'manual');
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    const me = detail.self ? await service.participantState(a.id, detail.self) : null;
    if (me === 'done') {
      navigation.replace('ActivityCompleted', { adventureId: a.id });
    } else {
      navigation.goBack();
    }
  };
  const confirmFar = () => {
    if (
      prox &&
      (prox.state === 'far' || prox.state === 'approaching') &&
      prox.distM > radiusUsed * 3
    ) {
      Alert.alert(
        'You seem to be far from here',
        `Your GPS puts you about ${formatDistanceIn(
          prox.distM,
          units,
        )} away. Mark it complete anyway?`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Mark as Complete', onPress: () => void complete() },
        ],
      );
      return;
    }
    void complete();
  };

  return (
    <Screen title={cp.name} onBack={() => navigation.goBack()}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {photoUri ? (
            <View>
              <Image testID="phase-photo" source={{ uri: photoUri }} style={styles.photo} />
              {!mine ? (
                <Pressable
                  testID="remove-photo"
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  onPress={() => void removePhoto()}
                  style={[styles.photoX, { backgroundColor: c.surface }]}
                >
                  <Icon name="close" size={18} />
                </Pressable>
              ) : null}
            </View>
          ) : cp.type === 'photo' || cp.type === 'collect' || cp.requirePhoto ? (
            <Pressable
              testID="add-photo"
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
              disabled={!!mine}
              onPress={() => void attach()}
              style={[styles.photoEmpty, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}
            >
              <Icon name="camera" size={34} color={c.primary} />
              <Text variant="cardTitle">Add a photo</Text>
              <Text variant="caption" muted>
                {cp.requirePhoto
                  ? 'A photo is needed to complete this phase. It stays on your phone.'
                  : 'Optional. It stays on your phone.'}
              </Text>
            </Pressable>
          ) : null}

          {mine ? (
            <View style={[styles.status, { backgroundColor: c.primarySoft }]} testID="phase-done">
              <Icon name="done" size={26} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="cardTitle">Completed</Text>
                <Text variant="caption" muted>
                  {formatTime(mine.at)}
                </Text>
              </View>
            </View>
          ) : place && prox ? (
            <View
              style={[
                styles.status,
                { backgroundColor: prox.state === 'inside' ? c.primarySoft : c.surfaceAlt },
              ]}
              testID="phase-location"
            >
              <Icon
                name="pin"
                size={26}
                color={prox.state === 'inside' ? c.primary : c.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text variant="cardTitle">
                  {prox.state === 'inside'
                    ? 'You are at the location'
                    : prox.state === 'no_fix'
                    ? 'Waiting for GPS'
                    : prox.state === 'uncertain'
                    ? 'Close, but GPS is not precise enough'
                    : `${formatDistanceIn(prox.distM, units)} away`}
                </Text>
                <Text variant="caption" muted>
                  {prox.state === 'inside'
                    ? `Within ${Math.max(1, Math.round(prox.distM))} m of target`
                    : `Get within ${radiusUsed} m, or mark it yourself when you are there.`}
                </Text>
              </View>
              {prox.state === 'inside' ? <Icon name="done" size={22} color={c.primary} /> : null}
            </View>
          ) : null}

          {cp.description ? <Text>{cp.description}</Text> : null}
          {cp.task ? <Text>{cp.task}</Text> : null}

          <Text variant="label" muted>
            Note (optional)
          </Text>
          <TextInput
            testID="phase-note"
            style={[
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surface },
            ]}
            value={note}
            onChangeText={setNote}
            onEndEditing={() => void service.setPhaseNote(a.id, cp.id, note)}
            editable={!mine}
            maxLength={CHECKPOINT_DESC_MAX * 2}
            multiline
            placeholder="Found a beautiful wild orchid!"
            placeholderTextColor={c.textMuted}
            accessibilityLabel="Note"
          />

          {locked && !mine ? (
            <Banner
              tone="info"
              title="Finish the earlier phases first"
              body="This activity goes in order."
            />
          ) : null}
          {!detail.joined && !mine && a.status === 'active' ? (
            <Banner
              tone="info"
              title="Press Start Activity first"
              body="Your time and phases are recorded after you start."
            />
          ) : null}
          {place && !mine ? (
            <Button
              testID="navigate-checkpoint"
              variant="secondary"
              icon="navigate"
              label="Navigate here"
              onPress={() =>
                (
                  navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined
                )?.navigate('Navigate', { adventureId: a.id, checkpointId: cp.id })
              }
            />
          ) : null}
          {error ? <Banner tone="error" title={error} /> : null}
        </ScrollView>
        {!mine ? (
          <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>
            <Button
              testID="confirm-arrival"
              style={{ flex: 1 }}
              icon="check"
              label="Mark as Complete"
              loading={busy}
              disabled={!canComplete}
              onPress={confirmFar}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

// ---- Completed ----------------------------------------------------------------------------------

export function ActivityCompletedScreen({ navigation, route }: Nav<'ActivityCompleted'>) {
  const { adventureId } = route.params;
  const { c } = useTheme();
  const detail = useAdventureDetail(adventureId);
  const group = useGroups().find(g => g.id === detail?.adventure.groupId) ?? null;
  const { units } = useNavPrefs();
  if (!detail) {
    return (
      <Screen title="Activity Completed" onBack={() => navigation.goBack()}>
        <EmptyState title="Activity not found" body="It may have been deleted." />
      </Screen>
    );
  }
  const a = detail.adventure;
  const end = completedAt(a);
  const duration = elapsedMs(a.progress, end ?? Date.now());
  const done = detail.completions.filter(x => x.address === detail.self).length;
  const total = detail.checkpoints.length;
  const stats: { icon: IconName; value: string; label: string }[] = [
    { icon: 'time', value: clockText(duration), label: 'Duration' },
    {
      icon: 'pin',
      value: a.progress.distanceM > 0 ? formatDistanceIn(a.progress.distanceM, units) : '–',
      label: 'Distance',
    },
    { icon: 'done', value: `${done} / ${total}`, label: 'Phases' },
  ];
  return (
    <Screen
      title="Activity Completed"
      onBack={() => navigation.navigate('AdventureDetails', { adventureId })}
    >
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.list, { alignItems: 'center' }]}>
          <View
            style={[styles.celebrate, { backgroundColor: c.primarySoft }]}
            testID="completed-art"
          >
            <Icon name="trophy" size={72} color={c.primary} />
            <View style={[styles.ribbon, { backgroundColor: c.primary }]}>
              <Text variant="heading" color={c.onPrimary}>
                Activity Completed!
              </Text>
            </View>
          </View>
          <Text variant="title" style={{ textAlign: 'center' }} testID="completed-name">
            {a.name}
          </Text>
          {group ? (
            <Text muted style={{ textAlign: 'center' }}>
              {group.name}
            </Text>
          ) : null}
          <Card style={styles.statRow}>
            {stats.map(s => (
              <View key={s.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Icon name={s.icon} size={22} color={c.primary} />
                <Text variant="cardTitle" style={{ fontVariant: ['tabular-nums'] }}>
                  {s.value}
                </Text>
                <Text variant="caption" muted>
                  {s.label}
                </Text>
              </View>
            ))}
          </Card>
        </ScrollView>
        <View style={[styles.footerColumn, { backgroundColor: c.bg, borderTopColor: c.border }]}>
          <Button
            testID="view-summary"
            label="View Summary"
            onPress={() => navigation.navigate('AdventureSummary', { adventureId })}
          />
          <Button
            testID="share-completed"
            variant="secondary"
            icon="share"
            label="Share"
            onPress={() =>
              void Share.share({
                message: `I finished "${a.name}" on TrailMesh: ${clockText(
                  duration,
                )}, ${done} of ${total} phases.`,
              })
            }
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.gutter, paddingTop: space.sm, gap: space.lg, paddingBottom: space.xxl },
  banner: { height: 150, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flatCard: { paddingVertical: space.xs },
  regionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerColumn: { gap: space.sm, padding: space.gutter, borderTopWidth: StyleSheet.hairlineWidth },
  statRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: space.md,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
  },
  railCol: { alignItems: 'center', alignSelf: 'stretch', width: 28 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: { position: 'absolute', top: 30, bottom: -26, width: 2 },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  photo: { width: '100%', height: 220, borderRadius: radius.lg },
  photoX: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmpty: {
    height: 180,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    padding: space.lg,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 72,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  celebrate: {
    alignSelf: 'stretch',
    height: 220,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  ribbon: { paddingHorizontal: space.xl, paddingVertical: space.sm, borderRadius: radius.md },
});
