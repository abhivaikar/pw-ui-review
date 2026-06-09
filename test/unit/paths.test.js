import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolvePaths, DEFAULT_PORT } from '../../src/core/paths.js';

const cwd = '/proj';
// Build an `exists` probe from a set of present absolute paths.
const existsFrom = (present) => (p) => present.has(path.resolve(p));

describe('resolvePaths — results', () => {
  it('honors an explicit --results flag (relative -> absolute)', () => {
    const r = resolvePaths({ results: './custom/results.json' }, { cwd, exists: () => false });
    expect(r.resultsPath).toBe('/proj/custom/results.json');
    expect(r.resultsSource).toBe('flag');
  });

  it('keeps an absolute --results flag as-is', () => {
    const r = resolvePaths({ results: '/abs/results.json' }, { cwd, exists: () => false });
    expect(r.resultsPath).toBe('/abs/results.json');
  });

  it('prefers the standard Playwright path when it exists', () => {
    const present = new Set(['/proj/test-results/results.json']);
    const r = resolvePaths({}, { cwd, exists: existsFrom(present) });
    expect(r.resultsPath).toBe('/proj/test-results/results.json');
    expect(r.resultsSource).toBe('standard');
  });

  it('falls back to the demo submodule results when standard is absent', () => {
    const present = new Set(['/proj/demo/test-results/results.json']);
    const r = resolvePaths({}, { cwd, exists: existsFrom(present) });
    expect(r.resultsPath).toBe('/proj/demo/test-results/results.json');
    expect(r.resultsSource).toBe('demo');
  });

  it('defaults to the standard path (for error messaging) when nothing exists', () => {
    const r = resolvePaths({}, { cwd, exists: () => false });
    expect(r.resultsPath).toBe('/proj/test-results/results.json');
    expect(r.resultsSource).toBe('default');
  });

  it('prefers standard over demo when both exist', () => {
    const present = new Set([
      '/proj/test-results/results.json',
      '/proj/demo/test-results/results.json',
    ]);
    const r = resolvePaths({}, { cwd, exists: existsFrom(present) });
    expect(r.resultsSource).toBe('standard');
  });
});

describe('resolvePaths — snapshots', () => {
  it('honors an explicit --snapshots flag', () => {
    const r = resolvePaths({ snapshots: './e2e/__snapshots__' }, { cwd, exists: () => false });
    expect(r.snapshotsPath).toBe('/proj/e2e/__snapshots__');
    expect(r.snapshotsSource).toBe('flag');
  });

  it('falls back to demo/snapshots when present', () => {
    const present = new Set(['/proj/demo/snapshots']);
    const r = resolvePaths({}, { cwd, exists: existsFrom(present) });
    expect(r.snapshotsPath).toBe('/proj/demo/snapshots');
    expect(r.snapshotsSource).toBe('demo');
  });

  it('leaves snapshots null when nothing is found (rely on attachment paths)', () => {
    const r = resolvePaths({}, { cwd, exists: () => false });
    expect(r.snapshotsPath).toBeNull();
    expect(r.snapshotsSource).toBe('none');
  });
});

describe('resolvePaths — port', () => {
  it('defaults the port', () => {
    expect(resolvePaths({}, { cwd, exists: () => false }).port).toBe(DEFAULT_PORT);
  });
  it('accepts a valid port', () => {
    expect(resolvePaths({ port: 4242 }, { cwd, exists: () => false }).port).toBe(4242);
    expect(resolvePaths({ port: '4242' }, { cwd, exists: () => false }).port).toBe(4242);
  });
  it('rejects an invalid port and falls back to default', () => {
    expect(resolvePaths({ port: 0 }, { cwd, exists: () => false }).port).toBe(DEFAULT_PORT);
    expect(resolvePaths({ port: 99999 }, { cwd, exists: () => false }).port).toBe(DEFAULT_PORT);
    expect(resolvePaths({ port: 'abc' }, { cwd, exists: () => false }).port).toBe(DEFAULT_PORT);
  });
});
