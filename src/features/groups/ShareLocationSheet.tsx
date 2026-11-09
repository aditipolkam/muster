import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { formatCoord } from '../../domain/geo';
import { describeAccuracy, gpsStatus } from '../../domain/location/fix';
import { permissionAction } from '../../domain/location/permission';
import { POINT_NAME_MAX, POINT_NOTE_MAX } from '../../domain/groups/model';
import { useLocationStore } from '../../platform/locationStore';
import { useMarkers } from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { Banner, Button, Card, IconButton, IconTile, ListRow, Row, Text } from '../../ui/components';
import { useNow } from '../../ui/useNow';
import { radius, space, useTheme } from '../../ui/theme';

/** Where the place came from: it decides the name suggested for it. */
export type SharePlace = { lat: number; lon: number; name?: string };

/**
 * "Share location" on the group page, like attaching a location in a chat: send where you are,
 * choose a place on the map, or pick a saved place; then name it and share it with the group as a
 * meeting point. Opening it with `place` (back from the map) goes straight to naming.
 */
export function ShareLocationSheet({
  visible,
  groupId,
  groupName,
  place,
  onChooseOnMap,
  onClose,
}: {
  visible: boolean;
  groupId: string;
  groupName: string;
  place: SharePlace | null;
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

  // A fresh start each time it opens; a place from the map skips straight to naming it.
  useEffect(() => {
    if (!visible) {
      return;
    }
    setChosen(place);
    setName(place?.name ?? '');
    setNote('');
    setError(null);
    // Make sure a current fix is coming in (the Map may not have been opened yet).
    void location.start();
  }, [visible, place, location]);

  const gps = gpsStatus(now, fix, permission, watchingSince);
  const canSendHere = !!fix && (gps === 'ok' || gps === 'poor');
  const hereSubtitle =
    gps === 'unavailable'
      ? permissionAction(permission) === 'request'
        ? 'Allow location access to use it'
        : 'Location is off for TrailMesh. Turn it on in Settings.'
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

  const field = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }];
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
          <View style={styles.head}>
            {chosen && !place ? (
              <IconButton
                icon="back"
                label="Choose another place"
                onPress={() => setChosen(null)}
                testID="share-back"
              />
            ) : null}
            <Text variant="heading" style={{ flex: 1 }}>
              {chosen ? 'Name this meeting point' : 'Share location'}
            </Text>
            <IconButton icon="close" label="Close" onPress={onClose} testID="share-close" />
          </View>

          {chosen ? (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Card style={styles.placeCard}>
                <IconTile name="flag" color={c.mapMeeting} bg={c.mapMeeting + '22'} />
                <View style={{ flex: 1 }}>
                  <Text variant="caption" muted>
                    Everyone in "{groupName}" sees it on their map
                  </Text>
                  <Text variant="cardTitle" testID="share-coords">
                    {formatCoord(chosen)}
                  </Text>
                </View>
              </Card>
              <TextInput
                testID="share-name"
                style={field}
                value={name}
                onChangeText={setName}
                maxLength={POINT_NAME_MAX}
                placeholder="Name, e.g. Lake junction"
                accessibilityLabel="Meeting point name"
                autoFocus
              />
              <TextInput
                testID="share-note"
                style={[field, styles.note]}
                value={note}
                onChangeText={setNote}
                maxLength={POINT_NOTE_MAX}
                multiline
                placeholder="Note (optional), e.g. wait by the bridge"
                accessibilityLabel="Meeting point note"
              />
              {error ? <Banner tone="error" title={error} /> : null}
              <Button
                icon="send"
                label="Share with the group"
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
                  leading={<IconTile name="map" />}
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
              <Row>
                <Text variant="caption" muted style={{ flex: 1 }}>
                  Shared over Bluetooth with the people in range; others get it when they come
                  close. No internet needed.
                </Text>
              </Row>
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
    maxHeight: '85%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
  body: { padding: space.gutter, gap: space.md },
  placeCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
  },
  note: { height: 80, textAlignVertical: 'top' },
});
