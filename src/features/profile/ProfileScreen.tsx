import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { MEMBER_NAME_MAX } from '../../domain/groups/model';
import { useMarkers, useMesh, useRegions } from '../../runtime/hooks';
import { ProfileStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import { Button, Card, Icon, IconName, IconTile, ListRow, Screen, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileHome'>;

const NAME_KEY = 'profile.name';
const PHOTO_KEY = 'profile.photo';

/**
 * Your identity on this device. The name is what group members see; the photo stays on this
 * device (it is never sent over the mesh).
 */
export function ProfileScreen({ navigation }: Props) {
  const { kv, fs } = useServices();
  const { c } = useTheme();
  const regions = useRegions();
  const markers = useMarkers();
  const mesh = useMesh();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void kv.get(NAME_KEY).then(v => {
      setName(v ?? '');
      setSaved(v ?? '');
    });
    void kv.get(PHOTO_KEY).then(setPhoto);
  }, [kv]);

  const saveName = useCallback(async () => {
    const next = name.trim();
    if (!next || next === saved) {
      setName(saved);
      return;
    }
    await kv.set(NAME_KEY, next);
    setSaved(next);
    setName(next);
  }, [kv, name, saved]);

  const pickPhoto = async () => {
    setError(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      const asset = r.canceled ? null : r.assets?.[0];
      if (!asset) {
        return;
      }
      const ext = /\.(png|jpe?g|webp|heic)$/i.exec(asset.name ?? '')?.[0] ?? '.jpg';
      const dest = `${fs.root}profile/photo-${Date.now()}${ext}`;
      await fs.mkdirp(`${fs.root}profile/`);
      await fs.move(asset.uri, dest);
      if (photo) {
        await fs.remove(photo);
      }
      await kv.set(PHOTO_KEY, dest);
      setPhoto(dest);
    } catch {
      setError('Could not set the photo. Try another image.');
    }
  };

  const removePhoto = async () => {
    if (photo) {
      await fs.remove(photo);
    }
    await kv.set(PHOTO_KEY, '');
    setPhoto(null);
  };

  const installed = regions.filter(r => r.state === 'installed').length;
  const peers = mesh.blePeerCount ?? mesh.peers.length;
  const row = (
    icon: IconName,
    title: string,
    meta: string,
    to: keyof ProfileStackParamList,
    divider = true,
  ) => (
    <ListRow
      key={to}
      title={title}
      divider={divider}
      leading={<IconTile name={icon} />}
      trailing={
        <Text variant="caption" muted>
          {meta}
        </Text>
      }
      chevron
      onPress={() => navigation.navigate(to as never)}
      testID={`profile-${to}`}
    />
  );

  return (
    <Screen
      title="Profile"
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          testID="profile-settings"
          hitSlop={8}
          onPress={() => navigation.navigate('Settings')}
        >
          <Icon name="settings" size={26} />
        </Pressable>
      }
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.identity}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            testID="profile-photo"
            onPress={() => void pickPhoto()}
            style={[styles.photo, { backgroundColor: c.primarySoft }]}
          >
            {photo ? (
              <Image source={{ uri: photo }} style={styles.photoImage} />
            ) : (
              <Text variant="hero" color={c.primary}>
                {(saved.trim()[0] ?? '?').toUpperCase()}
              </Text>
            )}
          </Pressable>
          {photo ? (
            <Button small variant="ghost" label="Remove photo" onPress={() => void removePhoto()} />
          ) : (
            <Text variant="caption" muted>
              Tap to add a photo. It stays on this device.
            </Text>
          )}
        </View>
        {error ? <Text color={c.danger}>{error}</Text> : null}

        <Text variant="label" muted>
          Your name
        </Text>
        <TextInput
          testID="profile-name"
          style={[
            styles.input,
            { color: c.text, borderColor: c.border, backgroundColor: c.surface },
          ]}
          value={name}
          onChangeText={setName}
          onBlur={() => void saveName()}
          onSubmitEditing={() => void saveName()}
          maxLength={MEMBER_NAME_MAX}
          placeholder="Alex"
          returnKeyType="done"
          accessibilityLabel="Your name"
        />
        <Text variant="caption" muted>
          Group members see this name. Changes apply to groups you create or join next.
        </Text>

        <Card style={styles.group}>
          {row(
            'map',
            'Downloaded maps',
            `${installed} ${installed === 1 ? 'region' : 'regions'}`,
            'Downloaded',
          )}
          {row(
            'pin',
            'Saved locations',
            `${markers.length} ${markers.length === 1 ? 'place' : 'places'}`,
            'Saved',
          )}
          {row('mesh', 'Mesh diagnostics', `${peers} nearby`, 'Mesh', false)}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, paddingTop: space.sm, gap: space.sm },
  identity: { alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  photo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: { width: 96, height: 96 },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 15,
  },
  group: { paddingVertical: space.xs, marginTop: space.md },
});
