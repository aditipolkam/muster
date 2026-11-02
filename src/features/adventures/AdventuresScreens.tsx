import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { achievementById } from '../../domain/adventures/achievements';
import { AdventureAction, actionsFor, elapsedMs, isFinal } from '../../domain/adventures/lifecycle';
import { ADVENTURE_DESC_MAX, ADVENTURE_NAME_MAX, Adventure } from '../../domain/adventures/model';
import {
  buildTimeline,
  checkpointStatuses,
  formatClock,
  nextCheckpoint,
  progressCounts,
  progressLabel,
  TimelineEntry,
} from '../../domain/adventures/stats';
import { formatDistanceIn } from '../../domain/geo/pace';
import { canEditAdventure } from '../../domain/adventures/authorize';
import { useLocationStore } from '../../platform/locationStore';
import {
  AdventureDetail,
  useAchievements,
  useAdventureDetail,
  useAdventures,
  useAdventureRuntime,
  useGroupMembers,
  useGroupPoints,
  useGroups,
  useLiveQuery,
  useMarkers,
  useMesh,
  useNavPrefs,
  useUnlocksFor,
} from '../../runtime/hooks';
import { MoreStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  IconTile,
  ListRow,
  Screen,
  SegmentedTabs,
  Text,
} from '../../ui/components';
import { AnimatedProgress } from '../../ui/motion';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow } from '../../ui/useNow';
import { KIND_ICON, STATUS_LABEL, STATUS_TONE, formatDate, formatTime } from './format';

type Nav<T extends keyof MoreStackParamList> = NativeStackScreenProps<MoreStackParamList, T>;

function useInput() {
  const { c } = useTheme();
  return useMemo(
    () => [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }],
    [c],
  );
}

// ---- Adventures list and journal ----------------------------------------------------------------

type Row = { adventure: Adventure; done: number; total: number };

export function AdventuresScreen({ navigation }: Nav<'Adventures'>) {
  const adventures = useAdventures();
  const achievements = useAchievements();
  const { adventuresRepo, adventures: service } = useServices();
  const { units } = useNavPrefs();
  const [tab, setTab] = useState<'now' | 'journal'>('now');
  const rows = useLiveQuery<Row[]>(
    [adventuresRepo.changes as never],
    async () => {
      const out: Row[] = [];
      for (const a of await adventuresRepo.list()) {
        const self = service.selfFor(a);
        out.push({
          adventure: a,
          total: (await adventuresRepo.checkpoints(a.id)).length,
          done: self
            ? (await adventuresRepo.completions(a.id)).filter(x => x.address === self).length
            : 0,
        });
      }
      return out;
    },
    [],
  );
  void adventures;
  const open = rows.filter(r => !isFinal(r.adventure.status));
  const past = rows.filter(r => isFinal(r.adventure.status));
  const earned = achievements.filter(a => a.unlockedAt !== null).length;

  const line = (r: Row) =>
    [
      r.adventure.groupId ? 'Group' : 'Solo',
      `${r.done} of ${r.total} checkpoints`,
      r.adventure.status === 'completed' || r.adventure.status === 'cancelled'
        ? r.adventure.progress.distanceM > 0
          ? formatDistanceIn(r.adventure.progress.distanceM, units)
          : null
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen title="Adventures" onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list}>
        <Card style={styles.flatCard}>
          <ListRow
            testID="open-achievements"
            title="Achievements"
            subtitle={`${earned} of ${achievements.length || 13} earned`}
            leading={<IconTile name="flag" />}
            chevron
            divider={false}
            onPress={() => navigation.navigate('Achievements')}
          />
        </Card>
        <SegmentedTabs
          options={[
            { value: 'now', label: 'Planned and active' },
            { value: 'journal', label: 'Journal' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'now' ? (
          <>
            {open.length === 0 ? (
              <EmptyState
                title="No adventures yet"
                body="Plan a hike, a camping trip or a day out. Add checkpoints along the way and mark them as you go. It works with no signal."
              />
            ) : (
              <Card style={styles.flatCard}>
                {open.map((r, i) => (
                  <ListRow
                    key={r.adventure.id}
                    testID={`adventure-${r.adventure.id}`}
                    title={r.adventure.name}
                    subtitle={line(r)}
                    leading={<IconTile name="trail" />}
                    trailing={
                      <Badge
                        label={STATUS_LABEL[r.adventure.status]}
                        tone={STATUS_TONE[r.adventure.status]}
                      />
                    }
                    chevron
                    divider={i < open.length - 1}
                    onPress={() =>
                      navigation.navigate('AdventureDetails', { adventureId: r.adventure.id })
                    }
                  />
                ))}
              </Card>
            )}
            <Button
              testID="new-adventure"
              label="New adventure"
              icon="plus"
              onPress={() => navigation.navigate('AdventureEditor')}
            />
          </>
        ) : past.length === 0 ? (
          <EmptyState
            title="Your journal is empty"
            body="Finished adventures are kept here, on this device only, with their route and checkpoints."
          />
        ) : (
          <Card style={styles.flatCard}>
            {past.map((r, i) => (
              <ListRow
                key={r.adventure.id}
                testID={`journal-${r.adventure.id}`}
                title={r.adventure.name}
                subtitle={`${formatDate(r.adventure.endedAt ?? r.adventure.createdAt)} · ${line(
                  r,
                )}`}
                leading={<IconTile name="trail" />}
                trailing={
                  r.adventure.status === 'cancelled' ? (
                    <Badge label="Cancelled" tone="neutral" />
                  ) : undefined
                }
                chevron
                divider={i < past.length - 1}
                onPress={() =>
                  navigation.navigate('AdventureSummary', { adventureId: r.adventure.id })
                }
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---- Create / edit --------------------------------------------------------------------------------

export function AdventureEditorScreen({ navigation, route }: Nav<'AdventureEditor'>) {
  const { adventures: service, adventuresRepo } = useServices();
  const input = useInput();
  const groups = useGroups().filter(g => g.role === 'organizer' && g.status === 'active');
  const editingId = route.params?.adventureId;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState<{ lat: number; lon: number } | null>(null);
  const [groupId, setGroupId] = useState<string>(route.params?.groupId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fix = useLocationStore(s => s.fix);
  const saved = useMarkers().slice(0, 4);

  React.useEffect(() => {
    if (!editingId) {
      return;
    }
    void adventuresRepo.get(editingId).then(a => {
      if (a) {
        setName(a.name);
        setDescription(a.description ?? '');
        setLabel(a.startLabel ?? '');
        setStart(
          a.startLat !== null && a.startLon !== null ? { lat: a.startLat, lon: a.startLon } : null,
        );
      }
    });
  }, [adventuresRepo, editingId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { name, description, start: start ? { ...start, label } : null };
    const r = editingId
      ? await service.updateAdventure(editingId, body)
      : await service.createAdventure(body, { groupId: groupId || undefined });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    if (editingId) {
      navigation.goBack();
    } else {
      navigation.replace('AdventureDetails', { adventureId: r.value.id });
    }
  };

  return (
    <Screen
      title={editingId ? 'Edit adventure' : 'New adventure'}
      onBack={() => navigation.goBack()}
    >
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text variant="label" muted>
          Name
        </Text>
        <TextInput
          testID="adventure-name"
          style={input}
          value={name}
          onChangeText={setName}
          maxLength={ADVENTURE_NAME_MAX}
          placeholder="Saturday ridge walk"
          accessibilityLabel="Adventure name"
        />
        <Text variant="label" muted>
          Description (optional)
        </Text>
        <TextInput
          testID="adventure-description"
          style={[input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          maxLength={ADVENTURE_DESC_MAX}
          multiline
          placeholder="Bring layers and a headtorch"
          accessibilityLabel="Description"
        />
        <Text variant="label" muted>
          Starting location (optional)
        </Text>
        {start ? (
          <Card>
            <Text variant="cardTitle">{label || 'Starting point'}</Text>
            <Text variant="caption" muted>
              {start.lat.toFixed(5)}, {start.lon.toFixed(5)}
            </Text>
          </Card>
        ) : null}
        <TextInput
          testID="adventure-start-label"
          style={input}
          value={label}
          onChangeText={setLabel}
          maxLength={60}
          placeholder="Car park, trailhead…"
          accessibilityLabel="Starting location name"
        />
        <View style={styles.rowGap}>
          <Button
            testID="use-my-location"
            variant="secondary"
            icon="locate"
            label="Use my location"
            disabled={!fix}
            onPress={() => fix && setStart({ lat: fix.lat, lon: fix.lon })}
            style={{ flex: 1 }}
          />
          {start ? <Button variant="ghost" label="Clear" onPress={() => setStart(null)} /> : null}
        </View>
        {saved.length > 0 ? (
          <View style={styles.rowGap}>
            {saved.map(m => (
              <Button
                key={m.id}
                small
                variant="ghost"
                label={m.name}
                testID={`start-from-${m.id}`}
                onPress={() => {
                  setStart({ lat: m.lat, lon: m.lon });
                  setLabel(l => l || m.name);
                }}
              />
            ))}
          </View>
        ) : null}
        {!fix ? (
          <Text variant="caption" muted>
            No GPS fix yet. Pick a saved place, set the start later, or add checkpoints from the
            map.
          </Text>
        ) : null}
        {!editingId && groups.length > 0 ? (
          <>
            <Text variant="label" muted>
              Who is it for?
            </Text>
            <SegmentedTabs
              options={[
                { value: '', label: 'Just me' },
                ...groups.slice(0, 3).map(g => ({ value: g.id, label: g.name })),
              ]}
              value={groupId}
              onChange={setGroupId}
            />
            {groupId ? (
              <Text variant="caption" muted>
                Everyone in the group can see it and choose to join. You decide when it starts and
                ends. Nobody's location is shared by this.
              </Text>
            ) : null}
          </>
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}
        <Button
          testID="adventure-save"
          label={editingId ? 'Save' : 'Create adventure'}
          onPress={() => void save()}
          loading={busy}
          disabled={!name.trim()}
        />
      </ScrollView>
    </Screen>
  );
}

// ---- Details and active progress ---------------------------------------------------------------------

const ACTION_LABEL: Record<AdventureAction, string> = {
  start: 'Start adventure',
  pause: 'Pause',
  resume: 'Resume',
  complete: 'Finish adventure',
  cancel: 'Cancel adventure',
};

export function AdventureDetailsScreen({ navigation, route }: Nav<'AdventureDetails'>) {
  const detail = useAdventureDetail(route.params.adventureId);
  if (!detail) {
    return (
      <Screen title="Adventure" onBack={() => navigation.goBack()}>
        <EmptyState
          title="Adventure not found"
          body="It may have been deleted from this device."
          actionLabel="Back to adventures"
          onAction={() => navigation.navigate('Adventures')}
        />
      </Screen>
    );
  }
  return <Details detail={detail} navigation={navigation} />;
}

function Details({
  detail,
  navigation,
}: {
  detail: AdventureDetail;
  navigation: Nav<'AdventureDetails'>['navigation'];
}) {
  const { c } = useTheme();
  const { adventures: service } = useServices();
  const mesh = useMesh();
  const now = useNow();
  const { units } = useNavPrefs();
  const rt = useAdventureRuntime();
  const {
    adventure: a,
    self,
    checkpoints,
    completions,
    participants,
    log: statusLog,
    joined,
  } = detail;
  const groups = useGroups();
  const group = groups.find(g => g.id === a.groupId) ?? null;
  const members = useGroupMembers(a.groupId ?? '');
  const meetingPoints = useGroupPoints(a.groupId ?? '').filter(p => !p.deleted);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const earnedHere = useUnlocksFor(a.id);

  const canEdit = canEditAdventure(a, group, mesh.localAddress);
  const statuses = checkpointStatuses(checkpoints, completions, participants, self);
  const counts = progressCounts(statuses, self);
  const next = nextCheckpoint(statuses);
  const running = a.status === 'active' && joined;
  const elapsed = elapsedMs(a.progress, now);
  const nameOf = (addr: string) =>
    addr === self
      ? 'You'
      : members.find(m => m.address === addr)?.name ??
        participants.find(p => p.address === addr)?.name ??
        'Someone';
  const timeline = useMemo(
    () =>
      a.groupId
        ? buildTimeline({
            adventure: a,
            log: statusLog,
            completions,
            participants,
            checkpoints,
            me: self,
          })
        : [],
    [a, statusLog, completions, participants, checkpoints, self],
  );

  const run = async (action: AdventureAction) => {
    setBusy(true);
    setError(null);
    const r = await service.act(a.id, action);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
    } else if (action === 'complete') {
      navigation.replace('AdventureSummary', { adventureId: a.id, celebrate: true });
    }
  };

  const confirm = (action: 'complete' | 'cancel') => {
    const copy =
      action === 'complete'
        ? [
            'Finish this adventure?',
            'It moves to your journal. You can end it whenever you like, there is no minimum.',
          ]
        : [
            'Cancel this adventure?',
            'What you recorded stays in your journal. Stopping early is always fine.',
          ];
    Alert.alert(copy[0] as string, copy[1], [
      { text: 'Keep going', style: 'cancel' },
      {
        text: action === 'complete' ? 'Finish' : 'Cancel adventure',
        style: action === 'cancel' ? 'destructive' : 'default',
        onPress: () => void run(action),
      },
    ]);
  };

  const participate = async (join: boolean) => {
    const r = join ? await service.join(a.id) : await service.leave(a.id);
    setError(r.ok ? null : r.error.userMessage);
  };

  const actions = canEdit ? actionsFor(a.status) : [];
  const primary: AdventureAction | undefined =
    a.status === 'planned'
      ? 'start'
      : a.status === 'paused'
      ? 'resume'
      : a.status === 'active'
      ? 'pause'
      : undefined;

  return (
    <Screen title={a.name} onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.rowGap}>
          <Badge label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} />
          {group ? (
            <Badge label={`Group · ${group.name}`} tone="neutral" />
          ) : (
            <Badge label="Solo" />
          )}
        </View>
        {a.description ? <Text muted>{a.description}</Text> : null}
        {a.startLabel || a.startLat !== null ? (
          <Text variant="caption" muted>
            Start: {a.startLabel ?? `${a.startLat?.toFixed(4)}, ${a.startLon?.toFixed(4)}`}
          </Text>
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}
        {a.groupId && a.status !== 'planned' && !joined && !isFinal(a.status) ? (
          <Banner
            tone="info"
            title="You have not joined this adventure"
            body="Your time, distance and checkpoints are only recorded after you join."
          />
        ) : null}
        {rt.hint && rt.hint.adventureId === a.id ? (
          <Banner
            tone="info"
            title={
              rt.hint.state === 'uncertain' ? `Near ${rt.hint.name}` : `Approaching ${rt.hint.name}`
            }
            body={
              rt.hint.state === 'uncertain'
                ? 'GPS is too imprecise to confirm. You can mark it yourself when you are there.'
                : `About ${formatDistanceIn(rt.hint.distM, units)} away.`
            }
          />
        ) : null}

        <Card testID="progress-panel">
          <Text variant="label" muted>
            Your progress
          </Text>
          <View style={styles.metrics}>
            <Metric label="Elapsed" value={formatClock(elapsed)} testID="metric-elapsed" />
            <Metric
              label="Distance"
              value={a.progress.distanceM > 0 ? formatDistanceIn(a.progress.distanceM, units) : '–'}
              testID="metric-distance"
            />
            <Metric label="Remaining" value={String(counts.remaining)} testID="metric-remaining" />
          </View>
          <Text variant="cardTitle" testID="progress-label">
            {progressLabel(counts)}
          </Text>
          <AnimatedProgress
            value={counts.total === 0 ? 0 : counts.mine / counts.total}
            color={c.primary}
            track={c.surfaceAlt}
            testID="progress-bar"
          />
          {running && a.progress.distanceM === 0 ? (
            <Text variant="caption" muted>
              Distance is recorded from GPS while the adventure is active. Standing still adds
              nothing.
            </Text>
          ) : null}
          {a.groupId ? (
            <Text variant="caption" muted>
              Group: {counts.everyone} of {counts.total} reached by everyone who joined
            </Text>
          ) : null}
        </Card>

        {earnedHere.length > 0 ? (
          <Banner
            title={`Earned on this adventure: ${earnedHere
              .map(id => achievementById(id)?.name)
              .filter(Boolean)
              .join(', ')}`}
          />
        ) : null}

        <View style={styles.actions}>
          {a.groupId && !isFinal(a.status) ? (
            joined ? (
              !canEdit ? (
                <Button
                  variant="secondary"
                  label="Leave adventure"
                  onPress={() => void participate(false)}
                />
              ) : null
            ) : (
              <Button
                testID="join-adventure"
                label="Join adventure"
                onPress={() => void participate(true)}
              />
            )
          ) : null}
          {primary && actions.includes(primary) ? (
            <Button
              testID={`action-${primary}`}
              label={ACTION_LABEL[primary]}
              onPress={() => void run(primary)}
              loading={busy}
              variant={primary === 'pause' ? 'secondary' : 'primary'}
            />
          ) : null}
          {actions.includes('complete') ? (
            <Button
              testID="action-complete"
              label={ACTION_LABEL.complete}
              onPress={() => confirm('complete')}
              variant={primary === 'pause' ? 'primary' : 'secondary'}
            />
          ) : null}
          {isFinal(a.status) ? (
            <Button
              testID="view-recap"
              label="View recap"
              onPress={() => navigation.replace('AdventureSummary', { adventureId: a.id })}
            />
          ) : null}
        </View>

        <View style={styles.sectionHead}>
          <Text variant="heading">Checkpoints</Text>
          {canEdit && !isFinal(a.status) ? (
            <Button
              testID="add-checkpoint"
              small
              variant="secondary"
              icon="plus"
              label="Add"
              onPress={() => navigation.navigate('CheckpointEditor', { adventureId: a.id })}
            />
          ) : null}
        </View>
        {statuses.length === 0 ? (
          <Text muted>
            No checkpoints yet. Add places to explore, or long-press the map and choose
            "Checkpoint".
          </Text>
        ) : (
          <Card style={styles.flatCard}>
            {statuses.map((s, i) => (
              <ListRow
                key={s.checkpoint.id}
                testID={`checkpoint-${s.checkpoint.id}`}
                title={s.checkpoint.name}
                subtitle={
                  s.mine
                    ? `Reached ${formatTime(s.mine.at)}${
                        s.mine.method === 'manual' ? ' · confirmed by you' : ''
                      }`
                    : next?.id === s.checkpoint.id
                    ? 'Next'
                    : undefined
                }
                leading={
                  <IconTile
                    name={s.mine ? 'check' : KIND_ICON[s.checkpoint.kind]}
                    color={s.mine ? c.onPrimary : c.primary}
                    bg={s.mine ? c.primary : undefined}
                  />
                }
                trailing={
                  a.groupId && s.reachedBy.length > 0 ? (
                    <Badge
                      label={`${s.reachedBy.length} reached`}
                      tone={s.everyone ? 'good' : 'neutral'}
                    />
                  ) : undefined
                }
                chevron
                divider={i < statuses.length - 1}
                onPress={() =>
                  navigation.navigate('CheckpointDetails', {
                    adventureId: a.id,
                    checkpointId: s.checkpoint.id,
                  })
                }
              />
            ))}
          </Card>
        )}

        {a.groupId ? (
          <>
            {meetingPoints.length > 0 ? (
              <>
                <Text variant="heading">Current meeting point</Text>
                <Card style={styles.flatCard}>
                  <ListRow
                    title={meetingPoints[0]?.name ?? ''}
                    subtitle={meetingPoints[0]?.note ?? 'Shared by the organizer'}
                    leading={<IconTile name="flag" color={c.mapMeeting} bg={c.mapMeeting + '22'} />}
                    chevron
                    divider={false}
                    onPress={() =>
                      (
                        navigation.getParent() as
                          | { navigate: (n: string, p: object) => void }
                          | undefined
                      )?.navigate('Navigate', {
                        groupId: a.groupId as string,
                        pointId: meetingPoints[0]?.id,
                      })
                    }
                  />
                </Card>
              </>
            ) : null}
            <Text variant="heading">Participants</Text>
            <Card style={styles.flatCard}>
              {participants.length === 0 ? (
                <Text muted>Nobody has joined yet.</Text>
              ) : (
                participants.map((p, i) => (
                  <ListRow
                    key={p.address}
                    title={p.address === self ? `${p.name} (you)` : p.name}
                    subtitle={`${
                      statuses.filter(s => s.reachedBy.some(x => x.address === p.address)).length
                    } of ${statuses.length} checkpoints`}
                    trailing={
                      <Badge
                        label={p.state === 'joined' ? 'Joined' : 'Left'}
                        tone={p.state === 'joined' ? 'good' : 'neutral'}
                      />
                    }
                    divider={i < participants.length - 1}
                  />
                ))
              )}
            </Card>
            <Text variant="heading">Activity</Text>
            <Card style={styles.flatCard} testID="timeline">
              {timeline.map((e, i) => (
                <ListRow
                  key={e.key}
                  title={timelineText(
                    e,
                    nameOf,
                    statuses.map(s => s.checkpoint),
                  )}
                  subtitle={`${formatDate(e.at)} · ${formatTime(e.at)}${
                    e.relayed ? ' · reported by the organizer' : ''
                  }`}
                  divider={i < timeline.length - 1}
                />
              ))}
            </Card>
            <Text variant="caption" muted>
              Progress is shared when devices are in range of the organizer. A missing line means
              that update has not reached this device yet, not that it did not happen.
            </Text>
          </>
        ) : null}

        <View style={styles.rowGap}>
          {canEdit && !isFinal(a.status) ? (
            <Button
              variant="ghost"
              label="Edit details"
              onPress={() => navigation.navigate('AdventureEditor', { adventureId: a.id })}
            />
          ) : null}
          <Button
            variant="ghost"
            label="Show on map"
            onPress={() =>
              (
                navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined
              )?.navigate('Map', { showAdventure: a.id, nonce: Date.now() })
            }
          />
          {canEdit && !isFinal(a.status) ? (
            <Button
              testID="action-cancel"
              variant="ghost"
              label="Cancel adventure"
              onPress={() => confirm('cancel')}
            />
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Metric({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="heading" style={{ fontVariant: ['tabular-nums'] }} testID={testID}>
        {value}
      </Text>
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );
}

export function timelineText(
  e: TimelineEntry,
  nameOf: (addr: string) => string,
  cps: { id: string; name: string }[],
): string {
  const cp = cps.find(c => c.id === e.checkpointId)?.name ?? 'a checkpoint';
  switch (e.kind) {
    case 'created':
      return 'Adventure planned';
    case 'status':
      return `Adventure ${e.status === 'active' ? 'started or resumed' : e.status}`;
    case 'joined':
      return `${nameOf(e.address ?? '')} joined`;
    case 'left':
      return `${nameOf(e.address ?? '')} left`;
    case 'reached':
      return `${nameOf(e.address ?? '')} reached ${cp}`;
    case 'all_reached':
      return `Everyone has reached ${cp}`;
  }
}

const styles = StyleSheet.create({
  list: { padding: space.gutter, paddingTop: 0, gap: space.md, paddingBottom: space.xxl },
  flatCard: { paddingVertical: space.xs },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 15,
  },
  multiline: { minHeight: 88, paddingTop: space.md, textAlignVertical: 'top' },
  rowGap: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  metrics: { flexDirection: 'row', gap: space.md, marginVertical: space.sm },
  actions: { gap: space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
