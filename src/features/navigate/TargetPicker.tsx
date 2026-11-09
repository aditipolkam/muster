import React from 'react';
import { Modal, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { Button, Icon, IconTile, ListRow, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';
import { MY_PLACES, TargetOption, TargetSection } from './targets';

/** Bottom-sheet list of locations, grouped by the group they were shared in. */
export function TargetPicker({
  visible,
  sections,
  selectedKey,
  onPick,
  onClear,
  onClose,
}: {
  visible: boolean;
  sections: TargetSection[];
  selectedKey: string | null;
  onPick: (o: TargetOption) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.scrim, { backgroundColor: c.overlay }]}
        onPress={onClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <View
        style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
        testID="target-picker"
      >
        <View style={styles.head}>
          <Text variant="heading" style={{ flex: 1 }}>
            Point the compass at
          </Text>
          <Button small variant="ghost" label="Close" onPress={onClose} />
        </View>
        <View style={{ paddingHorizontal: space.gutter }}>
          <ListRow
            title="Compass only"
            subtitle="No location"
            leading={<IconTile name="compass" />}
            trailing={selectedKey === null ? <Icon name="check" color={c.primary} /> : null}
            onPress={onClear}
            testID="target-none"
          />
        </View>
        {sections.length === 0 ? (
          <Text muted style={styles.empty} testID="target-empty">
            Nothing to pick yet. Meeting points shared in your groups, and places you mark on the
            map, show up here.
          </Text>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={o => o.key}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text variant="label" muted style={styles.section}>
                {section.title === MY_PLACES ? 'MY PLACES' : section.title.toUpperCase()}
              </Text>
            )}
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={item.subtitle}
                leading={
                  <IconTile
                    name={item.ref.kind === 'meeting' ? 'flag' : 'pin'}
                    tone={item.ref.kind === 'meeting' ? 'meeting' : 'primary'}
                  />
                }
                trailing={item.key === selectedKey ? <Icon name="check" color={c.primary} /> : null}
                onPress={() => onPick(item)}
                testID={`target-${item.key}`}
              />
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    paddingBottom: space.xl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
  section: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.xs },
  empty: { padding: space.gutter },
});
