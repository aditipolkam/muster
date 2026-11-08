import React from 'react';
import { StyleSheet, View } from 'react-native';
import { bearingDeg, distanceM, formatCoord } from '../../domain/geo';
import type { Group, MeetingPoint } from '../../domain/groups/model';
import { shortAddress } from '../../domain/groups/model';
import { Fix } from '../../domain/location/fix';
import { Units, formatDistanceIn } from '../../domain/geo/pace';
import { useGroupMembers } from '../../runtime/hooks';
import { Badge, Button, Row, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

type Props = {
  point: MeetingPoint;
  group: Group | null;
  me: string | null;
  fix: Fix | null;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
  onAcknowledge: () => void;
  onDetails: () => void;
  onNavigate: () => void;
  units?: Units;
  onClose: () => void;
};

/** Compact card for a shared meeting point; the full view is the Meeting Point screen. */
export function MeetingPointSheet(p: Props) {
  const { c } = useTheme();
  const members = useGroupMembers(p.point.groupId);
  const nameOf = (a: string) =>
    a === p.me ? 'you' : members.find(m => m.address === a)?.name ?? shortAddress(a);
  const organizer = p.group?.role === 'organizer';
  const acked = p.point.ackedRev >= p.point.rev;
  const dist = p.fix ? distanceM(p.fix, p.point) : null;
  const brg = p.fix ? bearingDeg(p.fix, p.point) : null;
  const edited = p.point.rev > 1 || p.point.updatedBy !== p.point.createdBy;

  return (
    <View
      style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
      testID="meeting-sheet"
    >
      <Row>
        <Text variant="heading" style={{ flex: 1 }} numberOfLines={1} testID="meeting-name">
          {p.point.name}
        </Text>
        <Button small variant="ghost" label="Close" onPress={p.onClose} />
      </Row>
      <Text variant="caption" muted>
        {p.group?.name ?? 'Group'} · shared by {nameOf(p.point.createdBy)}
        {edited ? ` · updated by ${nameOf(p.point.updatedBy)}` : ''}
      </Text>
      {p.point.note ? <Text numberOfLines={2}>{p.point.note}</Text> : null}
      <Text variant="mono" muted selectable>
        {formatCoord(p.point)}
      </Text>
      {dist !== null && brg !== null ? (
        <Text>{`${formatDistanceIn(dist, p.units ?? 'metric')} straight line · ${Math.round(
          brg,
        )}°`}</Text>
      ) : null}
      <Button
        label="Start navigation"
        icon="navigate"
        onPress={p.onNavigate}
        testID="meeting-navigate"
        style={{ marginTop: space.xs }}
      />
      <Row style={{ marginTop: space.xs }}>
        {organizer ? (
          <>
            <Button
              style={{ flex: 1 }}
              small
              variant="secondary"
              label="Edit"
              onPress={p.onEdit}
              testID="meeting-edit"
            />
            <Button
              style={{ flex: 1 }}
              small
              variant="secondary"
              label="Move"
              onPress={p.onMove}
              testID="meeting-move"
            />
            <Button
              style={{ flex: 1 }}
              small
              variant="danger"
              label="Remove"
              onPress={p.onRemove}
              testID="meeting-remove"
            />
          </>
        ) : acked ? (
          <Badge
            label={p.point.ackPublished ? 'Acknowledged' : 'Acknowledged, not delivered yet'}
            tone="good"
          />
        ) : (
          <Button
            style={{ flex: 1 }}
            small
            label="Acknowledge"
            onPress={p.onAcknowledge}
            testID="meeting-ack"
          />
        )}
        <Button
          small
          variant="ghost"
          label="Details"
          onPress={p.onDetails}
          testID="meeting-details"
        />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    padding: space.lg,
    gap: space.xs,
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
