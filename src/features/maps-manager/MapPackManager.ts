import { RegionsRepo } from '../../data/repositories/RegionsRepo';
import { KvRepo } from '../../data/repositories/KvRepo';
import { Catalog, Planet, RegionEntry, parseCatalog } from '../../domain/maps/catalog';
import { BBox } from '../../domain/geo';
import { PMTILES_HEADER_BYTES, PmtilesError, parsePmtilesHeader } from '../../domain/maps/pmtiles';
import {
  RegionRecord,
  hasEnoughSpace,
  nextRegionState,
  requiredFreeBytes,
} from '../../domain/maps/region';
import { formatBytes } from '../../domain/geo';
import { FilePort } from '../../platform/FilePort';
import { Clock } from '../../shared/clock';
import { createLogger } from '../../shared/logger';
import { AppError, Result, appError, err, ok } from '../../shared/result';
import { sha256File } from './hash';
import { resolveRegionUrl } from '../../shared/config';
import { HttpClient } from './http';
import { AreaPlan } from '../../domain/maps/area';
import { ExtractError, extractArea, planArea } from './RegionExtractor';

const log = createLogger('maps');

export type ProgressPhase = 'downloading' | 'verifying';
export type ProgressEvent = {
  id: string;
  phase: ProgressPhase;
  receivedBytes: number;
  totalBytes: number;
};
export type ProgressSink = (e: ProgressEvent | { id: string; phase: 'idle' }) => void;

export type StorageUsage = {
  regionsBytes: number;
  partialBytes: number;
  styleBytes: number;
  freeBytes: number;
};

export type CatalogLoad = { catalog: Catalog; source: 'remote' | 'cache' | 'bundled' };

export type MapPackDeps = {
  fs: FilePort;
  http: HttpClient;
  regions: RegionsRepo;
  kv: KvRepo;
  clock: Clock;
  bundledCatalog: Catalog;
  catalogUrl: () => string;
  newId: () => string;
  progress?: ProgressSink;
  /** Planet archive used when the catalog names none (development only). */
  fallbackPlanet?: () => Planet | null;
  /** Older candidates tried in order when the first planet URL cannot be read. */
  fallbackPlanets?: () => Planet[];
};

const CATALOG_CACHE_KEY = 'catalog.cache';
const PERSIST_EVERY_BYTES = 1024 * 1024;

export const errors = {
  space: (need: number, have: number): AppError =>
    appError(
      'insufficient_space',
      `Not enough free space. This download needs about ${formatBytes(
        need,
      )} free, but only ${formatBytes(have)} is available.`,
      { retryable: true },
    ),
  network: (m: string): AppError =>
    appError('network', 'The download was interrupted. Check your connection and resume.', {
      retryable: true,
      message: m,
    }),
  http: (status: number): AppError =>
    appError('http_' + status, `The map server answered with an error (HTTP ${status}).`, {
      retryable: status >= 500 || status === 429,
    }),
  incomplete: (): AppError =>
    appError(
      'incomplete',
      'The download ended before the whole file arrived. Resume to continue.',
      {
        retryable: true,
      },
    ),
  checksum: (): AppError =>
    appError(
      'checksum_mismatch',
      'The downloaded file failed its integrity check and was removed. Download it again.',
      { retryable: true },
    ),
  invalid: (e: PmtilesError): AppError => appError('invalid_pmtiles', e.message),
  noPlanet: (): AppError =>
    appError(
      'no_planet',
      'Custom areas are not available: no map source is configured. You can still download the listed regions or import a file.',
    ),
  area: (e: ExtractError): AppError =>
    appError(e.code, e.message, { retryable: e.code === 'source_unreachable' }),
  disk: (m: string): AppError =>
    appError('disk_error', 'The map file could not be written to storage.', { message: m }),
};

class PausedSignal extends Error {}

type Job = { ctl: AbortController; reason: 'pause' | 'cancel' | null; done: Promise<void> };

/** Catalog, resumable download, SHA-256 verify, import, delete, storage (MAP_ARCHITECTURE.md 3.1). */
export class MapPackManager {
  private jobs = new Map<string, Job>();
  /** Ids reserved synchronously so a double tap cannot start two jobs on the same .part file. */
  private starting = new Set<string>();
  readonly mapsDir: string;
  readonly styleDir: string;

  constructor(private readonly d: MapPackDeps) {
    this.mapsDir = `${d.fs.root}maps/`;
    this.styleDir = `${d.fs.root}style/`;
  }

  partUri = (id: string) => `${this.mapsDir}${id}.pmtiles.part`;
  finalUri = (id: string) => `${this.mapsDir}${id}.pmtiles`;

  /** Create dirs and reconcile anything that was mid-flight when the app died. */
  async init(): Promise<void> {
    await this.d.fs.mkdirp(this.mapsDir);
    for (const r of await this.d.regions.list()) {
      if (this.jobs.has(r.id)) {
        continue;
      }
      if (r.source === 'custom' && r.state !== 'installed') {
        // A custom area is cut on the device and cannot resume: drop the partial work.
        await this.d.fs.remove(this.partUri(r.id));
        await this.d.regions.delete(r.id);
      } else if (r.state === 'downloading' || r.state === 'verifying') {
        // The process died: keep the .part file, offer Resume.
        const have = await this.d.fs.size(this.partUri(r.id));
        await this.d.regions.setState(r.id, 'paused', {
          errorCode: 'interrupted',
          progressBytes: have,
        });
      } else if (r.state === 'installed' && r.filePath && !(await this.d.fs.exists(r.filePath))) {
        log.warn(`installed region ${r.id} lost its file; marking failed`);
        await this.d.regions.setState(r.id, 'failed', { errorCode: 'file_missing' });
      }
    }
    await this.adoptOrphans();
  }

  /**
   * Recovers valid archives in maps/ that have no database row (e.g. the app died between the
   * atomic rename and the insert, or the database was reset). Only header-valid files are adopted.
   */
  private async adoptOrphans(): Promise<void> {
    const { fs, regions, clock } = this.d;
    const known = new Set((await regions.list()).map(r => r.id));
    const names = await fs.list(this.mapsDir);
    for (const name of names) {
      const m = /^([a-z0-9][a-z0-9-]{0,62})\.pmtiles$/.exec(name);
      if (!m || known.has(m[1] as string)) {
        continue;
      }
      const uri = `${this.mapsDir}${name}`;
      try {
        const size = await fs.size(uri);
        const header = parsePmtilesHeader(await fs.readRange(uri, 0, PMTILES_HEADER_BYTES));
        await regions.upsert({
          id: m[1] as string,
          name: (m[1] as string).replace(/-/g, ' '),
          bbox: header.bounds,
          minZoom: header.minZoom,
          maxZoom: header.maxZoom,
          bytes: size,
          sha256: null,
          osmDataDate: null,
          schemaV: 1,
          state: 'installed',
          progressBytes: size,
          filePath: uri,
          installedAt: clock.now(),
          source: 'import',
          errorCode: null,
          sourceUrl: null,
        });
        log.info(`adopted untracked map file ${name}`);
      } catch (e) {
        log.warn(`ignoring invalid file ${name}: ${String(e)}`);
      }
    }
  }

  // ---------------------------------------------------------------- catalog

  async loadCatalog(opts: { refresh: boolean }): Promise<CatalogLoad> {
    if (opts.refresh) {
      try {
        const json = await this.d.http.getJson(this.d.catalogUrl(), {});
        const catalog = parseCatalog(json);
        await this.d.kv.setJson(CATALOG_CACHE_KEY, catalog);
        return { catalog, source: 'remote' };
      } catch (e) {
        log.warn(`catalog refresh failed: ${String(e)}`);
      }
    }
    const cached = await this.d.kv.getJson<unknown>(CATALOG_CACHE_KEY);
    if (cached) {
      try {
        return { catalog: parseCatalog(cached), source: 'cache' };
      } catch {
        /* fall through to bundled */
      }
    }
    return { catalog: this.d.bundledCatalog, source: 'bundled' };
  }

  // --------------------------------------------------------------- download

  isActive(id: string): boolean {
    return this.jobs.has(id);
  }

  /** Start or resume a catalog region. Resolves when the job has been launched, not finished. */
  async start(entry: RegionEntry): Promise<Result<void>> {
    if (this.jobs.has(entry.id) || this.starting.has(entry.id)) {
      return ok(undefined);
    }
    this.starting.add(entry.id);
    try {
      return await this.launch(entry);
    } finally {
      this.starting.delete(entry.id);
    }
  }

  private async launch(entry: RegionEntry): Promise<Result<void>> {
    const existing = await this.d.regions.get(entry.id);
    if (existing?.state === 'installed') {
      return ok(undefined);
    }
    const base: RegionRecord = existing ?? {
      id: entry.id,
      name: entry.name,
      bbox: entry.bbox,
      minZoom: entry.minZoom,
      maxZoom: entry.maxZoom,
      bytes: entry.bytes,
      sha256: entry.sha256,
      osmDataDate: entry.osmDataDate,
      schemaV: entry.schema,
      state: 'available',
      progressBytes: 0,
      filePath: null,
      installedAt: null,
      source: 'catalog',
      errorCode: null,
      sourceUrl: entry.url,
    };
    // The catalog is authoritative for size/hash/url of what we are about to fetch.
    const rec: RegionRecord = {
      ...base,
      name: entry.name,
      bbox: entry.bbox,
      minZoom: entry.minZoom,
      maxZoom: entry.maxZoom,
      bytes: entry.bytes,
      sha256: entry.sha256,
      osmDataDate: entry.osmDataDate,
      schemaV: entry.schema,
      sourceUrl: entry.url,
      state: nextRegionState(base.state, { type: base.state === 'failed' ? 'retry' : 'start' }),
      errorCode: null,
    };
    if (rec.state !== 'downloading') {
      // paused -> downloading is also a 'start'
      rec.state = 'downloading';
    }
    await this.d.regions.upsert(rec);

    const ctl = new AbortController();
    const job: Job = { ctl, reason: null, done: Promise.resolve() };
    this.jobs.set(entry.id, job);
    job.done = this.run(rec, job).finally(() => {
      this.jobs.delete(entry.id);
      this.d.progress?.({ id: entry.id, phase: 'idle' });
    });
    return ok(undefined);
  }

  /** Resolves when the active job for id (if any) has fully settled. */
  async whenSettled(id: string): Promise<void> {
    await this.jobs.get(id)?.done;
  }

  async pause(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.reason = 'pause';
      job.ctl.abort();
      await job.done;
    }
  }

  resume(entry: RegionEntry): Promise<Result<void>> {
    return this.start(entry);
  }

  /** Resume (or retry) from the stored record, e.g. after the app was killed mid-download. */
  async resumeById(id: string): Promise<Result<void>> {
    const r = await this.d.regions.get(id);
    if (!r || r.source !== 'catalog' || !r.sourceUrl || !r.sha256) {
      return err(appError('not_resumable', 'This download can no longer be resumed.'));
    }
    return this.start({
      id: r.id,
      name: r.name,
      bbox: r.bbox,
      minZoom: r.minZoom,
      maxZoom: r.maxZoom,
      bytes: r.bytes,
      sha256: r.sha256,
      url: r.sourceUrl,
      osmDataDate: r.osmDataDate ?? '1970-01-01',
      schema: r.schemaV,
    });
  }

  /** Abort and discard partial data, returning the region to "available". */
  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.reason = 'cancel';
      job.ctl.abort();
      await job.done;
    }
    await this.d.fs.remove(this.partUri(id));
    const rec = await this.d.regions.get(id);
    if (rec && rec.state !== 'installed') {
      await this.d.regions.delete(id);
    }
  }

  private async fail(rec: RegionRecord, e: AppError): Promise<void> {
    log.warn(`region ${rec.id} failed: ${e.code}`);
    const have = await this.d.fs.size(this.partUri(rec.id));
    await this.d.regions.setState(rec.id, nextRegionState('downloading', { type: 'fail' }), {
      errorCode: e.code,
      progressBytes: have,
    });
  }

  private async run(rec: RegionRecord, job: Job): Promise<void> {
    const { fs, regions } = this.d;
    const part = this.partUri(rec.id);
    const emit = (phase: ProgressPhase, received: number) =>
      this.d.progress?.({ id: rec.id, phase, receivedBytes: received, totalBytes: rec.bytes });
    try {
      let have = await fs.size(part);
      if (have > rec.bytes) {
        await fs.remove(part);
        have = 0;
      }
      if (have < rec.bytes) {
        const need = rec.bytes - have;
        const free = await fs.freeBytes();
        if (!hasEnoughSpace(free, need)) {
          await this.fail(rec, errors.space(requiredFreeBytes(need), free));
          return;
        }
        have = await this.download(rec, part, have, job, emit);
        if (have === -1) {
          return; // failure already recorded
        }
      }
      if (have !== rec.bytes) {
        await this.fail(rec, errors.incomplete());
        return;
      }
      await this.verifyAndInstall(rec, part, job, emit);
    } catch (e) {
      if (job.ctl.signal.aborted) {
        if (job.reason === 'cancel') {
          return;
        }
        const have = await fs.size(part);
        await regions.setState(rec.id, 'paused', { errorCode: null, progressBytes: have });
        return;
      }
      await this.fail(rec, errors.network(String(e)));
    }
  }

  /** Returns total bytes in the .part file, or -1 if a failure was recorded. */
  private async download(
    rec: RegionRecord,
    part: string,
    startAt: number,
    job: Job,
    emit: (p: ProgressPhase, n: number) => void,
  ): Promise<number> {
    const { fs, http, regions } = this.d;
    const url = rec.sourceUrl;
    if (!url) {
      await this.fail(rec, appError('no_url', 'This region has no download address.'));
      return -1;
    }
    let offset = startAt;
    const res = await http.stream(url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
      signal: job.ctl.signal,
    });
    if (res.status === 416) {
      // Range not satisfiable: our part is bad. Start over.
      await fs.remove(part);
      await regions.setProgress(rec.id, 0);
      return this.download(rec, part, 0, job, emit);
    }
    if (offset > 0 && res.status === 200) {
      // Server ignored Range and is sending the whole file: restart from zero.
      await fs.remove(part);
      offset = 0;
    } else if (res.status === 206) {
      const m = /^bytes (\d+)-/.exec(res.headers['content-range'] ?? '');
      if (!m || Number(m[1]) !== offset) {
        await this.fail(rec, errors.http(206));
        return -1;
      }
    } else if (res.status < 200 || res.status >= 300) {
      await this.fail(rec, errors.http(res.status));
      return -1;
    }
    const writer = await fs.openWriter(part, offset > 0 ? 'append' : 'truncate');
    let sincePersist = 0;
    try {
      for await (const chunk of res.body) {
        if (job.ctl.signal.aborted) {
          throw new PausedSignal();
        }
        if (offset + chunk.length > rec.bytes) {
          // More bytes than the catalog promised: corrupt or wrong file.
          await writer.close();
          await fs.remove(part);
          await this.fail(rec, errors.checksum());
          return -1;
        }
        await writer.write(chunk);
        offset += chunk.length;
        sincePersist += chunk.length;
        emit('downloading', offset);
        if (sincePersist >= PERSIST_EVERY_BYTES) {
          sincePersist = 0;
          await regions.setProgress(rec.id, offset);
        }
      }
    } catch (e) {
      await writer.close().catch(() => undefined);
      await regions.setProgress(rec.id, await fs.size(part)).catch(() => undefined);
      if (job.ctl.signal.aborted || e instanceof PausedSignal) {
        throw e instanceof PausedSignal ? e : new PausedSignal();
      }
      if (String(e).includes('disk write failed') || /ENOSPC|No space/i.test(String(e))) {
        await this.fail(rec, errors.disk(String(e)));
        return -1;
      }
      throw e;
    }
    await writer.close();
    await regions.setProgress(rec.id, offset);
    return offset;
  }

  private async verifyAndInstall(
    rec: RegionRecord,
    part: string,
    job: Job,
    emit: (p: ProgressPhase, n: number) => void,
  ): Promise<void> {
    const { fs, regions, clock } = this.d;
    await regions.setState(rec.id, nextRegionState('downloading', { type: 'downloaded' }), {
      progressBytes: rec.bytes,
    });
    emit('verifying', 0);
    const digest = await sha256File(
      fs,
      part,
      (done, total) => emit('verifying', (done / total) * rec.bytes),
      job.ctl.signal,
    );
    if (rec.sha256 && digest !== rec.sha256) {
      await fs.remove(part);
      await regions.setProgress(rec.id, 0);
      await regions.setState(rec.id, 'failed', {
        errorCode: 'checksum_mismatch',
        progressBytes: 0,
      });
      return;
    }
    try {
      parsePmtilesHeader(await fs.readRange(part, 0, PMTILES_HEADER_BYTES));
    } catch (e) {
      await fs.remove(part);
      await regions.setState(rec.id, 'failed', {
        errorCode: e instanceof PmtilesError ? 'invalid_pmtiles' : 'unreadable',
        progressBytes: 0,
      });
      return;
    }
    const finalUri = this.finalUri(rec.id);
    await fs.move(part, finalUri);
    await regions.upsert({
      ...rec,
      state: nextRegionState('verifying', { type: 'verified' }),
      progressBytes: rec.bytes,
      filePath: finalUri,
      installedAt: clock.now(),
      errorCode: null,
    });
  }

  // ------------------------------------------------------------ online map

  /**
   * The planet archive MapLibre may stream directly while no downloaded region covers the view.
   * Null when no source is known (release builds without `planet` in the catalog).
   */
  async onlineSource(): Promise<{ uri: string; osmDataDate: string } | null> {
    const planet =
      (await this.loadCatalog({ refresh: false })).catalog.planet ?? this.d.fallbackPlanet?.();
    return planet ? { uri: resolveRegionUrl(planet.url), osmDataDate: planet.osmDataDate } : null;
  }

  // ------------------------------------------------------------ custom areas

  /** How big would this area be? Reads directories only; no tile data is downloaded. */
  async planArea(bbox: BBox, maxZoom: number, signal?: AbortSignal): Promise<Result<AreaPlan>> {
    // Cached catalog first: a refresh can stall for seconds when the catalog host is unreachable.
    const fromCatalog =
      (await this.loadCatalog({ refresh: false })).catalog.planet ??
      (await this.loadCatalog({ refresh: true })).catalog.planet;
    const first = this.d.fallbackPlanet?.();
    const candidates = fromCatalog
      ? [fromCatalog]
      : [...(first ? [first] : []), ...(this.d.fallbackPlanets?.() ?? [])].filter(
          (p, i, all) => all.findIndex(q => q.url === p.url) === i,
        );
    if (candidates.length === 0) {
      return err(errors.noPlanet());
    }
    let lastError: ExtractError | null = null;
    for (const planet of candidates) {
      try {
        return ok(
          await planArea(
            { http: this.d.http, fs: this.d.fs },
            { url: resolveRegionUrl(planet.url), osmDataDate: planet.osmDataDate },
            bbox,
            maxZoom,
            signal,
          ),
        );
      } catch (e) {
        if (signal?.aborted) {
          return err(appError('cancelled', 'Cancelled.'));
        }
        if (!(e instanceof ExtractError)) {
          return err(errors.network(String(e)));
        }
        lastError = e;
        log.warn(`planet ${planet.url} unusable: ${e.message}`);
        if (e.code !== 'source_unreachable') {
          break;
        }
      }
    }
    return err(errors.area(lastError!));
  }

  /** Download a planned area as a new region. Resolves once the job is launched. */
  async startArea(plan: AreaPlan, name: string): Promise<Result<RegionRecord>> {
    try {
      return await this.launchArea(plan, name);
    } catch (e) {
      log.warn(`startArea failed: ${String(e)}`);
      return err(
        appError('start_failed', `Could not start the download (${String(e).slice(0, 120)}).`),
      );
    }
  }

  private async launchArea(plan: AreaPlan, name: string): Promise<Result<RegionRecord>> {
    const free = await this.d.fs.freeBytes();
    if (!hasEnoughSpace(free, plan.fileBytes)) {
      return err(errors.space(requiredFreeBytes(plan.fileBytes), free));
    }
    const id = `area-${this.d.newId().toLowerCase()}`;
    const rec: RegionRecord = {
      id,
      name: name.trim().slice(0, 80) || 'Custom area',
      bbox: plan.bbox,
      minZoom: plan.minZoom,
      maxZoom: plan.maxZoom,
      bytes: plan.fileBytes,
      sha256: null,
      osmDataDate: plan.osmDataDate,
      schemaV: 1,
      state: 'downloading',
      progressBytes: 0,
      filePath: null,
      installedAt: null,
      source: 'custom',
      errorCode: null,
      sourceUrl: plan.planetUrl,
    };
    await this.d.regions.upsert(rec);
    const ctl = new AbortController();
    const job: Job = { ctl, reason: null, done: Promise.resolve() };
    this.jobs.set(id, job);
    job.done = this.runArea(rec, plan, job).finally(() => {
      this.jobs.delete(id);
      this.d.progress?.({ id, phase: 'idle' });
    });
    return ok(rec);
  }

  private async runArea(rec: RegionRecord, plan: AreaPlan, job: Job): Promise<void> {
    const { fs, regions, clock } = this.d;
    const part = this.partUri(rec.id);
    try {
      const size = await extractArea(
        { http: this.d.http, fs },
        plan,
        part,
        written =>
          this.d.progress?.({
            id: rec.id,
            phase: 'downloading',
            receivedBytes: plan.prefix.length + written,
            totalBytes: plan.fileBytes,
          }),
        job.ctl.signal,
      );
      if (size !== plan.fileBytes) {
        await this.fail(rec, errors.incomplete());
        return;
      }
      parsePmtilesHeader(await fs.readRange(part, 0, PMTILES_HEADER_BYTES));
      const finalUri = this.finalUri(rec.id);
      await fs.move(part, finalUri);
      await regions.upsert({
        ...rec,
        state: 'installed',
        bytes: size,
        progressBytes: size,
        filePath: finalUri,
        installedAt: clock.now(),
        errorCode: null,
      });
    } catch (e) {
      if (job.ctl.signal.aborted) {
        // cancel() removes the part file and the record.
        return;
      }
      await this.fail(rec, e instanceof ExtractError ? errors.area(e) : errors.network(String(e)));
    }
  }

  // ----------------------------------------------------------------- import

  /**
   * Import a .pmtiles the user picked in Files. `srcUri` must already be inside the app sandbox
   * (the picker's cache copy); it is moved into place.
   */
  async importFile(srcUri: string, displayName: string): Promise<Result<RegionRecord>> {
    const { fs, regions, clock } = this.d;
    try {
      const size = await fs.size(srcUri);
      if (size < PMTILES_HEADER_BYTES) {
        return err(appError('invalid_pmtiles', 'The file is too small to be a PMTiles archive.'));
      }
      const header = parsePmtilesHeader(await fs.readRange(srcUri, 0, PMTILES_HEADER_BYTES));
      const free = await fs.freeBytes();
      if (!hasEnoughSpace(free, size)) {
        return err(errors.space(requiredFreeBytes(size), free));
      }
      const id = `import-${this.d.newId().toLowerCase()}`;
      const dest = this.finalUri(id);
      await fs.move(srcUri, dest);
      const rec: RegionRecord = {
        id,
        name: displayName.replace(/\.pmtiles$/i, '').slice(0, 80) || 'Imported map',
        bbox: header.bounds,
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
        bytes: size,
        sha256: null,
        osmDataDate: null,
        schemaV: 1,
        state: 'installed',
        progressBytes: size,
        filePath: dest,
        installedAt: clock.now(),
        source: 'import',
        errorCode: null,
        sourceUrl: null,
      };
      await regions.upsert(rec);
      return ok(rec);
    } catch (e) {
      if (e instanceof PmtilesError) {
        return err(errors.invalid(e));
      }
      return err(errors.disk(String(e)));
    }
  }

  // ------------------------------------------------------------------ delete

  async delete(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.reason = 'cancel';
      job.ctl.abort();
      await job.done;
    }
    const rec = await this.d.regions.get(id);
    await this.d.fs.remove(this.partUri(id));
    await this.d.fs.remove(rec?.filePath ?? this.finalUri(id));
    await this.d.regions.delete(id);
  }

  // ----------------------------------------------------------------- storage

  async storageUsage(): Promise<StorageUsage> {
    const { fs, regions } = this.d;
    let regionsBytes = 0;
    for (const r of await regions.listInstalled()) {
      regionsBytes += r.filePath ? await fs.size(r.filePath) : 0;
    }
    let partialBytes = 0;
    for (const name of await fs.list(this.mapsDir)) {
      if (name.endsWith('.part')) {
        partialBytes += await fs.size(`${this.mapsDir}${name}`);
      }
    }
    const styleBytes = await fs.dirSize(this.styleDir);
    return { regionsBytes, partialBytes, styleBytes, freeBytes: await fs.freeBytes() };
  }
}
