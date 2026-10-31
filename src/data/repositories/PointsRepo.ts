import { Marker, MarkerInput, MarkerInputSchema } from '../../domain/markers/marker';
import { Clock } from '../../shared/clock';
import { DbPort } from '../DbPort';
import { Emitter } from '../events';

type Row = {
  id: string;
  name: string;
  note: string | null;
  lat: number;
  lon: number;
  created_at: number;
  updated_at: number;
};

const toMarker = (r: Row): Marker => ({
  id: r.id,
  name: r.name,
  note: r.note,
  lat: r.lat,
  lon: r.lon,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class PointsRepo {
  readonly changes = new Emitter();

  constructor(
    private readonly db: DbPort,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {}

  async list(): Promise<Marker[]> {
    const rows = await this.db.all<Row>(
      'SELECT * FROM local_points ORDER BY created_at DESC, id DESC',
    );
    return rows.map(toMarker);
  }

  async get(id: string): Promise<Marker | null> {
    const row = await this.db.get<Row>('SELECT * FROM local_points WHERE id = ?', [id]);
    return row ? toMarker(row) : null;
  }

  async create(input: MarkerInput): Promise<Marker> {
    const v = MarkerInputSchema.parse(input);
    const now = this.clock.now();
    const id = this.newId();
    await this.db.run(
      `INSERT INTO local_points(id, name, note, lat, lon, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`,
      [id, v.name, v.note ?? null, v.lat, v.lon, now, now],
    );
    this.changes.emit();
    return {
      id,
      name: v.name,
      note: v.note ?? null,
      lat: v.lat,
      lon: v.lon,
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(id: string, patch: Partial<MarkerInput>): Promise<Marker | null> {
    const cur = await this.get(id);
    if (!cur) {
      return null;
    }
    const v = MarkerInputSchema.parse({
      name: patch.name ?? cur.name,
      note: patch.note === undefined ? cur.note : patch.note,
      lat: patch.lat ?? cur.lat,
      lon: patch.lon ?? cur.lon,
    });
    const now = this.clock.now();
    await this.db.run(
      'UPDATE local_points SET name = ?, note = ?, lat = ?, lon = ?, updated_at = ? WHERE id = ?',
      [v.name, v.note ?? null, v.lat, v.lon, now, id],
    );
    this.changes.emit();
    return { ...cur, name: v.name, note: v.note ?? null, lat: v.lat, lon: v.lon, updatedAt: now };
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM local_points WHERE id = ?', [id]);
    this.changes.emit();
  }
}
