import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { proximity } from '../../domain/adventures/arrival';
import { canEditAdventure } from '../../domain/adventures/authorize';
import { isFinal } from '../../domain/adventures/lifecycle';
import {
  CHECKPOINT_DESC_MAX,
  CHECKPOINT_KINDS,
  CHECKPOINT_NAME_MAX,
  CheckpointKind,
  kindLabel,
} from '../../domain/adventures/model';
import { bearingDeg, distanceM, formatCoord } from '../../domain/geo';
import { cardinalOf, formatDistanceIn } from '../../domain/geo/pace';
import { useLocationStore } from '../../platform/locationStore';
import {
  useAdventureDetail,
  useAdventureRuntime,
  useCheckpointRadius,
  useGroups,
  useMesh,
  useNavPrefs,
} from '../../runtime/hooks';
import { ActivityStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  IconTile,
  Screen,
  Text,
} from '../../ui/components';
import { PulseRing } from '../../ui/motion';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow } from '../../ui/useNow';
import { KIND_ICON, SAFETY_NOTE, formatDate, formatTime } from './format';

type Nav<T extends keyof ActivityStackParamList> = NativeStackScreenProps<
  ActivityStackParamList,
  T
>;

export function CheckpointEditorScreen({ navigation, route }: Nav<'CheckpointEditor'>) {
  const { adventureId, checkpointId } = route.params;
  const { adventures: service, adventuresRepo } = useServices();
  const { c } = useTheme();
  const fix = useLocationStore(s => s.fix);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<CheckpointKind>('other');
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(
    route.params.lat !== undefined && route.params.lon !== undefined
      ? { lat: route.params.lat, lon: route.params.lon }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useMemo(
    () => [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }],
    [c],
  );

  useEffect(() => {
    if (!checkpointId) {
      return;
    }
    void adventuresRepo.checkpoint(adventureId, checkpointId).then(cp => {
      if (cp) {
        setName(cp.name);
        setDescription(cp.description ?? '');
        setKind(cp.kind);
        setPos({ lat: cp.lat, lon: cp.lon });
      }
    });
  }, [adventureId, checkpointId, adventuresRepo]);

  const save = async () => {
    if (!pos) {
      setError('Choose where it is: use your location, or long-press the map.');
      return;
    }
    setBusy(true);
    setError(null);
    const body = { name, description, kind, ...pos };
    const r = checkpointId
      ? await service.updateCheckpoint(adventureId, checkpointId, body)
      : await service.addCheckpoint(adventureId, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
      return;
    }
    navigation.goBack();
  };

  return (
    <Screen
      title={checkpointId ? 'Edit checkpoint' : 'New checkpoint'}
      onBack={() => navigation.goBack()}
    >
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text variant="label" muted>
          Name
        </Text>
        <TextInput
          testID="checkpoint-name"
          style={input}
          value={name}
          onChangeText={setName}
          maxLength={CHECKPOINT_NAME_MAX}
          placeholder="Upper falls"
          accessibilityLabel="Checkpoint name"
        />
        <Text variant="label" muted>
          What kind of place?
        </Text>
        <View style={styles.chips}>
          {CHECKPOINT_KINDS.map(k => {
            const on = k.kind === kind;
            return (
              <Pressable
                key={k.kind}
                testID={`kind-${k.kind}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setKind(k.kind)}
                style={[
                  styles.chip,
                  { backgroundColor: on ? c.primary : c.surfaceAlt, borderColor: c.border },
                ]}
              >
                <Text
                  variant="caption"
                  color={on ? c.onPrimary : c.text}
                  style={{ fontWeight: '600' }}
                >
                  {k.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="label" muted>
          Description (optional)
        </Text>
        <TextInput
          testID="checkpoint-description"
          style={[input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          maxLength={CHECKPOINT_DESC_MAX}
          multiline
          accessibilityLabel="Checkpoint description"
        />
        <Text variant="label" muted>
          Position
        </Text>
        <Card>
          <Text variant="cardTitle">{pos ? formatCoord(pos) : 'Not set yet'}</Text>
          <Text variant="caption" muted>
            Saved on this device. Group members get it only if this is a group adventure.
          </Text>
        </Card>
        <Button
          testID="checkpoint-use-location"
          variant="secondary"
          icon="locate"
          label="Use my location"
          disabled={!fix}
          onPress={() => fix && setPos({ lat: fix.lat, lon: fix.lon })}
        />
        <Text variant="caption" muted>
          {SAFETY_NOTE}
        </Text>
        {error ? <Banner tone="error" title={error} /> : null}
        <Button
          testID="checkpoint-save"
          label="Save checkpoint"
          onPress={() => void save()}
          loading={busy}
          disabled={!name.trim()}
        />
      </ScrollView>
    </Screen>
  );
}

export function CheckpointDetailsScreen({ navigation, route }: Nav<'CheckpointDetails'>) {
  const { adventureId, checkpointId } = route.params;
  const { c } = useTheme();
  const { adventures: service } = useServices();
  const detail = useAdventureDetail(adventureId);
  const groups = useGroups();
  const mesh = useMesh();
  const fix = useLocationStore(s => s.fix);
  const now = useNow();
  const { units } = useNavPrefs();
  const { radiusM } = useCheckpointRadius();
  const rt = useAdventureRuntime();
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  const cp = detail?.checkpoints.find(x => x.id === checkpointId) ?? null;
  if (!detail || !cp) {
    return (
      <Screen title="Checkpoint" onBack={() => navigation.goBack()}>
        <EmptyState
          title={removed ? 'Checkpoint removed' : 'Checkpoint not found'}
          body="It is no longer part of this adventure."
          actionLabel="Back"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }
  const { adventure: a, self, completions, participants } = detail;
  const group = groups.find(g => g.id === a.groupId) ?? null;
  const canEdit = canEditAdventure(a, group, mesh.localAddress) && !isFinal(a.status);
  const mine = completions.find(x => x.checkpointId === cp.id && x.address === self) ?? null;
  const others = completions.filter(x => x.checkpointId === cp.id && x.address !== self);
  const dist = fix ? distanceM(fix, cp) : null;
  const bearing = fix ? bearingDeg(fix, cp) : null;
  const prox = proximity({ fix, target: cp, radiusM, now });
  const nameOf = (addr: string) => participants.find(p => p.address === addr)?.name ?? 'Someone';
  const canMark = a.status === 'active' && detail.joined && !mine;

  const doConfirm = async () => {
    const r = await service.confirmArrival(a.id, cp.id, 'manual');
    setError(r.ok ? null : r.error.userMessage);
  };
  const markArrived = () => {
    // A confirmation from far away is allowed (GPS can fail) but should be a deliberate choice.
    if (dist !== null && prox.state === 'far' && dist > radiusM * 10) {
      Alert.alert(
        'You seem to be far from here',
        `Your GPS puts you about ${formatDistanceIn(dist, units)} away. Mark it as reached anyway?`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Mark as reached', onPress: () => void doConfirm() },
        ],
      );
      return;
    }
    void doConfirm();
  };

  return (
    <Screen title={cp.name} onBack={() => navigation.goBack()}>
      <ScrollView contentContainerStyle={styles.list}>
        <Card style={styles.row}>
          {mine ? (
            <PulseRing color={c.primary} size={52} testID="reached-pulse" />
          ) : (
            <IconTile name={KIND_ICON[cp.kind]} />
          )}
          <View style={{ flex: 1 }}>
            <Text variant="cardTitle">{kindLabel(cp.kind)}</Text>
            <Text variant="caption" muted>
              {mine
                ? `Reached ${formatDate(mine.at)} at ${formatTime(mine.at)}${
                    mine.method === 'manual' ? ' · confirmed by you' : ' · detected by GPS'
                  }`
                : a.status === 'active'
                ? 'Not reached yet'
                : 'Not reached'}
            </Text>
          </View>
        </Card>
        {cp.description ? <Text>{cp.description}</Text> : null}
        <Card>
          <Text variant="label" muted>
            Straight line from you
          </Text>
          <Text variant="heading">
            {dist === null || bearing === null
              ? 'Waiting for GPS'
              : `${formatDistanceIn(dist, units)} · ${cardinalOf(bearing)}`}
          </Text>
          <Text variant="caption" muted>
            {formatCoord(cp)} · terrain not considered
          </Text>
        </Card>
        {rt.hint?.checkpointId === cp.id && !mine ? (
          <Banner
            tone="info"
            title={
              rt.hint.state === 'uncertain'
                ? 'Close, but GPS is not precise enough'
                : 'Almost there'
            }
            body={
              rt.hint.state === 'uncertain'
                ? 'Mark it yourself when you are there.'
                : 'You will be marked as arrived when you are within range.'
            }
          />
        ) : null}
        {a.groupId && others.length > 0 ? (
          <Card>
            <Text variant="label" muted>
              Reached by
            </Text>
            {others.map(o => (
              <Text key={o.address}>
                {nameOf(o.address)} · {formatTime(o.at)}
              </Text>
            ))}
          </Card>
        ) : null}
        {a.groupId && mine ? (
          <Badge
            label={mine.published ? 'The organizer has it' : 'Waiting to reach the organizer'}
            tone={mine.published ? 'good' : 'warn'}
          />
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}
        <Button
          testID="navigate-checkpoint"
          icon="navigate"
          label="Navigate here"
          onPress={() =>
            (
              navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined
            )?.navigate('Navigate', {
              adventureId: a.id,
              checkpointId: cp.id,
            })
          }
        />
        {canMark ? (
          <Button
            testID="confirm-arrival"
            variant="secondary"
            icon="check"
            label="I have arrived"
            onPress={markArrived}
          />
        ) : !mine && a.status === 'paused' ? (
          <Text variant="caption" muted>
            Resume the adventure to mark checkpoints.
          </Text>
        ) : null}
        {canEdit ? (
          <View style={styles.rowGap}>
            <Button
              variant="ghost"
              label="Edit"
              onPress={() =>
                navigation.navigate('CheckpointEditor', { adventureId: a.id, checkpointId: cp.id })
              }
            />
            <Button
              variant="ghost"
              label="Remove"
              onPress={() =>
                Alert.alert(
                  'Remove checkpoint?',
                  'It disappears from this adventure for everyone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => {
                        setRemoved(true);
                        void service.removeCheckpoint(a.id, cp.id);
                      },
                    },
                  ],
                )
              }
            />
          </View>
        ) : null}
        <Text variant="caption" muted>
          {SAFETY_NOTE}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.gutter, paddingTop: 0, gap: space.md, paddingBottom: space.xxl },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 15,
  },
  multiline: { minHeight: 80, paddingTop: space.md, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowGap: { flexDirection: 'row', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
