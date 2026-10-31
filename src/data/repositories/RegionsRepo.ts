import { RegionRecord, RegionSource, RegionState } from '../../domain/maps/region';
import { DbPort } from '../DbPort';
import { Emitter } from '../events';

type Row = {
  id: string;
  name: string;
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
  min_zoom: number;
  max_zoom: number;
  bytes: number;
  sha256: string | null;
  osm_data_date: string | null;
  schema_v: number;
  state: RegionState;
  progress_bytes: number;
  file_path: string | null;
  installed_at: number | null;
  source: RegionSource;
  error_code: string | null;
  source_url: string | null;
};

const toRecord = (r: Row): RegionRecord => ({
  id: r.id,
  name: r.name,
  bbox: [r.min_lon, r.min_lat, r.max_lon, r.max_lat],
  minZoom: r.min_zoom,
  maxZoom: r.max_zoom,
  bytes: r.bytes,
  sha256: r.sha256,
  osmDataDate: r.osm_data_date,
  schemaV: r.schema_v,
  state: r.state,
  progressBytes: r.progress_bytes ?? 0,
  filePath: r.file_path,
  installedAt: r.installed_at,
  source: r.source ?? 'catalog',
  errorCode: r.error_code,
  sourceUrl: r.source_url,
});

export class RegionsRepo {
  readonly changes = new Emitter();

  constructor(private readonly db: DbPort) {}

  async list(): Promise<RegionRecord[]> {
    const rows = await this.db.all<Row>('SELECT * FROM map_regions ORDER BY name COLLATE NOCASE');
    return rows.map(toRecord);
  }

  async listInstalled(): Promise<RegionRecord[]> {
    return (await this.list()).filter(r => r.state === 'installed');
  }

  async get(id: string): Promise<RegionRecord | null> {
    const row = await this.db.get<Row>('SELECT * FROM map_regions WHERE id = ?', [id]);
    return row ? toRecord(row) : null;
  }

  async upsert(r: RegionRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO map_regions(id, name, min_lat, min_lon, max_lat, max_lon, min_zoom, max_zoom, bytes,
         sha256, osm_data_date, schema_v, state, progress_bytes, file_path, installed_at, source,
         error_code, source_url)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, min_lat=excluded.min_lat, min_lon=excluded.min_lon,
         max_lat=excluded.max_lat, max_lon=excluded.max_lon, min_zoom=excluded.min_zoom,
         max_zoom=excluded.max_zoom, bytes=excluded.bytes, sha256=excluded.sha256,
         osm_data_date=excluded.osm_data_date, schema_v=excluded.schema_v, state=excluded.state,
         progress_bytes=excluded.progress_bytes, file_path=excluded.file_path,
         installed_at=excluded.installed_at, source=excluded.source, error_code=excluded.error_code,
         source_url=excluded.source_url`,
      [
        r.id,
        r.name,
        r.bbox[1],
        r.bbox[0],
        r.bbox[3],
        r.bbox[2],
        r.minZoom,
        r.maxZoom,
        r.bytes,
        r.sha256,
        r.osmDataDate,
        r.schemaV,
        r.state,
        r.progressBytes,
        r.filePath,
        r.installedAt,
        r.source,
        r.errorCode,
        r.sourceUrl,
      ],
    );
    this.changes.emit();
  }

  /** Progress updates are frequent and do not notify subscribers; the UI reads the live store. */
  async setProgress(id: string, progressBytes: number): Promise<void> {
    await this.db.run('UPDATE map_regions SET progress_bytes = ? WHERE id = ?', [
      progressBytes,
      id,
    ]);
  }

  async setState(
    id: string,
    state: RegionState,
    extra: { errorCode?: string | null; progressBytes?: number } = {},
  ): Promise<void> {
    await this.db.run(
      `UPDATE map_regions SET state = ?, error_code = ?,
         progress_bytes = COALESCE(?, progress_bytes) WHERE id = ?`,
      [state, extra.errorCode ?? null, extra.progressBytes ?? null, id],
    );
    this.changes.emit();
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM map_regions WHERE id = ?', [id]);
    this.changes.emit();
  }
}
