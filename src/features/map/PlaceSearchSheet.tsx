import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { PlaceResult } from '../../domain/maps/places';
import { useServices } from '../../runtime/services';
import { Button, IconTile, ListRow, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

/** Search the world by name (needs internet) and pick a place to download a map for. */
export function PlaceSearchSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (p: PlaceResult) => void;
}) {
  const { c } = useTheme();
  const { places } = useServices();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) {
      ctl.current?.abort();
    }
  }, [visible]);

  const run = async () => {
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setBusy(true);
    setError(null);
    const r = await places.search(query, mine.signal);
    if (mine.signal.aborted) {
      return;
    }
    setBusy(false);
    if (r.ok) {
      setResults(r.value);
    } else {
      setResults(null);
      setError(r.error.userMessage);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: c.bg }]}
        testID="place-search"
      >
        <View style={styles.bar}>
          <TextInput
            testID="place-query"
            autoFocus
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void run()}
            returnKeyType="search"
            placeholder="Search a place or region"
            placeholderTextColor={c.textMuted}
            accessibilityLabel="Search for a place"
            style={[
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surface },
            ]}
          />
          <Button small variant="ghost" label="Close" onPress={onClose} />
        </View>
        <Text variant="caption" muted style={styles.hint}>
          Searching needs an internet connection. The map you download works without one.
        </Text>
        {busy ? <ActivityIndicator color={c.primary} style={{ margin: space.lg }} /> : null}
        {error ? (
          <Text color={c.danger} style={styles.hint} testID="place-error">
            {error}
          </Text>
        ) : null}
        {results && results.length === 0 && !busy ? (
          <Text muted style={styles.hint} testID="place-empty">
            No places found. Try a different name.
          </Text>
        ) : null}
        <FlatList
          data={results ?? []}
          keyExtractor={p => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.gutter }}
          renderItem={({ item }) => (
            <ListRow
              testID="place-result"
              title={item.name}
              subtitle={item.detail}
              leading={<IconTile name="pin" />}
              chevron
              onPress={() => onPick(item)}
            />
          )}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 56 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.gutter,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 15,
  },
  hint: { paddingHorizontal: space.gutter, paddingVertical: space.sm },
});
