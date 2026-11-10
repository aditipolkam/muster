import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { formatCoord } from '../../domain/geo';
import { POINT_NAME_MAX, POINT_NOTE_MAX } from '../../domain/groups/model';
import { Button, Input, Row, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

export type MeetingDraft = {
  groupId: string;
  groupName: string;
  /** Set when editing an existing point. */
  pointId?: string;
  name: string;
  note: string;
  lat: number;
  lon: number;
};

/** Name and optional description for a meeting point, then publish. */
export function MeetingPointEditor({
  draft,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  draft: MeetingDraft | null;
  busy: boolean;
  error: string | null;
  onSubmit: (d: MeetingDraft) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    setName(draft?.name ?? '');
    setNote(draft?.note ?? '');
  }, [draft]);

  return (
    <Modal visible={!!draft} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.backdrop, { backgroundColor: c.overlay }]}
      >
        {draft ? (
          <View
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
            testID="meeting-editor"
          >
            <Text variant="heading">
              {draft.pointId ? 'Update meeting point' : 'New meeting point'}
            </Text>
            <Text variant="caption" muted>
              Shared with everyone in "{draft.groupName}" · {formatCoord(draft)}
            </Text>
            <Input
              testID="meeting-name-input"
              value={name}
              onChangeText={setName}
              maxLength={POINT_NAME_MAX}
              placeholder="Name, e.g. Lake junction"
              accessibilityLabel="Meeting point name"
              autoFocus
            />
            <Input
              testID="meeting-note-input"
              value={note}
              onChangeText={setNote}
              maxLength={POINT_NOTE_MAX}
              multiline
              placeholder="Description (optional)"
              accessibilityLabel="Meeting point description"
            />
            {error ? <Text color={c.danger}>{error}</Text> : null}
            <Row>
              <Button style={{ flex: 1 }} variant="secondary" label="Cancel" onPress={onCancel} />
              <Button
                style={{ flex: 1 }}
                label={draft.pointId ? 'Update' : 'Share'}
                loading={busy}
                disabled={!name.trim()}
                testID="meeting-submit"
                onPress={() => onSubmit({ ...draft, name: name.trim(), note: note.trim() })}
              />
            </Row>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  card: {
    padding: space.lg,
    gap: space.sm,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
  },
});
