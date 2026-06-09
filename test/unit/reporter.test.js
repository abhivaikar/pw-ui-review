import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Reporter from '../../src/reporter/index.js';
import { computeTestKey } from '../../src/core/steps.js';

let root;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'pwur-rep-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

// Minimal fakes mimicking Playwright's reporter objects.
function fakeTest({ file, line = 5, column = 3, title = 'hero', project = 'chromium' }) {
  const projectSuite = { project: () => ({ name: project }), parent: null };
  const fileSuite = { project: () => undefined, parent: projectSuite };
  return { title, location: { file, line, column }, parent: fileSuite, titlePath: () => ['', project, file, title] };
}
const step = (title, category, extra = {}) => ({ title, category, parentStep: undefined, duration: 0, ...extra });

async function readSidecar() {
  const p = path.join(root, 'test-results', 'pw-ui-review-steps.json');
  expect(existsSync(p)).toBe(true);
  return JSON.parse(await readFile(p, 'utf8'));
}

describe('PwUiReviewReporter', () => {
  it('captures steps for a failing test and writes the sidecar keyed by test', async () => {
    const r = new Reporter();
    r.onBegin({ rootDir: root });

    const test = fakeTest({ file: path.join(root, 'e2e/home.spec.ts') });
    const result = { status: 'failed' };

    const goto = step('page.goto(/)', 'pw:api');
    r.onStepBegin(test, result, goto);
    goto.duration = 412;
    r.onStepEnd(test, result, goto);

    const expectStep = step('expect(page).toHaveScreenshot(hero.png)', 'expect');
    r.onStepBegin(test, result, expectStep);
    expectStep.duration = 900;
    expectStep.error = { message: 'Screenshot comparison failed' };
    r.onStepEnd(test, result, expectStep);

    r.onTestEnd(test, result);
    await r.onEnd();

    const data = await readSidecar();
    expect(data.pwUiReviewSteps).toBe(1);
    expect(data.tests).toHaveLength(1);
    const t = data.tests[0];
    expect(t.meta).toMatchObject({ projectName: 'chromium', file: 'e2e/home.spec.ts', line: 5, column: 3, title: 'hero' });
    expect(computeTestKey(t.meta)).toBeTruthy();
    expect(t.steps.map((s) => s.title)).toEqual(['page.goto(/)', 'expect(page).toHaveScreenshot(hero.png)']);
    expect(t.steps[0].duration).toBe(412);
    expect(t.steps[1].error.message).toMatch(/Screenshot comparison/);
  });

  it('records nothing for passing tests', async () => {
    const r = new Reporter();
    r.onBegin({ rootDir: root });
    const test = fakeTest({ file: path.join(root, 'e2e/ok.spec.ts') });
    const result = { status: 'passed' };
    r.onStepBegin(test, result, step('page.goto(/)', 'pw:api'));
    r.onTestEnd(test, result);
    await r.onEnd();
    const data = await readSidecar();
    expect(data.tests).toEqual([]);
  });

  it('nests sub-steps under their parent', async () => {
    const r = new Reporter();
    r.onBegin({ rootDir: root });
    const test = fakeTest({ file: path.join(root, 'e2e/n.spec.ts') });
    const result = { status: 'failed' };
    const parent = step('expect.toPass', 'expect');
    r.onStepBegin(test, result, parent);
    const child = { ...step('attempt', 'pw:api'), parentStep: parent };
    r.onStepBegin(test, result, child);
    r.onStepEnd(test, result, child);
    r.onStepEnd(test, result, parent);
    r.onTestEnd(test, result);
    await r.onEnd();
    const data = await readSidecar();
    expect(data.tests[0].steps[0].steps[0].title).toBe('attempt');
  });

  it('honors a custom outputFile option', async () => {
    const r = new Reporter({ outputFile: 'custom/steps.json' });
    r.onBegin({ rootDir: root });
    r.onTestEnd(fakeTest({ file: path.join(root, 'e2e/a.spec.ts') }), { status: 'failed' });
    await r.onEnd();
    expect(existsSync(path.join(root, 'custom', 'steps.json'))).toBe(true);
  });
});
