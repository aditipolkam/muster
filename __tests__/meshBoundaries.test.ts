import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sources = walk(SRC).filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('/assets/generated/'));

describe('mesh integration boundaries', () => {
  it('only src/mesh/sdk.ts imports the SDK package', () => {
    const importers = sources
      .filter(f => /from '@offline-protocol\/mesh-sdk[^']*'/.test(strip(readFileSync(f, 'utf8'))))
      .map(f => relative(SRC, f));
    expect(importers).toEqual(['mesh/sdk.ts']);
  });

  it('nobody deep-imports SDK internals', () => {
    const deep = sources
      .filter(f => /mesh-sdk\//.test(strip(readFileSync(f, 'utf8'))))
      .map(f => relative(SRC, f));
    expect(deep).toEqual([]);
  });

  it('enableTelemetry is never called anywhere (CLAUDE.md rule 9, AC8)', () => {
    const offenders = sources
      .filter(
        f => !f.includes('/testing/') && /enableTelemetry/.test(strip(readFileSync(f, 'utf8'))),
      )
      .map(f => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('UI code never touches the mesh layer directly: it goes through runtime hooks and services', () => {
    const offenders = sources
      .filter(f => relative(SRC, f).startsWith('features/mesh-diagnostics/'))
      .filter(f =>
        /from '\.\.\/\.\.\/mesh\/(sdk|SdkMeshAdapter|permissions)'/.test(readFileSync(f, 'utf8')),
      )
      .map(f => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('the mesh layer contains no network or bundled-radio fakes', () => {
    const offenders = sources
      .filter(f => relative(SRC, f).startsWith('mesh/'))
      .filter(f =>
        /FakeMesh|FakeSdk|FakeNetwork|\bfetch\s*\(|WebSocket/.test(strip(readFileSync(f, 'utf8'))),
      )
      .map(f => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('test doubles are never imported by production code', () => {
    const offenders = sources
      .filter(f => !relative(SRC, f).startsWith('testing/'))
      .filter(f => /from '[^']*\/testing\//.test(readFileSync(f, 'utf8')))
      .map(f => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
