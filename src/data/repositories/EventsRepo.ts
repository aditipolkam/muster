import { DbPort } from '../DbPort';
import { Emitter } from '../events';

export type InboxEntry = {
  id: string;
  scope: string;
  type: string;
  author: string;
  sentTs: number;
  receivedAt: number;
  body: string;
};

/** Inbound event inbox (DATA_MODELS.md `events`). Written in the SDK handler, before anything else. */
export class EventsRepo {
  readonly changes = new Emitter<void>();

  constructor(private readonly db: DbPort) {}

  /** Resolves true when the row was inserted, false when the id already existed. */
  async record(e: InboxEntry): Promise<boolean> {
    const before = await this.count();
    await this.db.run(
      `INSERT OR IGNORE INTO events(id, group_id, type, author, sent_ts, received_at, body)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.scope, e.type, e.author, e.sentTs, e.receivedAt, e.body],
    );
    const inserted = (await this.count()) > before;
    if (inserted) {
      this.changes.emit();
    }
    return inserted;
  }

  async count(): Promise<number> {
    return Number((await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events'))?.n ?? 0);
  }

  async has(id: string): Promise<boolean> {
    return (await this.db.get('SELECT 1 AS x FROM events WHERE id = ?', [id])) !== null;
  }

  /** DATA_MODELS.md retention: events are kept 30 days. */
  async prune(olderThanMs: number): Promise<void> {
    await this.db.run('DELETE FROM events WHERE received_at < ?', [olderThanMs]);
  }
}
