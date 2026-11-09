/** The app was called TrailMesh; its database file was `trailmesh.db`. */
export const LEGACY_DB_NAME = 'trailmesh.db';

type Files = {
  exists(uri: string): Promise<boolean>;
  move(from: string, to: string): Promise<void>;
};

/**
 * One-time move of the database from its pre-rename name, with its WAL and shared-memory files,
 * so an existing install keeps its groups, maps and points. Does nothing when the new database
 * already exists or there is no old one. Returns whether it moved anything.
 */
export async function moveLegacyDb(
  fs: Files,
  dirUri: string,
  name: string,
  legacy: string = LEGACY_DB_NAME,
): Promise<boolean> {
  const dir = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
  if ((await fs.exists(dir + name)) || !(await fs.exists(dir + legacy))) {
    return false;
  }
  // Side files first: the main file appearing under the new name is what marks the move done.
  for (const suffix of ['-wal', '-shm']) {
    if (await fs.exists(dir + legacy + suffix)) {
      await fs.move(dir + legacy + suffix, dir + name + suffix);
    }
  }
  await fs.move(dir + legacy, dir + name);
  return true;
}
