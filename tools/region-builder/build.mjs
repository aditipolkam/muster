#!/usr/bin/env node
/**
 * Maintainer-only tile extraction + catalog generation (docs/MAP_ARCHITECTURE.md section 3).
 * Requires the `pmtiles` CLI. Data: Protomaps basemap builds (OpenStreetMap, ODbL). Never uses the
 * public OSM tile servers.
 *
 *   node tools/region-builder/build.mjs --source https://build.protomaps.com/20261029.pmtiles \
 *        --base-url http://localhost:8787 [--out tools/region-builder/hosted] [--bundle] [--dev-fixtures]
 *
 * --planet-url   adds `planet` to the catalog: a hosted planet PMTiles (HTTP range requests) that the
 *                 app cuts custom areas from on the device. Host a Protomaps planet build on your own
 *                 storage/CDN with Range support; do not hotlink build.protomaps.com in production.
 * --bundle        also writes src/assets/catalog.json (the offline first-run catalog)
 * --dev-fixtures  adds a deliberately corrupt region and a too-large region used by device tests
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = name => args.includes(`--${name}`);

const source = opt('source');
if (!source) {
  console.error('--source <protomaps build .pmtiles url or path> is required');
  process.exit(2);
}
const baseUrl = opt('base-url', 'http://localhost:8787').replace(/\/$/, '');
const out = resolve(opt('out', join(here, 'hosted')));
mkdirSync(out, { recursive: true });

const dateMatch = /(\d{4})(\d{2})(\d{2})/.exec(source);
const osmDataDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toISOString().slice(0, 10);

const sha256 = file =>
  new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });

const { regions } = JSON.parse(readFileSync(join(here, 'regions.json'), 'utf8'));
const entries = [];
for (const r of regions) {
  const file = join(out, `${r.id}.pmtiles`);
  if (!existsSync(file) || flag('force')) {
    console.log(`extracting ${r.id}...`);
    execFileSync('pmtiles', ['extract', source, file, `--bbox=${r.bbox.join(',')}`, `--maxzoom=${r.maxZoom}`], { stdio: 'inherit' });
  }
  entries.push({
    id: r.id,
    name: r.name,
    bbox: r.bbox,
    minZoom: 0,
    maxZoom: r.maxZoom,
    bytes: statSync(file).size,
    sha256: await sha256(file),
    url: `${baseUrl}/${r.id}.pmtiles`,
    osmDataDate,
    schema: 1,
  });
}

const planetUrl = opt('planet-url');
const planet = planetUrl ? { url: planetUrl, osmDataDate } : undefined;
const catalog = { catalogVersion: 1, generatedAt: new Date().toISOString(), ...(planet ? { planet } : {}), regions: entries };
writeFileSync(join(out, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');

if (flag('bundle')) {
  const dest = join(here, '..', '..', 'src', 'assets', 'catalog.json');
  writeFileSync(dest, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`bundled catalog -> ${dest}`);
}

if (flag('dev-fixtures')) {
  // A file whose bytes differ from the advertised sha256 (flip bytes after the header).
  const good = entries[entries.length - 1];
  const corruptFile = join(out, 'test-corrupt.pmtiles');
  copyFileSync(join(out, `${good.id}.pmtiles`), corruptFile);
  const fd = openSync(corruptFile, 'r+');
  writeSync(fd, Buffer.from([0xde, 0xad, 0xbe, 0xef]), 0, 4, 4096);
  closeSync(fd);
  // Advertised as a very large file to exercise the low-space guard.
  const dev = {
    catalogVersion: 1,
    generatedAt: catalog.generatedAt,
    ...(planet ? { planet } : {}),
    regions: [
      ...entries,
      { ...good, id: 'test-corrupt', name: 'TEST corrupt file (bad sha256)', url: `${baseUrl}/test-corrupt.pmtiles`, bytes: statSync(corruptFile).size },
      { ...good, id: 'test-too-large', name: 'TEST 500 GB (space guard)', bytes: 500 * 1024 ** 3, url: `${baseUrl}/test-too-large.pmtiles` },
    ],
  };
  writeFileSync(join(out, 'catalog.dev.json'), JSON.stringify(dev, null, 2) + '\n');
  console.log('dev fixtures -> catalog.dev.json');
}
console.log(`catalog: ${entries.length} regions in ${out}`);
