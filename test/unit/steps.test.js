import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeTestKey, relaxedTestKey, shapeSteps, attachSteps,
  readStepsSidecar, stepsSidecarPath, STEPS_SIDECAR_FILENAME,
} from '../../src/core/steps.js';

describe('computeTestKey / relaxedTestKey', () => {
  it('is stable and includes the discriminating fields', () => {
    const a = computeTestKey({ projectName: 'chromium', file: 'e2e/a.spec.ts', line: 5, column: 3, title: 't' });
    const b = computeTestKey({ projectName: 'chromium', file: 'e2e/a.spec.ts', line: 5, column: 3, title: 't' });
    expect(a).toBe(b);
    expect(a).not.toBe(computeTestKey({ projectName: 'firefox', file: 'e2e/a.spec.ts', line: 5, column: 3, title: 't' }));
  });
  it('relaxed key ignores line/column', () => {
    expect(relaxedTestKey({ projectName: 'chromium', file: 'e2e/a.spec.ts', title: 't' }))
      .toBe(relaxedTestKey({ projectName: 'chromium', file: 'e2e/a.spec.ts', title: 't' }));
  });
});

describe('shapeSteps', () => {
  it('filters hooks, numbers 1-based, and flags the failed screenshot step', () => {
    const rows = shapeSteps([
      { title: 'Before Hooks', category: 'hook', duration: 10 },
      { title: 'page.goto(/)', category: 'pw:api', duration: 412 },
      { title: 'expect(page).toHaveScreenshot(a.png)', category: 'expect', duration: 900, error: { message: 'x' } },
      { title: 'After Hooks', category: 'hook', duration: 0 },
    ]);
    expect(rows.map((r) => r.number)).toEqual([1, 2]);
    expect(rows[0].title).toBe('page.goto(/)');
    expect(rows[0].durationMs).toBe(412);
    expect(rows[1].failed).toBe(true);
  });
});

describe('attachSteps', () => {
  const sidecar = {
    tests: [
      {
        meta: { projectName: 'chromium', file: 'e2e/home.spec.ts', line: 5, column: 3, title: 'hero' },
        steps: [
          { title: 'page.goto(/)', category: 'pw:api', duration: 100 },
          { title: 'expect(page).toHaveScreenshot()', category: 'expect', duration: 200, error: { message: 'diff' } },
        ],
      },
    ],
  };

  it('merges steps onto a failure with no steps (exact key)', () => {
    const f = {
      testKey: computeTestKey({ projectName: 'chromium', file: 'e2e/home.spec.ts', line: 5, column: 3, title: 'hero' }),
      projectName: 'chromium', specFile: 'e2e/home.spec.ts', title: 'hero',
      steps: [], stepsAvailable: false,
    };
    attachSteps([f], sidecar);
    expect(f.stepsAvailable).toBe(true);
    expect(f.steps).toHaveLength(2);
    expect(f.steps[1].failed).toBe(true);
  });

  it('matches via the relaxed key when line/column differ', () => {
    const f = {
      testKey: computeTestKey({ projectName: 'chromium', file: 'e2e/home.spec.ts', line: 99, column: 9, title: 'hero' }),
      projectName: 'chromium', specFile: 'e2e/home.spec.ts', title: 'hero',
      steps: [], stepsAvailable: false,
    };
    attachSteps([f], sidecar);
    expect(f.stepsAvailable).toBe(true);
    expect(f.steps).toHaveLength(2);
  });

  it('does not overwrite steps already present from results.json', () => {
    const existing = [{ number: 1, title: 'kept', category: 'pw:api', durationMs: 1, failed: false }];
    const f = {
      testKey: computeTestKey({ projectName: 'chromium', file: 'e2e/home.spec.ts', line: 5, column: 3, title: 'hero' }),
      projectName: 'chromium', specFile: 'e2e/home.spec.ts', title: 'hero',
      steps: existing, stepsAvailable: true,
    };
    attachSteps([f], sidecar);
    expect(f.steps).toBe(existing);
  });

  it('is a no-op for a null sidecar', () => {
    const f = { steps: [], stepsAvailable: false, testKey: 'x' };
    expect(attachSteps([f], null)).toEqual([f]);
  });
});

describe('readStepsSidecar', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'pwur-steps-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('derives the sidecar path next to the results file', () => {
    expect(stepsSidecarPath('/p/test-results/results.json'))
      .toBe(path.join('/p/test-results', STEPS_SIDECAR_FILENAME));
  });

  it('returns null when the file is missing', async () => {
    expect(await readStepsSidecar(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null for malformed content', async () => {
    const p = path.join(dir, STEPS_SIDECAR_FILENAME);
    await writeFile(p, '{ not json');
    expect(await readStepsSidecar(p)).toBeNull();
  });

  it('reads a valid sidecar', async () => {
    const p = path.join(dir, STEPS_SIDECAR_FILENAME);
    await writeFile(p, JSON.stringify({ pwUiReviewSteps: 1, tests: [] }));
    const data = await readStepsSidecar(p);
    expect(data.tests).toEqual([]);
  });
});
