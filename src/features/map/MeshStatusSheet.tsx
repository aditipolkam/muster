import React from 'react';
import { StyleSheet, View } from 'react-native';
import { presenceText } from '../../domain/groups/presence';
import type { MeshStatus } from '../../domain/groups/presence';
import type { MemberPresence } from '../../runtime/hooks';
import { Button, Row, StatusPill, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

type Props = {
  status: MeshStatus;
  groupName: string | null;
  members: MemberPresence[];
  onDiagnostics: () => void;
  onClose: () => void;
};

/** Plain-language explanation of the mesh pill: who is reachable and when others were last heard. */
export function MeshStatusSheet({ status, groupName, members, onDiagnostics, onClose }: Props) {
  const { c } = useTheme();
  return (
    <View
      style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
      testID="mesh-status-sheet"
    >
      <Row>
        <Text variant="heading" style={{ flex: 1 }}>
          {groupName ?? 'Mesh'}
        </Text>
        <Button small variant="ghost" label="Close" onPress={onClose} />
      </Row>
      <StatusPill tone={status.tone} label={status.label} />
      <Text>{status.detail}</Text>
      <Text variant="caption" muted>
        Group updates travel by Bluetooth between phones. This works with no internet.
      </Text>
      {members.map(({ member, presence }) => (
        <Row key={member.address}>
          <Text style={{ flex: 1 }}>{member.name}</Text>
          <Text muted>{presenceText(presence)}</Text>
        </Row>
      ))}
      <Button
        small
        variant="secondary"
        label="Mesh diagnostics"
        onPress={onDiagnostics}
        testID="mesh-status-diagnostics"
      />
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
    gap: space.sm,
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
  },
});
