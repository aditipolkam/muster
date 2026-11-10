import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  boxSideKm,
  DEFAULT_AREA_MAX_ZOOM,
  DEFAULT_AREA_MIN_ZOOM,
  estimateAreaBytes,
} from '../../domain/adventures/area';
import {
  ADVENTURE_DESC_MAX,
  ADVENTURE_NAME_MAX,
  CHECKPOINT_DESC_MAX,
  CHECKPOINT_NAME_MAX,
  PHASE_RADIUS_MAX_M,
  PHASE_RADIUS_MIN_M,
  PHASE_TYPES,
  PhaseType,
  placeOf,
} from '../../domain/adventures/model';
import {
  formatBytesShort,
  formatDurationRange,
  summarizeActivity,
} from '../../domain/adventures/phases';
import { formatCoord } from '../../domain/geo';
import { formatDistanceIn } from '../../domain/geo/pace';
import { AdventureDetail, useGroups, useNavPrefs } from '../../runtime/hooks';
import { ActivityStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import { CoverArt, FactRow, Slider, ToggleRow } from '../../ui/activity';
import {
  Badge,
  Banner,
  Button,
  Card,
  Icon,
  IconTile,
  Input,
  ListRow,
  Screen,
  SegmentedTabs,
  Text,
} from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';
import { PHASE_ICON } from './format';

type Nav<T extends keyof ActivityStackParamList> = NativeStackScreenProps<
  ActivityStackParamList,
  T
>;

const DEFAULT_RADIUS_M = 50;

// ---- Edit Activity (the organizer's private draft) -------------------------------------------

type DraftTab = 'details' | 'phases' | 'settings';

export function EditActivity({
  detail,
  navigation,
}: {
  detail: AdventureDetail;
  navigation: Nav<'AdventureDetails'>['navigation'];
}) {
  const { adventures: service } = useServices();
  const { c } = useTheme();
  const group = useGroups().find(g => g.id === detail.adventure.groupId) ?? null;
  const a = detail.adventure;
  const [tab, setTab] = useState<DraftTab>('phases');
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description ?? '');
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phases = detail.checkpoints;
  const summary = summarizeActivity(phases);

  const save = async (): Promise<boolean> => {
    if (name.trim() === a.name && description.trim() === (a.description ?? '')) {
      return true;
    }
    const r = await service.updateAdventure(a.id, {
      name,
      description,
      start:
        a.startLat !== null && a.startLon !== null
          ? { lat: a.startLat, lon: a.startLon, label: a.startLabel }
          : null,
    });
    setError(r.ok ? null : r.error.userMessage);
    return r.ok;
  };

  const publish = async () => {
    if (!(await save())) {
      return;
    }
    Alert.alert(
      'Publish this activity?',
      `It goes live for ${
        group?.name ?? 'the group'
      } right away. You cannot change it afterwards; to change it, cancel it and publish a new one.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Publish',
          onPress: () => {
            setBusy(true);
            void service.act(a.id, 'publish').then(r => {
              setBusy(false);
              setError(r.ok ? null : r.error.userMessage);
            });
          },
        },
      ],
    );
  };

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

  return (
    <Screen
      title="Edit Activity"
      onBack={() => void save().then(() => navigation.goBack())}
      right={<Badge label="Draft" tone="warn" />}
    >
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <Card style={styles.summary} testID="draft-summary">
            <CoverArt size={64} />
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={2}>
                {name.trim() || 'Untitled activity'}
              </Text>
              <Text variant="caption" muted>
                {summary.phases} {summary.phases === 1 ? 'phase' : 'phases'}
                {summary.minutes ? `  ·  Est. ${formatDurationRange(summary.minutes)}` : ''}
              </Text>
            </View>
          </Card>

          <SegmentedTabs<DraftTab>
            options={[
              { value: 'details', label: 'Details' },
              { value: 'phases', label: 'Phases' },
              { value: 'settings', label: 'Settings' },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'details' ? (
            <View style={{ gap: space.sm }}>
              <Text variant="label" muted>
                Activity name
              </Text>
              <Input
                testID="activity-name"
                value={name}
                onChangeText={setName}
                onEndEditing={() => void save()}
                maxLength={ADVENTURE_NAME_MAX}
                placeholder="Valley Nature Quest"
                accessibilityLabel="Activity name"
              />
              <Text variant="label" muted>
                Description (optional)
              </Text>
              <Input
                testID="activity-description"
                value={description}
                onChangeText={setDescription}
                onEndEditing={() => void save()}
                maxLength={ADVENTURE_DESC_MAX}
                multiline
                placeholder="A fun nature walk with exploration and small challenges."
                accessibilityLabel="Description"
              />
              <Text variant="caption" muted>
                Only {group?.name ?? 'your group'} sees this, once you publish it.
              </Text>
            </View>
          ) : null}

          {tab === 'phases' ? (
            <View style={{ gap: space.md }}>
              <View style={styles.sectionHead}>
                <Text variant="heading">Activity Phases</Text>
                {phases.length > 1 ? (
                  <Pressable
                    testID="reorder-toggle"
                    accessibilityRole="button"
                    onPress={() => setReordering(r => !r)}
                    hitSlop={8}
                  >
                    <Text color={c.primary} style={{ fontWeight: '600' }}>
                      {reordering ? 'Done' : 'Reorder'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {phases.length === 0 ? (
                <Text muted>
                  No phases yet. A phase can be a place to reach, something to collect, a photo or
                  any task.
                </Text>
              ) : (
                <Card style={styles.flatCard}>
                  {phases.map((p, i) => (
                    <ListRow
                      key={p.id}
                      testID={`phase-${p.id}`}
                      title={`${i + 1}. ${p.name}`}
                      leading={
                        <View style={styles.leadRow}>
                          <Icon name="grip" size={22} color={c.textMuted} />
                          <IconTile name={PHASE_ICON[p.type]} />
                        </View>
                      }
                      trailing={
                        reordering ? (
                          <View style={styles.leadRow}>
                            <Pressable
                              testID={`move-up-${p.id}`}
                              accessibilityRole="button"
                              accessibilityLabel={`Move ${p.name} up`}
                              disabled={i === 0}
                              onPress={() => void service.movePhase(a.id, p.id, -1)}
                              hitSlop={6}
                              style={{ opacity: i === 0 ? 0.3 : 1 }}
                            >
                              <Icon name="up" size={22} color={c.primary} />
                            </Pressable>
                            <Pressable
                              testID={`move-down-${p.id}`}
                              accessibilityRole="button"
                              accessibilityLabel={`Move ${p.name} down`}
                              disabled={i === phases.length - 1}
                              onPress={() => void service.movePhase(a.id, p.id, 1)}
                              hitSlop={6}
                              style={{ opacity: i === phases.length - 1 ? 0.3 : 1 }}
                            >
                              <Icon name="down" size={22} color={c.primary} />
                            </Pressable>
                          </View>
                        ) : undefined
                      }
                      chevron={!reordering}
                      divider={i < phases.length - 1}
                      onPress={
                        reordering
                          ? undefined
                          : () =>
                              navigation.navigate('CheckpointEditor', {
                                adventureId: a.id,
                                checkpointId: p.id,
                              })
                      }
                    />
                  ))}
                </Card>
              )}
              <Button
                testID="add-phase"
                variant="secondary"
                icon="plus"
                label="Add Phase"
                onPress={() => navigation.navigate('AddPhase', { adventureId: a.id })}
              />
            </View>
          ) : null}

          {tab === 'settings' ? (
            <View style={{ gap: space.md }}>
              <Card>
                <ToggleRow
                  testID="ordered-switch"
                  icon="list"
                  title="Do the phases in order"
                  body={
                    a.ordered
                      ? 'Each phase unlocks when the one before it is done.'
                      : 'People can do the phases in any order.'
                  }
                  value={a.ordered === true}
                  onChange={v =>
                    void service
                      .updateAdventure(
                        a.id,
                        {
                          name: a.name,
                          description: a.description,
                          start:
                            a.startLat !== null && a.startLon !== null
                              ? { lat: a.startLat, lon: a.startLon, label: a.startLabel }
                              : null,
                        },
                        { ordered: v },
                      )
                      .then(r => setError(r.ok ? null : r.error.userMessage))
                  }
                />
              </Card>
              <Card>
                <FactRow
                  icon="group"
                  label="Who it is for"
                  value={`${group?.name ?? 'Your group'}. Nobody sees it until you publish.`}
                />
              </Card>
              <Button
                testID="action-discard"
                variant="ghost"
                label="Discard draft"
                onPress={discard}
              />
            </View>
          ) : null}

          {error ? <Banner tone="error" title={error} /> : null}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>
          <Button
            testID="save-draft"
            style={{ flex: 1 }}
            variant="secondary"
            label="Save Draft"
            onPress={() => void save().then(ok => ok && navigation.goBack())}
          />
          <Button
            testID="action-publish"
            style={{ flex: 1 }}
            icon="send"
            label="Publish"
            loading={busy}
            disabled={phases.length === 0 || !name.trim()}
            onPress={() => void publish()}
          />
        </View>
      </View>
    </Screen>
  );
}

// ---- Add Phase: what kind of phase is this? ---------------------------------------------------

export function AddPhaseScreen({ navigation, route }: Nav<'AddPhase'>) {
  const { c } = useTheme();
  const [type, setType] = useState<PhaseType>('checkpoint');
  return (
    <Screen title="Add Phase" onBack={() => navigation.goBack()}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.list}>
          <Text variant="heading">What kind of phase is this?</Text>
          {PHASE_TYPES.map(t => {
            const on = t.type === type;
            return (
              <Pressable
                key={t.type}
                testID={`phase-type-${t.type}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setType(t.type)}
                style={[
                  styles.typeCard,
                  {
                    borderColor: on ? c.primary : c.border,
                    backgroundColor: on ? c.primarySoft : c.surface,
                  },
                ]}
              >
                <IconTile name={PHASE_ICON[t.type]} />
                <View style={{ flex: 1 }}>
                  <Text variant="cardTitle">{t.label}</Text>
                  <Text variant="caption" muted>
                    {t.hint}
                  </Text>
                </View>
                {on ? (
                  <View style={[styles.tick, { backgroundColor: c.primary }]}>
                    <Icon name="check" size={16} color={c.onPrimary} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>
          <Button
            testID="phase-type-continue"
            style={{ flex: 1 }}
            label="Continue"
            onPress={() =>
              navigation.replace('CheckpointEditor', {
                adventureId: route.params.adventureId,
                type,
              })
            }
          />
        </View>
      </View>
    </Screen>
  );
}

// ---- Add / edit a phase ---------------------------------------------------------------------

const TITLES: Record<PhaseType, string> = {
  checkpoint: 'Checkpoint',
  collect: 'Collect Item',
  photo: 'Take a Photo',
  task: 'Custom Task',
};

type Box = [number, number, number, number];

export function PhaseEditor({ navigation, route }: Nav<'CheckpointEditor'>) {
  const { adventureId, checkpointId } = route.params;
  const { adventures: service, adventuresRepo } = useServices();
  const { c } = useTheme();
  const [type, setType] = useState<PhaseType>(route.params.type ?? 'checkpoint');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [radiusM, setRadiusM] = useState(DEFAULT_RADIUS_M);
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [includeRegion, setIncludeRegion] = useState(true);
  const [region, setRegion] = useState<Box | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!checkpointId) {
      return;
    }
    void adventuresRepo.checkpoint(adventureId, checkpointId).then(cp => {
      if (cp) {
        setType(cp.type);
        setName(cp.name);
        setDescription(cp.description ?? '');
        setPos(placeOf(cp));
        setRadiusM(cp.radiusM ?? DEFAULT_RADIUS_M);
        setRequirePhoto(cp.requirePhoto);
        setRegion(cp.region);
        setIncludeRegion(cp.region !== null || placeOf(cp) === null);
      }
    });
  }, [adventureId, checkpointId, adventuresRepo]);

  // Back from "Select Location" on the map with a place (and its offline region).
  const picked = route.params.picked;
  useEffect(() => {
    if (picked) {
      setPos({ lat: picked.lat, lon: picked.lon });
      setRegion(picked.region);
      setIncludeRegion(picked.region !== null);
    }
  }, [picked?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsPlace = type === 'checkpoint';
  const canHavePlace = type === 'checkpoint' || type === 'collect';
  const label = TITLES[type];
  const sizeBytes = region
    ? estimateAreaBytes(region, DEFAULT_AREA_MIN_ZOOM, DEFAULT_AREA_MAX_ZOOM)
    : 0;

  const chooseLocation = () =>
    (navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined)?.navigate(
      'Map',
      {
        pick: {
          adventureId,
          checkpointId,
          type,
          lat: pos?.lat,
          lon: pos?.lon,
          includeRegion,
          region,
        },
        nonce: Date.now(),
      },
    );

  const save = async () => {
    if (needsPlace && !pos) {
      setError('Choose where it is: tap Select Location.');
      return;
    }
    setBusy(true);
    setError(null);
    const hasPlace = canHavePlace && pos !== null;
    const body = {
      name,
      description,
      kind: 'other' as const,
      type,
      radiusM: hasPlace ? radiusM : null,
      requirePhoto: type === 'photo' ? true : requirePhoto,
      ...(hasPlace && pos ? pos : {}),
      // No map region when the toggle is off; otherwise the box chosen on the map, or, if none
      // was chosen, the default box round the place.
      ...(hasPlace ? { region: includeRegion ? region ?? undefined : null } : {}),
    };
    const r = checkpointId
      ? await service.updateCheckpoint(adventureId, checkpointId, body)
      : await service.addCheckpoint(adventureId, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    if (checkpointId) {
      navigation.goBack();
    } else {
      navigation.replace('PhaseAdded', { adventureId, checkpointId: r.value.id });
    }
  };

  const remove = () =>
    Alert.alert('Remove this phase?', 'It will be taken out of the draft.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void service.removeCheckpoint(adventureId, checkpointId as string).then(r => {
            if (r.ok) {
              navigation.goBack();
            } else {
              setError(r.error.userMessage);
            }
          }),
      },
    ]);

  return (
    <Screen
      title={checkpointId ? `Edit ${label}` : type === 'checkpoint' ? 'Add Checkpoint' : label}
      onBack={() => navigation.goBack()}
    >
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <Text variant="label" muted>
            {type === 'checkpoint' ? 'Checkpoint Name *' : 'Phase Name *'}
          </Text>
          <Input
            testID="checkpoint-name"
            value={name}
            onChangeText={setName}
            maxLength={CHECKPOINT_NAME_MAX}
            placeholder={
              type === 'checkpoint'
                ? 'Summit Viewpoint'
                : type === 'collect'
                ? 'Collect a Wildflower'
                : type === 'photo'
                ? 'Lakeside Photo'
                : 'Name this task'
            }
            accessibilityLabel="Phase name"
          />
          <Text variant="label" muted>
            Description (optional)
          </Text>
          <Input
            testID="checkpoint-description"
            value={description}
            onChangeText={setDescription}
            maxLength={CHECKPOINT_DESC_MAX}
            multiline
            placeholder="What should people do here?"
            accessibilityLabel="Description"
          />

          {canHavePlace ? (
            <Pressable
              testID="select-location"
              accessibilityRole="button"
              accessibilityLabel={`Select location, ${pos ? formatCoord(pos) : 'not set'}`}
              onPress={chooseLocation}
              style={[styles.locationRow, { borderColor: c.border, backgroundColor: c.surface }]}
            >
              <Icon name="pin" size={22} color={c.primary} />
              <Text variant="cardTitle" style={{ flex: 1 }}>
                Select Location
              </Text>
              <Text variant="caption" color={pos ? c.textMuted : c.danger} testID="location-value">
                {pos ? formatCoord(pos) : needsPlace ? 'Not set' : 'Optional'}
              </Text>
              <Icon name="chevron" size={18} color={c.textMuted} />
            </Pressable>
          ) : null}

          {canHavePlace && pos ? (
            <View style={{ gap: space.xs }}>
              <View style={styles.sectionHead}>
                <Text variant="cardTitle">Completion Radius</Text>
                <Text variant="cardTitle" testID="radius-value">
                  {radiusM} m
                </Text>
              </View>
              <Text variant="caption" muted>
                Mark as complete when within this distance.
              </Text>
              <Slider
                testID="radius-slider"
                label="Completion radius"
                min={PHASE_RADIUS_MIN_M}
                max={PHASE_RADIUS_MAX_M}
                step={5}
                value={radiusM}
                onChange={setRadiusM}
              />
            </View>
          ) : null}

          <ToggleRow
            testID="require-photo"
            icon="camera"
            title="Require Photo"
            body={type === 'photo' ? 'A photo is the point of this phase.' : undefined}
            value={type === 'photo' ? true : requirePhoto}
            disabled={type === 'photo'}
            onChange={setRequirePhoto}
          />

          {canHavePlace && pos ? (
            <>
              <ToggleRow
                testID="include-region"
                icon="download"
                title="Include Map Region"
                body="Download offline for participants"
                value={includeRegion}
                onChange={v => {
                  setIncludeRegion(v);
                  if (!v) {
                    setRegion(null);
                  }
                }}
              />
              {includeRegion && region ? (
                <Text variant="caption" muted testID="region-size">
                  About {formatBytesShort(sizeBytes)} · ~{boxSideKm(region).widthKm} km ×{' '}
                  {boxSideKm(region).heightKm} km
                </Text>
              ) : null}
            </>
          ) : null}

          {error ? <Banner tone="error" title={error} /> : null}
        </ScrollView>
        <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>
          <Button
            testID="checkpoint-save"
            style={{ flex: 1 }}
            label={type === 'checkpoint' ? 'Save Checkpoint' : 'Save Phase'}
            onPress={() => void save()}
            loading={busy}
            disabled={!name.trim()}
          />
        </View>
        {checkpointId ? (
          <Button
            testID="phase-remove"
            variant="ghost"
            label="Remove phase"
            onPress={remove}
            style={{ marginBottom: space.md }}
          />
        ) : null}
      </View>
    </Screen>
  );
}

// ---- Phase added -----------------------------------------------------------------------------

export function PhaseAddedScreen({ navigation, route }: Nav<'PhaseAdded'>) {
  const { adventureId, checkpointId } = route.params;
  const { adventuresRepo } = useServices();
  const { c } = useTheme();
  const { units } = useNavPrefs();
  const [cp, setCp] = useState<Awaited<ReturnType<typeof adventuresRepo.checkpoint>>>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      void adventuresRepo.checkpoint(adventureId, checkpointId).then(setCp);
    }
  }, [adventuresRepo, adventureId, checkpointId]);

  const place = cp ? placeOf(cp) : null;
  return (
    <Screen
      title="Phase Added"
      onBack={() => navigation.navigate('AdventureDetails', { adventureId })}
    >
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.list, { alignItems: 'center' }]}>
          <View style={[styles.bigTick, { backgroundColor: c.primary }]}>
            <Icon name="check" size={44} color={c.onPrimary} />
          </View>
          <Text variant="title" style={{ textAlign: 'center' }} testID="added-name">
            {cp?.name ?? ''}
          </Text>
          <Text muted style={{ textAlign: 'center' }}>
            has been added!
          </Text>
          {cp ? (
            <Card style={{ alignSelf: 'stretch' }}>
              {place ? (
                <FactRow icon="pin" label="Location set" value={formatCoord(place)} />
              ) : (
                <FactRow icon="pin" label="Location" value="No place for this phase" />
              )}
              {place ? (
                <FactRow
                  testID="added-region"
                  icon="download"
                  label="Map region"
                  value={
                    cp.region
                      ? `About ${formatBytesShort(
                          estimateAreaBytes(
                            cp.region,
                            DEFAULT_AREA_MIN_ZOOM,
                            DEFAULT_AREA_MAX_ZOOM,
                          ),
                        )} (downloads with the activity)`
                      : 'Not included'
                  }
                />
              ) : null}
              <FactRow
                icon="camera"
                label="Photo required"
                value={cp.requirePhoto ? 'Yes' : 'No'}
              />
              {place ? (
                <FactRow
                  icon="time"
                  label="Completion radius"
                  value={formatDistanceIn(cp.radiusM ?? DEFAULT_RADIUS_M, units)}
                />
              ) : null}
            </Card>
          ) : null}
        </ScrollView>
        <View style={[styles.footerColumn, { backgroundColor: c.bg, borderTopColor: c.border }]}>
          <Button
            testID="add-another-phase"
            label="Add Another Phase"
            onPress={() => navigation.replace('AddPhase', { adventureId })}
          />
          <Button
            testID="phase-added-done"
            variant="secondary"
            label="Done"
            onPress={() => navigation.navigate('AdventureDetails', { adventureId })}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.gutter, paddingTop: space.sm, gap: space.lg, paddingBottom: space.xxl },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flatCard: { paddingVertical: space.xs },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerColumn: {
    gap: space.sm,
    padding: space.gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderWidth: 1.5,
    borderRadius: radius.card,
  },
  tick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  bigTick: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xl,
  },
});
