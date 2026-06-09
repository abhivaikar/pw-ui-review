import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  loadSession, saveSession, recordDecision, DECISIONS,
  approveBaseline, restoreBaseline,
  validateImport, confirmImport,
  loadProvenance, cleanSidecars,
  SESSION_FILE, PROVENANCE_FILE,
} from '../../src/core/fileops.js';

let root;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'pwur-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

// Make a solid-color PNG of given size.
async function makePng(file, { w = 100, h = 80, color = { r: 10, g: 20, b: 30 } } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(file);
}

describe('session persistence', () => {
  it('creates a fresh session with all keys unreviewed', async () => {
    const s = await loadSession(root, { runId: 'r1', resultsFile: 'x.json', keys: ['a.png', 'b.png'] });
    expect(s).toEqual({ runId: 'r1', resultsFile: 'x.json', decisions: { 'a.png': null, 'b.png': null } });
  });

  it('restores decisions when runId matches', async () => {
    let s = await loadSession(root, { runId: 'r1', resultsFile: 'x.json', keys: ['a.png', 'b.png'] });
    s = await recordDecision(root, s, 'a.png', DECISIONS.UPDATED);
    const reloaded = await loadSession(root, { runId: 'r1', resultsFile: 'x.json', keys: ['a.png', 'b.png'] });
    expect(reloaded.decisions['a.png']).toBe('updated');
    expect(reloaded.decisions['b.png']).toBeNull();
  });

  it('resets to fresh when runId differs (tests were re-run)', async () => {
    let s = await loadSession(root, { runId: 'r1', resultsFile: 'x.json', keys: ['a.png'] });
    s = await recordDecision(root, s, 'a.png', DECISIONS.KEPT);
    const reloaded = await loadSession(root, { runId: 'r2', resultsFile: 'x.json', keys: ['a.png'] });
    expect(reloaded.runId).toBe('r2');
    expect(reloaded.decisions['a.png']).toBeNull();
  });

  it('reconciles a newly appearing key as unreviewed', async () => {
    let s = await loadSession(root, { runId: 'r1', resultsFile: 'x.json', keys: ['a.png'] });
    s = await recordDecision(root, s, 'a.png', DECISIONS.UPDATED);
    const reloaded = await loadSession(root, { runId: 'r1', resultsFile: 'x.json', keys: ['a.png', 'c.png'] });
    expect(reloaded.decisions).toEqual({ 'a.png': 'updated', 'c.png': null });
  });

  it('accepts the imported decision value and rejects invalid ones', async () => {
    let s = await loadSession(root, { runId: 'r1', resultsFile: 'x.json', keys: ['a.png'] });
    s = await recordDecision(root, s, 'a.png', DECISIONS.IMPORTED);
    expect(s.decisions['a.png']).toBe('imported');
    await expect(recordDecision(root, s, 'a.png', 'bogus')).rejects.toThrow(/Invalid decision/);
  });
});

describe('approve / restore', () => {
  it('copies the actual screenshot over the baseline and returns a backup', async () => {
    const expected = path.join(root, 'snap', 'hero.png');
    const actual = path.join(root, 'results', 'actual.png');
    await makePng(expected, { color: { r: 0, g: 0, b: 0 } });
    await makePng(actual, { color: { r: 255, g: 255, b: 255 } });

    const before = await readFile(expected);
    const { backup } = await approveBaseline({ expectedPath: expected, actualPath: actual });

    expect(await readFile(expected)).toEqual(await readFile(actual)); // baseline now == actual
    expect(backup).toEqual(before); // backup is the old baseline
  });

  it('does not modify the actual screenshot (test-results is read-only)', async () => {
    const expected = path.join(root, 'snap', 'hero.png');
    const actual = path.join(root, 'results', 'actual.png');
    await makePng(expected);
    await makePng(actual, { color: { r: 1, g: 2, b: 3 } });
    const actualMtime = (await stat(actual)).mtimeMs;
    const actualBytes = await readFile(actual);

    await approveBaseline({ expectedPath: expected, actualPath: actual });

    expect((await stat(actual)).mtimeMs).toBe(actualMtime);
    expect(await readFile(actual)).toEqual(actualBytes);
  });

  it('writes a new baseline (backup null) when none existed, and restore removes it', async () => {
    const expected = path.join(root, 'snap', 'new.png');
    const actual = path.join(root, 'results', 'actual.png');
    await makePng(actual);

    const { backup } = await approveBaseline({ expectedPath: expected, actualPath: actual });
    expect(backup).toBeNull();
    expect(existsSync(expected)).toBe(true);

    await restoreBaseline({ expectedPath: expected, backup });
    expect(existsSync(expected)).toBe(false); // restored to "no baseline"
  });

  it('restore puts back the original bytes', async () => {
    const expected = path.join(root, 'snap', 'hero.png');
    const actual = path.join(root, 'results', 'actual.png');
    await makePng(expected, { color: { r: 9, g: 9, b: 9 } });
    await makePng(actual, { color: { r: 200, g: 100, b: 50 } });

    const original = await readFile(expected);
    const { backup } = await approveBaseline({ expectedPath: expected, actualPath: actual });
    await restoreBaseline({ expectedPath: expected, backup });
    expect(await readFile(expected)).toEqual(original);
  });

  it('throws clearly when the actual screenshot is missing', async () => {
    await expect(approveBaseline({ expectedPath: path.join(root, 'b.png'), actualPath: path.join(root, 'missing.png') }))
      .rejects.toThrow(/actual screenshot not found/);
  });
});

describe('external import', () => {
  it('passes validation when dimensions match the existing baseline', async () => {
    const expected = path.join(root, 'snap', 'hero.png');
    const source = path.join(root, 'design.png');
    await makePng(expected, { w: 200, h: 150 });
    await makePng(source, { w: 200, h: 150 });
    const res = await validateImport({ sourcePath: source, expectedPath: expected, actualPath: null });
    expect(res.ok).toBe(true);
    expect(res.reference).toEqual({ width: 200, height: 150 });
  });

  it('fails validation on dimension mismatch', async () => {
    const expected = path.join(root, 'snap', 'hero.png');
    const source = path.join(root, 'design.png');
    await makePng(expected, { w: 1280, h: 800 });
    await makePng(source, { w: 1280, h: 900 });
    const res = await validateImport({ sourcePath: source, expectedPath: expected, actualPath: null });
    expect(res.ok).toBe(false);
    expect(res.source).toEqual({ width: 1280, height: 900 });
    expect(res.reference).toEqual({ width: 1280, height: 800 });
  });

  it('falls back to the actual screenshot as reference when no baseline exists', async () => {
    const expected = path.join(root, 'snap', 'missing.png'); // does not exist
    const actual = path.join(root, 'results', 'actual.png');
    const source = path.join(root, 'design.png');
    await makePng(actual, { w: 300, h: 300 });
    await makePng(source, { w: 300, h: 300 });
    const res = await validateImport({ sourcePath: source, expectedPath: expected, actualPath: actual });
    expect(res.ok).toBe(true);
  });

  it('confirmImport writes the baseline and a provenance record', async () => {
    const expected = path.join(root, 'snap', 'hero-chromium-darwin.png');
    const source = path.join(root, 'design-v3.png');
    await makePng(expected, { w: 120, h: 90, color: { r: 0, g: 0, b: 0 } });
    await makePng(source, { w: 120, h: 90, color: { r: 240, g: 240, b: 240 } });

    await confirmImport({
      projectRoot: root,
      key: 'hero-chromium-darwin.png',
      sourcePath: source,
      expectedPath: expected,
      actualPath: null,
      originalFilename: 'design-v3-approved.png',
      now: () => new Date('2026-06-06T10:32:00Z'),
    });

    expect(await readFile(expected)).toEqual(await readFile(source));
    const prov = await loadProvenance(root);
    expect(prov['hero-chromium-darwin.png']).toEqual({
      source: 'external',
      importedAt: '2026-06-06T10:32:00.000Z',
      originalFilename: 'design-v3-approved.png',
    });
  });

  it('confirmImport refuses to write on dimension mismatch', async () => {
    const expected = path.join(root, 'snap', 'hero.png');
    const source = path.join(root, 'wrong.png');
    await makePng(expected, { w: 100, h: 100 });
    await makePng(source, { w: 100, h: 120 });
    const original = await readFile(expected);

    await expect(confirmImport({ projectRoot: root, key: 'hero.png', sourcePath: source, expectedPath: expected, actualPath: null }))
      .rejects.toThrow(/mismatch/i);
    expect(await readFile(expected)).toEqual(original); // untouched
    expect(existsSync(path.join(root, PROVENANCE_FILE))).toBe(false); // no provenance written
  });
});

describe('cleanSidecars', () => {
  it('removes the session file but keeps provenance by default', async () => {
    await writeFile(path.join(root, SESSION_FILE), '{}');
    await writeFile(path.join(root, PROVENANCE_FILE), '{}');
    const res = await cleanSidecars(root);
    expect(res.removed).toEqual([SESSION_FILE]);
    expect(res.provenanceExists).toBe(true);
    expect(existsSync(path.join(root, PROVENANCE_FILE))).toBe(true);
  });

  it('removes provenance only when explicitly requested', async () => {
    await writeFile(path.join(root, SESSION_FILE), '{}');
    await writeFile(path.join(root, PROVENANCE_FILE), '{}');
    const res = await cleanSidecars(root, { removeProvenance: true });
    expect(res.removed).toContain(PROVENANCE_FILE);
    expect(existsSync(path.join(root, PROVENANCE_FILE))).toBe(false);
  });
});
