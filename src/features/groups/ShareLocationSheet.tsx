import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { formatCoord } from '../../domain/geo';
import { describeAccuracy, gpsStatus } from '../../domain/location/fix';
import { permissionAction } from '../../domain/location/permission';
import { POINT_NAME_MAX, POINT_NOTE_MAX } from '../../domain/groups/model';
import { useLocationStore } from '../../platform/locationStore';
import { useMarkers } from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import {
  Banner,
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  IconTile,
  Input,
  ListRow,
  Row,
  Text,
} from '../../ui/components';
import { useNow } from '../../ui/useNow';
import { radius, size, space, useTheme } from '../../ui/theme';

/** One tap names the point; the leader can still edit it. */
const QUICK_NAMES = ['Lunch stop', 'Campsite', 'Summit', 'Regroup here'];

/** Where the place came from: it decides the name suggested for it. */
export type SharePlace = { lat: number; lon: number; name?: string };

/**
 * Step 2 of setting a meeting point, "Name and share" (leader only). Opening it with `place`
 * (back from the map) or `startHere` (Share my location, with a GPS fix) goes straight to naming;
 * otherwise it first offers where you are, the map, or a saved place.
 */
export function ShareLocationSheet({
  visible,
  groupId,
  groupName,
  place,
  startHere,
  inRange = 0,
  onChooseOnMap,
  onClose,
}: {
  visible: boolean;
  groupId: string;
  groupName: string;
  place: SharePlace | null;
  /** Start on the current location when there is a usable fix. */
  startHere?: boolean;
  /** Followers in range right now: they receive it straight away. */
  inRange?: number;
  onChooseOnMap: () => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { groups: service, location } = useServices();
  const fix = useLocationStore(s => s.fix);
  const permission = useLocationStore(s => s.permission);
  const watchingSince = useLocationStore(s => s.watchingSince);
  const saved = useMarkers().slice(0, 5);
  const now = useNow();
  const [chosen, setChosen] = useState<SharePlace | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gps = gpsStatus(now, fix, permission, watchingSince);
  const canSendHere = !!fix && (gps === 'ok' || gps === 'poor');

  // A fresh start each time it opens; a place from the map (or where you stand) skips straight
  // to naming it.
  useEffect(() => {
    if (!visible) {
      return;
    }
    setChosen(place ?? (startHere && canSendHere && fix ? { lat: fix.lat, lon: fix.lon } : null));
    setName(place?.name ?? '');
    setNote('');
    setError(null);
    // Make sure a current fix is coming in (the Map may not have been opened yet).
    void location.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, place, startHere, location]);
  const hereSubtitle =
    gps === 'unavailable'
      ? permissionAction(permission) === 'request'
        ? 'Allow location access to use it'
        : 'Location is off for Muster. Turn it on in Settings.'
      : gps === 'acquiring'
      ? 'Finding your location…'
      : gps === 'lost'
      ? 'No recent GPS fix. Move into the open and wait a moment.'
      : `Accurate to ${describeAccuracy(fix?.accM ?? NaN)}${
          gps === 'poor' ? ' · rough, check it on the map' : ''
        }`;

  const pick = (p: SharePlace) => {
    setChosen(p);
    setName(p.name ?? '');
    setError(null);
  };

  const share = async () => {
    if (!chosen) {
      return;
    }
    setBusy(true);
    setError(null);
    const r = await service.publishPoint(groupId, {
      name: name.trim(),
      note: note.trim() || null,
      lat: chosen.lat,
      lon: chosen.lon,
    });
    setBusy(false);
    if (r.ok) {
      onClose();
    } else {
      setError(r.error.userMessage);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.backdrop, { backgroundColor: c.overlay }]}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
          testID="share-location-sheet"
        >
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{chosen ? 'Name and share' : 'Share location'}</Text>
            </View>
            <IconButton icon="close" label="Close" onPress={onClose} testID="share-close" />
          </View>

          {chosen ? (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Card style={styles.placeCard}>
                <IconTile name="flag" tone="meeting" />
                <View style={{ flex: 1 }}>
                  <Text variant="cardTitle" testID="share-coords">
                    {formatCoord(chosen)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change the place"
                  onPress={place ? onChooseOnMap : () => setChosen(null)}
                  hitSlop={10}
                  style={styles.link}
                  testID="share-back"
                >
                  <Text variant="caption" color={c.primary} style={{ fontWeight: '800' }}>
                    Change
                  </Text>
                </Pressable>
              </Card>
              <View style={{ gap: space.sm }}>
                <Input
                  testID="share-name"
                  value={name}
                  onChangeText={setName}
                  maxLength={POINT_NAME_MAX}
                  placeholder="Name"
                  accessibilityLabel="Meeting point name"
                  autoFocus
                />
                <View style={styles.chips}>
                  {QUICK_NAMES.map(q => (
                    <Chip
                      key={q}
                      label={q}
                      selected={name.trim() === q}
                      onPress={() => setName(q)}
                      testID={`share-chip-${q}`}
                    />
                  ))}
                </View>
              </View>
              <View style={{ gap: space.sm }}>
                <Input
                  testID="share-note"
                  value={note}
                  onChangeText={setNote}
                  maxLength={POINT_NOTE_MAX}
                  multiline
                  placeholder="Note (optional)"
                  accessibilityLabel="Meeting point note"
                />
              </View>
              <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
                <Icon name="radio" size={18} color={inRange > 0 ? c.primary : c.textMuted} />
                <Text variant="caption" muted style={{ flex: 1 }} testID="share-in-range">
                  {inRange > 0
                    ? `${inRange} in range now. Others get it when they come close.`
                    : 'Nobody in range yet. Followers get it when they come close.'}
                </Text>
              </Row>
              {error ? <Banner tone="error" title={error} /> : null}
              <Button
                icon="send"
                label={`Share with ${groupName}`}
                onPress={() => void share()}
                loading={busy}
                disabled={!name.trim()}
                testID="share-submit"
              />
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              <Card style={{ paddingVertical: space.xs }}>
                <ListRow
                  testID="share-here"
                  title="Send your current location"
                  subtitle={hereSubtitle}
                  leading={<IconTile name="locate" />}
                  onPress={
                    canSendHere && fix
                      ? () => pick({ lat: fix.lat, lon: fix.lon })
                      : gps === 'unavailable' && permissionAction(permission) === 'request'
                      ? () => void location.requestPermission()
                      : undefined
                  }
                  chevron={canSendHere}
                />
                <ListRow
                  testID="share-on-map"
                  title="Choose on the map"
                  subtitle="Search for a place or move the map under a pin"
                  leading={<IconTile name="flag" tone="meeting" />}
                  onPress={onChooseOnMap}
                  chevron
                  divider={false}
                />
              </Card>
              {saved.length > 0 ? (
                <>
                  <Text variant="label" muted>
                    Your saved places
                  </Text>
                  <Card style={{ paddingVertical: space.xs }}>
                    {saved.map((m, i) => (
                      <ListRow
                        key={m.id}
                        testID={`share-saved-${m.id}`}
                        title={m.name}
                        subtitle={formatCoord(m)}
                        leading={<IconTile name="pin" />}
                        onPress={() => pick({ lat: m.lat, lon: m.lon, name: m.name })}
                        chevron
                        divider={i < saved.length - 1}
                      />
                    ))}
                  </Card>
                </>
              ) : null}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    paddingBottom: space.lg,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: space.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingTop: space.sm,
  },
  body: { padding: space.gutter, gap: space.lg },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  link: { minHeight: size.touch, justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
