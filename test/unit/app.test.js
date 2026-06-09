import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { ReviewStore } from '../../src/server/store.js';
import { createApp } from '../../src/server/app.js';
import { SESSION_FILE, PROVENANCE_FILE } from '../../src/core/fileops.js';

let root;
const png = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
async function writePng(file, w, h, color) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await png(w, h, color));
}

// Build two failures with on-disk baseline/actual/diff under a tmp project.
async function buildStore() {
  const snap = path.join(root, 'snapshots');
  const results = path.join(root, 'test-results');
  const failures = [];
  for (const [i, name] of [['hero'], ['footer']].map((x, idx) => [idx, x[0]])) {
    const expected = path.join(snap, `${name}-chromium-darwin.png`);
    const actual = path.join(results, name, 'actual.png');
    const diff = path.join(results, name, 'diff.png');
    await writePng(expected, 100, 80, { r: 0, g: 0, b: 0 });
    await writePng(actual, 100, 80, { r: 255, g: 255, b: 255 });
    await writePng(diff, 100, 80, { r: 255, g: 0, b: 0 });
    failures.push({
      key: `${name}-chromium-darwin.png`,
      index: i,
      title: `${name} matches baseline`,
      assertionName: name,
      specFile: 'e2e/page.spec.ts',
      specFileName: 'page.spec.ts',
      line: 5 + i,
      projectName: 'chromium',
      diffSummary: '100 pixels different (1%)',
      pixelsDifferent: 100,
      percentDifferent: 1,
      steps: [{ number: 1, title: 'page.goto(/)', category: 'pw:api', durationMs: 10, failed: false }],
      hasBaseline: true,
      images: { expected, actual, diff },
      tracePath: null,
    });
  }
  const store = new ReviewStore({ projectRoot: root, resultsPath: path.join(results, 'results.json'), runId: 'run-1', failures });
  await store.init();
  return store;
}

beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'pwur-app-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('GET /api/state', () => {
  it('returns failures, summary and the first unreviewed key', async () => {
    const app = createApp({ store: await buildStore() });
    const res = await request(app).get('/api/state').expect(200);
    expect(res.body.failures).toHaveLength(2);
    expect(res.body.summary).toMatchObject({ reviewed: 0, total: 2, complete: false });
    expect(res.body.nextUnreviewed).toBe('hero-chromium-darwin.png');
    expect(res.body.failures[0].decision).toBeNull();
  });
});

describe('GET /api/image/:key/:kind', () => {
  it('streams the expected/actual/diff PNGs', async () => {
    const app = createApp({ store: await buildStore() });
    for (const kind of ['expected', 'actual', 'diff']) {
      const res = await request(app).get(`/api/image/hero-chromium-darwin.png/${kind}`).expect(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });

  it('400s on an invalid kind and 404s on unknown key', async () => {
    const app = createApp({ store: await buildStore() });
    await request(app).get('/api/image/hero-chromium-darwin.png/bogus').expect(400);
    await request(app).get('/api/image/nope.png/expected').expect(404);
  });
});

describe('POST /api/decision', () => {
  it('approve copies actual over baseline, records "updated", advances next', async () => {
    const store = await buildStore();
    const app = createApp({ store });
    const hero = store.byKey.get('hero-chromium-darwin.png');
    const actualBytes = await readFile(hero.images.actual);

    const res = await request(app).post('/api/decision')
      .send({ key: 'hero-chromium-darwin.png', decision: 'updated' }).expect(200);

    expect(await readFile(hero.images.expected)).toEqual(actualBytes); // baseline updated
    expect(res.body.failures[0].decision).toBe('updated');
    expect(res.body.summary).toMatchObject({ updated: 1, reviewed: 1 });
    expect(res.body.nextUnreviewed).toBe('footer-chromium-darwin.png');
    // Session file persisted.
    const session = JSON.parse(await readFile(path.join(root, SESSION_FILE), 'utf8'));
    expect(session.decisions['hero-chromium-darwin.png']).toBe('updated');
  });

  it('keep writes nothing to disk and records "kept"', async () => {
    const store = await buildStore();
    const app = createApp({ store });
    const hero = store.byKey.get('hero-chromium-darwin.png');
    const before = await readFile(hero.images.expected);

    const res = await request(app).post('/api/decision')
      .send({ key: 'hero-chromium-darwin.png', decision: 'kept' }).expect(200);

    expect(await readFile(hero.images.expected)).toEqual(before); // unchanged
    expect(res.body.summary).toMatchObject({ kept: 1, updated: 0 });
  });

  it('keep after approve restores the original baseline (in-session undo)', async () => {
    const store = await buildStore();
    const app = createApp({ store });
    const hero = store.byKey.get('hero-chromium-darwin.png');
    const original = await readFile(hero.images.expected);

    await request(app).post('/api/decision').send({ key: 'hero-chromium-darwin.png', decision: 'updated' }).expect(200);
    await request(app).post('/api/decision').send({ key: 'hero-chromium-darwin.png', decision: 'kept' }).expect(200);

    expect(await readFile(hero.images.expected)).toEqual(original); // restored
  });

  it('rejects unknown decisions and unknown keys', async () => {
    const app = createApp({ store: await buildStore() });
    await request(app).post('/api/decision').send({ key: 'hero-chromium-darwin.png', decision: 'maybe' }).expect(400);
    await request(app).post('/api/decision').send({ key: 'ghost.png', decision: 'updated' }).expect(404);
  });
});

describe('POST /api/import', () => {
  it('validates matching dimensions, confirms, writes baseline + provenance, records "imported"', async () => {
    const store = await buildStore();
    const app = createApp({ store });
    const hero = store.byKey.get('hero-chromium-darwin.png');
    const imported = await png(100, 80, { r: 12, g: 34, b: 56 });

    const v = await request(app)
      .post('/api/import/hero-chromium-darwin.png/validate?filename=design.png')
      .set('Content-Type', 'application/octet-stream')
      .send(imported).expect(200);
    expect(v.body.ok).toBe(true);

    const c = await request(app).post('/api/import/hero-chromium-darwin.png/confirm').expect(200);
    expect(c.body.summary).toMatchObject({ imported: 1 });

    expect(await readFile(hero.images.expected)).toEqual(imported); // baseline is the imported file
    const prov = JSON.parse(await readFile(path.join(root, PROVENANCE_FILE), 'utf8'));
    expect(prov['hero-chromium-darwin.png']).toMatchObject({ source: 'external', originalFilename: 'design.png' });
  });

  it('reports a dimension mismatch and does not stage a confirm', async () => {
    const store = await buildStore();
    const app = createApp({ store });
    const hero = store.byKey.get('hero-chromium-darwin.png');
    const original = await readFile(hero.images.expected);
    const wrong = await png(100, 999, { r: 1, g: 1, b: 1 });

    const v = await request(app)
      .post('/api/import/hero-chromium-darwin.png/validate?filename=wrong.png')
      .set('Content-Type', 'application/octet-stream')
      .send(wrong).expect(200);
    expect(v.body.ok).toBe(false);
    expect(v.body.source).toEqual({ width: 100, height: 999 });

    // Confirm without a valid pending import -> 409, baseline untouched.
    await request(app).post('/api/import/hero-chromium-darwin.png/confirm').expect(409);
    expect(await readFile(hero.images.expected)).toEqual(original);
    expect(existsSync(path.join(root, PROVENANCE_FILE))).toBe(false);
  });
});

describe('session completion', () => {
  it('marks complete once every failure is decided', async () => {
    const store = await buildStore();
    const app = createApp({ store });
    await request(app).post('/api/decision').send({ key: 'hero-chromium-darwin.png', decision: 'updated' });
    const res = await request(app).post('/api/decision').send({ key: 'footer-chromium-darwin.png', decision: 'kept' });
    expect(res.body.summary).toMatchObject({ updated: 1, kept: 1, reviewed: 2, total: 2, complete: true });
    expect(res.body.nextUnreviewed).toBeNull();
  });
});
