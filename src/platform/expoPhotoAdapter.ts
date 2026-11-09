import { launchImageLibraryAsync } from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { appError, err, ok } from '../shared/result';
import { PhotoPort } from './PhotoPort';

const DIR = 'phase-photos';

/**
 * expo-image-picker (the system photo picker: on iOS 14+ and Android 13+ it needs no library
 * permission) plus a copy into the app's documents folder.
 * [ASSUMPTION A-31: works without a permission prompt on both OSes; not run on a device.]
 */
export function createExpoPhotoPort(): PhotoPort {
  return {
    pick: async () => {
      try {
        const r = await launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.7,
          exif: false,
        });
        const asset = r.canceled ? null : r.assets[0];
        if (!asset) {
          return ok(null);
        }
        const dir = new Directory(Paths.document, DIR);
        dir.create({ idempotent: true, intermediates: true });
        const ext = /\.(png|jpe?g|heic|webp)$/i.exec(asset.uri)?.[0] ?? '.jpg';
        const dest = new File(
          dir,
          `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${ext}`,
        );
        new File(asset.uri).copy(dest);
        return ok(dest.uri);
      } catch (e) {
        return err(
          appError('photo_failed', `Could not attach that photo (${String(e).slice(0, 80)}).`),
        );
      }
    },
    discard: async uri => {
      try {
        const f = new File(uri);
        if (f.exists) {
          f.delete();
        }
      } catch {
        // Already gone.
      }
    },
  };
}
