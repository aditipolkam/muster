import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { BBox, bboxAreaKm2, formatBytes } from '../../domain/geo';
import { useServices } from '../../runtime/services';
import { Banner, Button, Row, SegmentedTabs, Text } from '../../ui/components';
import { AreaPlan } from '../../domain/maps/area';
import { radius, space, useTheme } from '../../ui/theme';

const LEVELS = [
  { value: '12', label: 'Overview', zoom: 12 },
  { value: '14', label: 'Standard', zoom: 14 },
  { value: '15', label: 'Detailed', zoom: 15 },
] as const;

type PlanState =
  | { status: 'loading' }
  | { status: 'ready'; plan: AreaPlan }
  | { status: 'error'; message: string };

/** Download whatever the map is showing, at a chosen level of detail, for offline use. */
export function AreaDownloadSheet({
  bbox,
  visible,
  onClose,
  onStarted,
  onBrowse,
}: {
  bbox: BBox | null;
  visible: boolean;
  onClose: () => void;
  onStarted: (name: string) => void;
  onBrowse: () => void;
}) {
  const { c } = useTheme();
  const { packs } = useServices();
  const [level, setLevel] = useState<'12' | '14' | '15'>('14');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<PlanState>({ status: 'loading' });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  // Depend on the values, not the array identity, so equal bounds never restart the size check.
  const bboxKey = bbox ? bbox.join(',') : '';

  useEffect(() => {
    ctl.current?.abort();
    if (!visible || !bbox) {
      return;
    }
    const mine = new AbortController();
    ctl.current = mine;
    setPlan({ status: 'loading' });
    setStartError(null);
    const zoom = LEVELS.find(l => l.value === level)!.zoom;
    void packs.planArea(bbox, zoom, mine.signal).then(r => {
      if (mine.signal.aborted) {
        return;
      }
      setPlan(
        r.ok
          ? { status: 'ready', plan: r.value }
          : { status: 'error', message: r.error.userMessage },
      );
    });
    return () => mine.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, level, packs, visible]);

  const start = async () => {
    if (plan.status !== 'ready') {
      return;
    }
    setStarting(true);
    setStartError(null);
    const r = await packs.startArea(plan.plan, name).finally(() => setStarting(false));
    if (!r.ok) {
      setStartError(r.error.userMessage);
      return;
    }
    onStarted(r.value.name);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.backdrop, { backgroundColor: c.overlay }]}
      >
        <View
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          testID="area-sheet"
        >
          <Text variant="heading">Download this area</Text>
          <Text variant="caption" muted>
            {bbox
              ? `About ${Math.round(bboxAreaKm2(bbox)).toLocaleString()} km² as shown on the map.`
              : 'Move the map to the place you want first.'}
          </Text>
          <Text variant="label" muted>
            Name
          </Text>
          <TextInput
            testID="area-name"
            value={name}
            onChangeText={setName}
            maxLength={80}
            placeholder="e.g. Weekend hike"
            placeholderTextColor={c.textMuted}
            accessibilityLabel="Area name"
            style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
          />
          <Text variant="label" muted>
            Detail
          </Text>
          <SegmentedTabs
            value={level}
            onChange={setLevel}
            options={LEVELS.map(l => ({ value: l.value, label: l.label }))}
          />
          <Text variant="caption" muted>
            More detail shows smaller trails and places but takes more space.
          </Text>
          <View
            style={[styles.estimate, { backgroundColor: c.primarySoft }]}
            testID="area-estimate"
          >
            {plan.status === 'loading' ? (
              <Text muted>Checking the size…</Text>
            ) : plan.status === 'ready' ? (
              <>
                <Text variant="cardTitle">{formatBytes(plan.plan.fileBytes)}</Text>
                <Text variant="caption" muted>
                  {`${plan.plan.tileCount.toLocaleString()} map tiles · zoom ${plan.plan.minZoom}-${
                    plan.plan.maxZoom
                  } · OSM data ${plan.plan.osmDataDate}`}
                </Text>
              </>
            ) : (
              <Text color={c.danger} testID="area-error">
                {plan.message}
              </Text>
            )}
          </View>
          {startError ? <Banner tone="error" title={startError} /> : null}
          <Row>
            <Button style={{ flex: 1 }} variant="secondary" label="Cancel" onPress={onClose} />
            <Button
              style={{ flex: 1 }}
              icon="download"
              label="Download"
              loading={starting}
              disabled={plan.status !== 'ready'}
              testID="area-start"
              onPress={() => void start()}
            />
          </Row>
          <Button small variant="ghost" label="Browse listed regions" onPress={onBrowse} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  card: {
    padding: space.gutter,
    gap: space.sm,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 15,
  },
  estimate: { borderRadius: radius.card, padding: space.lg, gap: space.xs, minHeight: 64 },
});
