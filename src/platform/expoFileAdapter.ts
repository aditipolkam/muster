import { Directory as ExpoDirectory, File as ExpoFile, Paths } from 'expo-file-system';
import { FilePort, FileWriter } from './FilePort';

const withSlash = (u: string) => (u.endsWith('/') ? u : `${u}/`);

/** Android builds a java.net.URI from the path, which rejects raw spaces (e.g. "Noto Sans Regular"). Idempotent. */
const encodeUri = (u: string) => u.replace(/ /g, '%20');

class File extends ExpoFile {
  constructor(uri: string) {
    super(encodeUri(uri));
  }
}

class Directory extends ExpoDirectory {
  constructor(uri: string) {
    super(encodeUri(uri));
  }
}

function parentOf(uri: string): string {
  return uri.slice(0, uri.lastIndexOf('/'));
}

/** Expo FileSystem (SDK 54 object API) adapter. */
export function createExpoFilePort(): FilePort {
  const root = withSlash(Paths.document.uri);
  const mkdirp = async (uri: string) => {
    new Directory(uri).create({ idempotent: true, intermediates: true });
  };
  return {
    root,
    exists: async uri => new File(uri).exists,
    size: async uri => {
      const f = new File(uri);
      return f.exists ? f.size : 0;
    },
    mkdirp,
    remove: async uri => {
      const f = new File(uri);
      if (f.exists) {
        f.delete();
        return;
      }
      const d = new Directory(uri);
      if (d.exists) {
        d.delete();
      }
    },
    move: async (from, to) => {
      const dest = new File(to);
      if (dest.exists) {
        dest.delete();
      }
      await mkdirp(parentOf(to));
      new File(from).move(dest);
    },
    readRange: async (uri, offset, length) => {
      const h = new File(uri).open();
      try {
        h.offset = offset;
        return h.readBytes(length);
      } finally {
        h.close();
      }
    },
    readText: async uri => new File(uri).text(),
    writeBytes: async (uri, bytes) => {
      await mkdirp(parentOf(uri));
      const f = new File(uri);
      if (!f.exists) {
        f.create({ intermediates: true });
      }
      f.write(bytes);
    },
    openWriter: async (uri, mode): Promise<FileWriter> => {
      await mkdirp(parentOf(uri));
      const f = new File(uri);
      if (mode === 'truncate' && f.exists) {
        f.delete();
      }
      if (!f.exists) {
        f.create({ intermediates: true });
      }
      const h = f.open();
      h.offset = mode === 'append' ? h.size ?? 0 : 0;
      return {
        write: async bytes => {
          h.writeBytes(bytes);
        },
        close: async () => h.close(),
      };
    },
    freeBytes: async () => Paths.availableDiskSpace,
    dirSize: async dirUri => {
      const d = new Directory(dirUri);
      return d.exists ? d.size ?? 0 : 0;
    },
    list: async dirUri => {
      const d = new Directory(dirUri);
      return d.exists
        ? d.list().map(e => decodeURIComponent(e.uri.replace(/\/$/, '').split('/').pop() ?? ''))
        : [];
    },
  };
}
