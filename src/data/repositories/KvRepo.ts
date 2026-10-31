import { DbPort } from '../DbPort';
import { Emitter } from '../events';

export class KvRepo {
  readonly changes = new Emitter<string>();

  constructor(private readonly db: DbPort) {}

  async get(key: string): Promise<string | null> {
    return (
      (await this.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]))?.value ??
      null
    );
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      'INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
    this.changes.emit(key);
  }

  async delete(key: string): Promise<void> {
    await this.db.run('DELETE FROM kv WHERE key = ?', [key]);
    this.changes.emit(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  setJson(key: string, value: unknown): Promise<void> {
    return this.set(key, JSON.stringify(value));
  }
}
