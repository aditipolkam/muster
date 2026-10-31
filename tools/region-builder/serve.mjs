#!/usr/bin/env node
/**
 * Dev-only static server with HTTP Range support (python's http.server has none), so resumable
 * downloads can be tested locally. Not production hosting (D-3: static object storage/CDN).
 *
 *   node tools/region-builder/serve.mjs [--dir hosted] [--port 8787]
 *        [--throttle-kbps 2000] [--drop-after-mb 5]   # drop: kill the first response mid-stream
 *
 * /catalog.json serves catalog.dev.json when present, with region URLs rewritten to the Host
 * header so both iOS simulator (localhost) and Android emulator (10.0.2.2) work.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const dir = resolve(opt('dir', join(here, 'hosted')));
const port = Number(opt('port', '8787'));
const throttle = Number(opt('throttle-kbps', '0'));
let dropBytes = Number(opt('drop-after-mb', '0')) * 1024 * 1024;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  console.log(`${req.method} ${url.pathname} ${req.headers.range ?? ''}`);
  if (url.pathname === '/catalog.json') {
    const f = existsSync(join(dir, 'catalog.dev.json')) ? 'catalog.dev.json' : 'catalog.json';
    const base = `http://${req.headers.host}`;
    const body = readFileSync(join(dir, f), 'utf8').replace(/https?:\/\/[^/"]+\//g, `${base}/`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }
  const name = url.pathname.replace(/^\/+/, '');
  const file = join(dir, name);
  if (!name.endsWith('.pmtiles') || name.includes('..') || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const size = statSync(file).size;
  let start = 0;
  let end = size - 1;
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (m) {
    start = Number(m[1]);
    if (m[2]) end = Number(m[2]);
    if (start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'content-type': 'application/octet-stream' });
  } else {
    res.writeHead(200, { 'accept-ranges': 'bytes', 'content-length': size, 'content-type': 'application/octet-stream' });
  }
  const stream = createReadStream(file, { start, end, highWaterMark: 64 * 1024 });
  let sent = 0;
  stream.on('data', chunk => {
    sent += chunk.length;
    if (dropBytes > 0 && sent >= dropBytes) {
      console.log(`!! dropping connection after ${sent} bytes`);
      dropBytes = 0; // only once
      stream.destroy();
      req.socket.destroy();
      return;
    }
    if (!res.write(chunk)) {
      stream.pause();
      res.once('drain', () => stream.resume());
    }
    if (throttle > 0) {
      stream.pause();
      setTimeout(() => stream.resume(), (chunk.length / (throttle * 1024)) * 1000);
    }
  });
  stream.on('end', () => res.end());
  res.on('close', () => stream.destroy());
}).listen(port, () => console.log(`serving ${dir} on :${port}`));
