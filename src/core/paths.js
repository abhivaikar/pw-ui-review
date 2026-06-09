// Path resolution — pure module.
//
// Resolves the results JSON and snapshots directory from CLI options, falling
// back through: explicit flag -> standard Playwright defaults (relative to cwd)
// -> the ./demo submodule defaults. This is what lets `node bin/pw-ui-review.js`
// with no arguments "just work" from the repo root once the demo submodule is
// initialised and its tests have been run.

import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_PORT = 3456;

const STANDARD_RESULTS = path.join('test-results', 'results.json');
const DEMO_RESULTS = path.join('demo', 'test-results', 'results.json');
const DEMO_SNAPSHOTS = path.join('demo', 'snapshots');

/**
 * @param {object} opts - parsed CLI options ({ results, snapshots, port })
 * @param {object} [deps]
 * @param {string} [deps.cwd] - working directory (default process.cwd())
 * @param {(p: string) => boolean} [deps.exists] - existence probe (default existsSync)
 */
export function resolvePaths(opts = {}, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const exists = deps.exists ?? existsSync;
  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));

  const results = resolveResults(opts.results, { cwd, exists, abs });
  const snapshots = resolveSnapshots(opts.snapshots, { cwd, exists, abs });

  return {
    resultsPath: results.path,
    resultsSource: results.source, // 'flag' | 'standard' | 'demo' | 'default'
    snapshotsPath: snapshots.path,
    snapshotsSource: snapshots.source,
    port: normalizePort(opts.port),
  };
}

function resolveResults(flag, { cwd, exists, abs }) {
  if (flag) return { path: abs(flag), source: 'flag' };

  const standard = path.resolve(cwd, STANDARD_RESULTS);
  if (exists(standard)) return { path: standard, source: 'standard' };

  const demo = path.resolve(cwd, DEMO_RESULTS);
  if (exists(demo)) return { path: demo, source: 'demo' };

  // Nothing exists yet — return the standard path so error messaging points at
  // the conventional location.
  return { path: standard, source: 'default' };
}

function resolveSnapshots(flag, { cwd, exists, abs }) {
  if (flag) return { path: abs(flag), source: 'flag' };

  // No reliable standard root exists (Playwright co-locates snapshots next to
  // each spec). The demo uses a single snapshotDir, so fall back to it when
  // present; otherwise leave null and rely on per-failure attachment paths.
  const demo = path.resolve(cwd, DEMO_SNAPSHOTS);
  if (exists(demo)) return { path: demo, source: 'demo' };

  return { path: null, source: 'none' };
}

function normalizePort(port) {
  if (port == null) return DEFAULT_PORT;
  const n = Number(port);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}
