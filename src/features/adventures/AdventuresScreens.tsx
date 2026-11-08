import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { achievementById } from '../../domain/adventures/achievements';
import {
  AdventureAction,
  actionsFor,
  completedAt,
  elapsedMs,
  endedFor,
  isFinal,
  isOverFor,
} from '../../domain/adventures/lifecycle';
import { ADVENTURE_DESC_MAX, ADVENTURE_NAME_MAX, Adventure } from '../../domain/adventures/model';
import {
  buildTimeline,
  checkpointStatuses,
  formatClock,
  nextCheckpoint,
  progressCounts,
  progressLabel,
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
import { ActivityStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  IconTile,
  ListRow,
  Row,
  Screen,
  SegmentedTabs,
  Text,
} from '../../ui/components';
import { isEnabled } from '../../shared/features';
import { CoverArt } from '../../ui/activity';
import { isActivity } from './activityFlag';
import { AnimatedProgress } from '../../ui/motion';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow } from '../../ui/useNow';
import { ActivityHome, clockText } from './ActivityRunScreens';
import { EditActivity } from './ActivityScreens';
import {
  KIND_ICON,
  STATUS_LABEL,
  STATUS_TONE,
  formatDate,
  formatTime,
  phaseSummary,
  timelineText,
} from './format';

type Nav<T extends keyof ActivityStackParamList> = NativeStackScreenProps<
  ActivityStackParamList,
  T
>;

function useInput() {
  const { c } = useTheme();
  return useMemo(
    () => [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }],
    [c],
  );
}

// ---- Adventures list and journal ----------------------------------------------------------------

type Row = { adventure: Adventure; done: number; total: number };

/** The Activity tab: planned and active adventures, the journal, and achievements. */
export function AdventuresScreen({ navigation }: Nav<'Adventures'>) {
  const { c } = useTheme();
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
  const open = rows.filter(r => !isOverFor(r.adventure));
  const past = rows.filter(r => isOverFor(r.adventure));
  const earned = achievements.filter(a => a.unlockedAt !== null).length;

  const line = (r: Row) =>
    [
      r.adventure.groupId ? 'Group' : 'Solo',
      `${r.done} of ${r.total} checkpoints`,
      isOverFor(r.adventure)
        ? r.adventure.progress.distanceM > 0
          ? formatDistanceIn(r.adventure.progress.distanceM, units)
          : null
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen
      title="Activity"
      right={
        <IconButton
          testID="new-adventure"
          icon="plus"
          label="New adventure"
          onPress={() => navigation.navigate('AdventureEditor')}
          active
        />
      }
    >
      <ScrollView contentContainerStyle={styles.list}>
        <Card style={styles.flatCard}>
          <ListRow
            testID="open-achievements"
            title="Achievements"
            subtitle={`${earned} of ${achievements.length || 13} earned`}
            leading={<IconTile name="trophy" />}
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
          </>
        ) : past.length === 0 ? (
          <EmptyState
            title="Your journal is empty"
            body="Finished adventures are kept here, on this device only, with their route and checkpoints."
          />
        ) : (
          <View style={{ gap: space.md }} testID="journal-list">
            {past.map(r => {
              const cancelled =
                r.adventure.status === 'cancelled' && completedAt(r.adventure) === null;
              const end = endedFor(r.adventure);
              return (
                <Pressable
                  key={r.adventure.id}
                  testID={`journal-${r.adventure.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={r.adventure.name}
                  onPress={() =>
                    navigation.navigate('AdventureSummary', { adventureId: r.adventure.id })
                  }
                >
                  <Card style={styles.historyCard}>
                    <CoverArt size={64} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text variant="cardTitle" numberOfLines={1}>
                        {r.adventure.name}
                      </Text>
                      <Text variant="caption" muted>
                        {cancelled ? 'Cancelled' : 'Completed'} ·{' '}
                        {formatDate(end ?? r.adventure.createdAt)}
                      </Text>
                      <View style={styles.historyFacts}>
                        <Icon name="pin" size={14} color={c.textMuted} />
                        <Text variant="caption" muted>
                          {r.adventure.progress.distanceM > 0
                            ? formatDistanceIn(r.adventure.progress.distanceM, units)
                            : '–'}
                        </Text>
                        <Icon name="time" size={14} color={c.textMuted} />
                        <Text variant="caption" muted style={{ fontVariant: ['tabular-nums'] }}>
                          {clockText(elapsedMs(r.adventure.progress, end ?? r.adventure.createdAt))}
                        </Text>
                        <Icon name="done" size={14} color={c.textMuted} />
                        <Text variant="caption" muted>
                          {r.done}/{r.total}
                        </Text>
                      </View>
                    </View>
                    {cancelled ? (
                      <Badge label="Cancelled" tone="neutral" />
                    ) : (
                      <Icon name="done" size={26} color={c.primary} />
                    )}
                  </Card>
                </Pressable>
              );
            })}
          </View>
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
  const [ordered, setOrdered] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fix = useLocationStore(s => s.fix);
  const saved = useMarkers().slice(0, 4);
  // With group activities on, a group's adventure is an activity: a private draft until published.
  const asActivity = isEnabled('groupActivities') && groupId !== '';

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
        setOrdered(a.ordered === true);
        setIsDraft(a.status === 'draft');
      }
    });
  }, [adventuresRepo, editingId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { name, description, start: start ? { ...start, label } : null };
    const r = editingId
      ? await service.updateAdventure(editingId, body, isDraft ? { ordered } : {})
      : await service.createAdventure(body, {
          groupId: groupId || undefined,
          ...(asActivity ? { draft: true, ordered } : {}),
        });
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
      title={
        editingId
          ? isDraft
            ? 'Edit activity'
            : 'Edit adventure'
          : asActivity
          ? 'New activity'
          : 'New adventure'
      }
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
            {asActivity ? (
              <Text variant="caption" muted>
                Only you see it until you publish. Publishing starts it for the group: each person
                presses Start for their own timer. Nobody's location is shared by this.
              </Text>
            ) : groupId ? (
              <Text variant="caption" muted>
                Everyone in the group can see it and choose to join. You decide when it starts and
                ends. Nobody's location is shared by this.
              </Text>
            ) : null}
          </>
        ) : null}
        {asActivity || isDraft ? (
          <Card testID="ordered-card">
            <Row>
              <View style={{ flex: 1 }}>
                <Text variant="cardTitle">Do the phases in order</Text>
                <Text variant="caption" muted>
                  {ordered
                    ? 'Each phase unlocks when the one before it is done.'
                    : 'People can do the phases in any order.'}
                </Text>
              </View>
              <Switch
                testID="ordered-switch"
                value={ordered}
                onValueChange={setOrdered}
                accessibilityLabel="Do the phases in order"
              />
            </Row>
          </Card>
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}
        <Button
          testID="adventure-save"
          label={editingId ? 'Save' : asActivity ? 'Create draft' : 'Create adventure'}
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
  publish: 'Publish',
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
  // The organizer's private draft has its own editor; everything else is the shared page.
  if (isActivity(detail.adventure) && detail.adventure.status === 'draft') {
    return <EditActivity detail={detail} navigation={navigation} />;
  }
  if (isActivity(detail.adventure)) {
    return <ActivityHome detail={detail} navigation={navigation} />;
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
  const activity = isActivity(a);
  const isDraft = a.status === 'draft';
  // A published activity is fixed: the organizer can only cancel it.
  const editable = canEdit && !isFinal(a.status) && (!activity || isDraft);
  const noun = activity ? 'activity' : 'adventure';
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

  const publish = () =>
    Alert.alert(
      'Publish this activity?',
      `It goes live for ${
        group?.name ?? 'the group'
      } right away. You cannot change it afterwards; to change it, cancel it and publish a new one.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Publish', onPress: () => void run('publish') },
      ],
    );

  const discard = () =>
    Alert.alert('Discard this draft?', 'Nobody has seen it. It will be deleted.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () =>
          void service.deleteAdventure(a.id).then(r => {
            if (r.ok) {
              navigation.goBack();
            } else {
              setError(r.error.userMessage);
            }
          }),
      },
    ]);

  const participate = async (join: boolean) => {
    const r = join ? await service.join(a.id) : await service.leave(a.id);
    setError(r.ok ? null : r.error.userMessage);
  };

  const actions: AdventureAction[] = !canEdit
    ? []
    : activity
    ? isDraft
      ? []
      : isFinal(a.status)
      ? []
      : ['cancel']
    : actionsFor(a.status);
  const primary: AdventureAction | undefined = activity
    ? undefined
    : a.status === 'planned'
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
        {isDraft ? (
          <Banner
            tone="info"
            title="Draft · only you can see it"
            body={`Add phases, then publish. Publishing starts it for ${
              group?.name ?? 'the group'
            }; each person presses Start for their own timer.`}
          />
        ) : null}
        {a.groupId && !isDraft && a.status !== 'planned' && !joined && !isOverFor(a) ? (
          <Banner
            tone="info"
            title={
              activity ? 'Press Start when you are ready' : 'You have not joined this adventure'
            }
            body={
              activity
                ? 'Your timer starts when you do, and stops when you finish your last phase.'
                : 'Your time, distance and checkpoints are only recorded after you join.'
            }
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

        {isDraft ? null : (
          <Card testID="progress-panel">
            <Text variant="label" muted>
              Your progress
            </Text>
            <View style={styles.metrics}>
              <Metric label="Elapsed" value={formatClock(elapsed)} testID="metric-elapsed" />
              <Metric
                label="Distance"
                value={
                  a.progress.distanceM > 0 ? formatDistanceIn(a.progress.distanceM, units) : '–'
                }
                testID="metric-distance"
              />
              <Metric
                label="Remaining"
                value={String(counts.remaining)}
                testID="metric-remaining"
              />
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
        )}

        {earnedHere.length > 0 ? (
          <Banner
            title={`Earned on this adventure: ${earnedHere
              .map(id => achievementById(id)?.name)
              .filter(Boolean)
              .join(', ')}`}
          />
        ) : null}

        <View style={styles.actions}>
          {isDraft && canEdit ? (
            <>
              <Button
                testID="action-publish"
                label={`Publish to ${group?.name ?? 'the group'}`}
                onPress={publish}
                loading={busy}
                disabled={statuses.length === 0}
              />
              {statuses.length === 0 ? (
                <Text variant="caption" muted>
                  Add at least one phase to publish.
                </Text>
              ) : null}
            </>
          ) : null}
          {a.groupId && !isDraft && !isOverFor(a) ? (
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
                label={activity ? 'Start activity' : 'Join adventure'}
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
          {isOverFor(a) ? (
            <Button
              testID="view-recap"
              label="View recap"
              onPress={() => navigation.replace('AdventureSummary', { adventureId: a.id })}
            />
          ) : null}
        </View>

        <View style={styles.sectionHead}>
          <Text variant="heading">{activity ? 'Phases' : 'Checkpoints'}</Text>
          {editable ? (
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
            {activity
              ? 'No phases yet. A phase can be a place to reach, a task to do, or both.'
              : 'No checkpoints yet. Add places to explore, or long-press the map and choose "Checkpoint".'}
          </Text>
        ) : (
          <Card style={styles.flatCard}>
            {statuses.map((s, i) => (
              <ListRow
                key={s.checkpoint.id}
                testID={`checkpoint-${s.checkpoint.id}`}
                title={s.checkpoint.name}
                subtitle={
                  isDraft
                    ? phaseSummary(s.checkpoint)
                    : s.mine
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
                  navigation.navigate(
                    isDraft && canEdit ? 'CheckpointEditor' : 'CheckpointDetails',
                    {
                      adventureId: a.id,
                      checkpointId: s.checkpoint.id,
                    },
                  )
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
                        label={
                          p.state === 'joined'
                            ? activity
                              ? 'Started'
                              : 'Joined'
                            : p.state === 'done'
                            ? 'Finished'
                            : 'Left'
                        }
                        tone={p.state === 'left' ? 'neutral' : 'good'}
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
          {editable ? (
            <Button
              testID="edit-details"
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
          {canEdit && !isFinal(a.status) && !isDraft ? (
            <Button
              testID="action-cancel"
              variant="ghost"
              label={`Cancel ${noun}`}
              onPress={() => confirm('cancel')}
            />
          ) : null}
          {isDraft && canEdit ? (
            <Button
              testID="action-discard"
              variant="ghost"
              label="Discard draft"
              onPress={discard}
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

export { timelineText } from './format';

const styles = StyleSheet.create({
  historyCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  historyFacts: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
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
