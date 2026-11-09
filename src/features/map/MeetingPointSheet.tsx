import React from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { bearingDeg, distanceM } from '../../domain/geo';
import type { Group, MeetingPoint } from '../../domain/groups/model';
import { shortAddress } from '../../domain/groups/model';
import { Fix } from '../../domain/location/fix';
import {
  cardinal16Of,
  etaMinutes,
  formatDistanceIn,
  formatEta,
  Units,
} from '../../domain/geo/pace';
import { useGroupMembers } from '../../runtime/hooks';
import { Button, Icon, IconTile, Row, Text } from '../../ui/components';
import { floating, radius, space, useTheme } from '../../ui/theme';
import { MetricStrip } from '../../ui/trail';

type Props = {
  point: MeetingPoint;
  group: Group | null;
  me: string | null;
  fix: Fix | null;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
  onDetails: () => void;
  onNavigate: () => void;
  onCompass: () => void;
  units?: Units;
  paceKmh?: number;
  onClose: () => void;
};

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Bottom sheet for a meeting point on the map: who shared it, how far and which way, then
 * Navigate. Only the organizer can edit, move or remove it (Move and Remove sit under More).
 */
export function MeetingPointSheet(p: Props) {
  const { c } = useTheme();
  const members = useGroupMembers(p.point.groupId);
  const nameOf = (a: string) =>
    a === p.me ? 'you' : members.find(m => m.address === a)?.name ?? shortAddress(a);
  const organizer = p.group?.role === 'organizer';
  const dist = p.fix ? distanceM(p.fix, p.point) : null;
  const brg = p.fix ? bearingDeg(p.fix, p.point) : null;
  const minutes = etaMinutes(dist, p.paceKmh ?? 4);
  const edited = p.point.rev > 1 || p.point.updatedBy !== p.point.createdBy;

  const more = () =>
    Alert.alert(
      p.point.name,
      undefined,
      organizer
        ? [
            { text: 'Move on the map', onPress: p.onMove },
            { text: 'Details', onPress: p.onDetails },
            { text: 'Remove for everyone', style: 'destructive', onPress: p.onRemove },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Details', onPress: p.onDetails },
            { text: 'Cancel', style: 'cancel' },
          ],
    );

  return (
    <View
      style={[styles.sheet, floating(c), { backgroundColor: c.surface, borderColor: c.border }]}
      testID="meeting-sheet"
    >
      <View style={[styles.grabber, { backgroundColor: c.border }]} />
      <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
        <IconTile name="flag" tone="meeting" size={44} />
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1} testID="meeting-name">
            {p.point.name}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {`Shared by ${nameOf(p.point.createdBy)} · ${clock(p.point.updatedAt)} · ${
              p.group?.name ?? 'Group'
            }${edited ? ` · edited by ${nameOf(p.point.updatedBy)}` : ''}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={p.onClose}
          hitSlop={8}
          style={[styles.close, { backgroundColor: c.surfaceAlt }]}
          testID="meeting-close"
        >
          <Icon name="close" size={20} color={c.textMuted} />
        </Pressable>
      </Row>
      {p.point.note ? (
        <Text numberOfLines={2} muted>
          {p.point.note}
        </Text>
      ) : null}
      <MetricStrip
        testID="meeting-metrics"
        items={[
          {
            label: 'Distance',
            value: dist === null ? '–' : formatDistanceIn(dist, p.units ?? 'metric'),
          },
          {
            label: 'Direction',
            value: brg === null ? '–' : `${cardinal16Of(brg)} ${Math.round(brg)}°`,
          },
          { label: 'On foot', value: minutes === null ? '–' : `~${formatEta(minutes)}` },
        ]}
      />
      <Text variant="caption" muted>
        Straight-line estimate. Trails and climbs not included.
      </Text>
      <Button label="Navigate" icon="navigate" onPress={p.onNavigate} testID="meeting-navigate" />
      <Row style={{ gap: space.sm }}>
        <Button
          style={styles.third}
          small
          variant="secondary"
          icon="compass"
          label="Compass"
          onPress={p.onCompass}
          testID="meeting-compass"
        />
        {organizer ? (
          <Button
            style={styles.third}
            small
            variant="secondary"
            icon="edit"
            label="Edit"
            onPress={p.onEdit}
            testID="meeting-edit"
          />
        ) : null}
        <Button
          style={styles.third}
          small
          variant="secondary"
          icon="more"
          label="More"
          onPress={more}
          testID="meeting-more"
        />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.gutter,
    paddingTop: space.sm,
    gap: space.md,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.xs },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  third: { flex: 1, paddingHorizontal: space.sm },
});
