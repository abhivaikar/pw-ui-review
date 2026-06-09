import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runValidation, FAIL, WARN, PASS, INFO } from '../../src/core/validation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '..', 'fixtures', 'sample-results.json');

let sampleReport;
beforeAll(async () => {
  sampleReport = JSON.parse(await readFile(fixturePath, 'utf8'));
});

const CWD = '/Users/engineer/my-app';
const RESULTS = path.join(CWD, 'test-results', 'results.json');

// All image + dir paths referenced by the sample fixture, so a "fully healthy"
// run can be simulated by making every one of these exist.
function healthyPaths(report) {
  const set = new Set([
    RESULTS,
    path.join(CWD, 'playwright.config.ts'),
  ]);
  for (const suite of report.suites) {
    for (const inner of suite.suites) {
      for (const spec of inner.specs) {
        for (const r of spec.tests[0].results) {
          for (const a of r.attachments) {
            if (a.name === 'trace') continue;
            set.add(a.path);
            set.add(path.dirname(a.path));
          }
        }
      }
    }
  }
  return set;
}

function makeDeps(report, overrides = {}) {
  const present = overrides.present ?? healthyPaths(report);
  return {
    cwd: CWD,
    nodeVersionMajor: () => overrides.node ?? 22,
    exists: overrides.exists ?? ((p) => present.has(p)),
    statMtime: overrides.statMtime ?? (() => new Date(Date.now() - 3 * 60 * 1000)), // 3 min old
    now: () => Date.now(),
    readResults: async () => report,
    portAvailable: async () => overrides.portFree ?? true,
    ...(overrides.depOverrides ?? {}),
  };
}

const input = { resultsPath: RESULTS, snapshotsPath: path.join(CWD, 'e2e'), port: 3456 };
const byId = (out, id) => out.results.find((r) => r.id === id);

describe('runValidation — happy path', () => {
  it('passes every check and starts the server', async () => {
    const out = await runValidation(input, makeDeps(sampleReport));
    expect(out.ok).toBe(true);
    expect(out.shouldStartServer).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.parsed.failures).toHaveLength(3);
    expect(byId(out, 'failures').label).toContain('3 failed visual assertions');
    expect(out.results.every((r) => r.status === PASS)).toBe(true);
  });
});

describe('runValidation — Check 1 Node version', () => {
  it('fails hard on Node < 18 and runs no further checks', async () => {
    const out = await runValidation(input, makeDeps(sampleReport, { node: 16 }));
    expect(out.ok).toBe(false);
    expect(out.exitCode).toBe(1);
    expect(out.results).toHaveLength(1);
    expect(byId(out, 'node').status).toBe(FAIL);
  });
});

describe('runValidation — Check 2 Playwright project', () => {
  it('fails when neither a config nor results exist', async () => {
    const out = await runValidation(input, makeDeps(sampleReport, { present: new Set() }));
    expect(byId(out, 'project').status).toBe(FAIL);
    expect(out.ok).toBe(false);
  });

  it('passes on results presence even without a config (demo fallback case)', async () => {
    const present = healthyPaths(sampleReport);
    present.delete(path.join(CWD, 'playwright.config.ts'));
    const out = await runValidation(input, makeDeps(sampleReport, { present }));
    expect(byId(out, 'project').status).toBe(PASS);
  });
});

describe('runValidation — Check 3 results JSON', () => {
  it('fails with reporter guidance when results are missing but a config exists', async () => {
    const present = new Set([path.join(CWD, 'playwright.config.ts')]);
    const out = await runValidation(input, makeDeps(sampleReport, { present }));
    const r = byId(out, 'results');
    expect(r.status).toBe(FAIL);
    expect(r.lines.join('\n')).toContain("reporter: [['json'");
  });
});

describe('runValidation — Check 4 recency', () => {
  it('warns (non-blocking) when results are older than 24h', async () => {
    const out = await runValidation(input, makeDeps(sampleReport, {
      statMtime: () => new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    }));
    expect(byId(out, 'recency').status).toBe(WARN);
    expect(out.ok).toBe(true); // non-blocking
    expect(out.stale.isStale).toBe(true);
  });

  it('does not emit a recency verdict for a fresh run', async () => {
    const out = await runValidation(input, makeDeps(sampleReport));
    expect(byId(out, 'recency')).toBeUndefined();
    expect(out.stale).toBeNull();
  });
});

describe('runValidation — Check 5 at least one failure', () => {
  it('exits cleanly (info, no server) when there are no visual failures', async () => {
    const passing = { config: sampleReport.config, stats: sampleReport.stats, suites: [] };
    const out = await runValidation(input, makeDeps(passing));
    expect(byId(out, 'failures').status).toBe(INFO);
    expect(out.nothingToReview).toBe(true);
    expect(out.shouldStartServer).toBe(false);
    expect(out.exitCode).toBe(0); // clean exit, not an error
  });
});

describe('runValidation — Check 6 snapshot directories', () => {
  it('fails when a snapshot directory is missing', async () => {
    const present = healthyPaths(sampleReport);
    // Remove the checkout snapshots dir.
    const dir = path.join(CWD, 'e2e', 'checkout.spec.ts-snapshots');
    present.delete(dir);
    const out = await runValidation(input, makeDeps(sampleReport, { present }));
    expect(byId(out, 'snapshot-dirs').status).toBe(FAIL);
  });
});

describe('runValidation — Check 7 baseline PNG', () => {
  it('warns (non-blocking) and marks hasBaseline=false when a baseline is missing', async () => {
    const present = healthyPaths(sampleReport);
    const baseline = path.join(CWD, 'e2e', 'profile.spec.ts-snapshots', 'profile-header-chromium-darwin.png');
    present.delete(baseline);
    const out = await runValidation(input, makeDeps(sampleReport, { present }));
    expect(byId(out, 'baseline').status).toBe(WARN);
    expect(out.ok).toBe(true);
    const noBaseline = out.parsed.failures.find((f) => f.hasBaseline === false);
    expect(noBaseline.key).toBe('profile-header-chromium-darwin.png');
  });
});

describe('runValidation — Check 8 actual/diff', () => {
  it('fails hard when an actual screenshot is missing', async () => {
    const present = healthyPaths(sampleReport);
    const actual = path.join(CWD, 'test-results', 'checkout-spec-ts-Checkout-flow-form-filled-state-matches-baseline-chromium', 'actual.png');
    present.delete(actual);
    const out = await runValidation(input, makeDeps(sampleReport, { present }));
    expect(byId(out, 'actual').status).toBe(FAIL);
    expect(out.ok).toBe(false);
  });

  it('fails when a diff is missing for a baselined failure', async () => {
    const present = healthyPaths(sampleReport);
    const diff = path.join(CWD, 'test-results', 'checkout-spec-ts-Checkout-flow-form-filled-state-matches-baseline-chromium', 'diff.png');
    present.delete(diff);
    const out = await runValidation(input, makeDeps(sampleReport, { present }));
    expect(byId(out, 'diff').status).toBe(FAIL);
  });
});

describe('runValidation — step context', () => {
  // A failing report whose results carry NO steps (real Playwright shape).
  const noStepsReport = {
    config: { rootDir: CWD },
    stats: { startTime: 't' },
    suites: [
      {
        file: 'e2e/x.spec.ts',
        specs: [
          {
            title: 'hero', line: 5, column: 3,
            tests: [
              {
                projectName: 'chromium',
                results: [
                  {
                    status: 'failed',
                    error: { message: 'toHaveScreenshot(expected) failed\n  10 pixels (ratio 0.01 of all image pixels) are different.' },
                    attachments: [
                      { name: 'hero-expected.png', contentType: 'image/png', path: path.join(CWD, 'snapshots/x.spec.ts/hero-chromium-darwin.png') },
                      { name: 'hero-actual.png', contentType: 'image/png', path: path.join(CWD, 'test-results/x/hero-actual.png') },
                      { name: 'hero-diff.png', contentType: 'image/png', path: path.join(CWD, 'test-results/x/hero-diff.png') },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const presentFor = (withSidecar) => {
    const set = new Set([
      RESULTS, path.join(CWD, 'playwright.config.ts'),
      path.join(CWD, 'snapshots/x.spec.ts/hero-chromium-darwin.png'), path.join(CWD, 'snapshots/x.spec.ts'),
      path.join(CWD, 'test-results/x/hero-actual.png'),
      path.join(CWD, 'test-results/x/hero-diff.png'),
    ]);
    if (withSidecar) set.add(path.join(CWD, 'test-results', 'pw-ui-review-steps.json'));
    return set;
  };

  it('warns (non-blocking) when results have no steps and no sidecar exists', async () => {
    const out = await runValidation(input, makeDeps(noStepsReport, { present: presentFor(false) }));
    expect(byId(out, 'steps').status).toBe(WARN);
    expect(byId(out, 'steps').lines.join('\n')).toContain("['pw-ui-review/reporter']");
    expect(out.ok).toBe(true);
  });

  it('passes when the reporter sidecar is present', async () => {
    const out = await runValidation(input, makeDeps(noStepsReport, { present: presentFor(true) }));
    expect(byId(out, 'steps').status).toBe(PASS);
  });

  it('passes when results.json already carries steps (sample fixture)', async () => {
    const out = await runValidation(input, makeDeps(sampleReport));
    expect(byId(out, 'steps').status).toBe(PASS);
  });

  it('exposes the steps sidecar path in resolved', async () => {
    const out = await runValidation(input, makeDeps(sampleReport));
    expect(out.resolved.stepsPath).toBe(path.join(CWD, 'test-results', 'pw-ui-review-steps.json'));
  });
});

describe('runValidation — port', () => {
  it('fails when the port is already in use', async () => {
    const out = await runValidation(input, makeDeps(sampleReport, { portFree: false }));
    expect(byId(out, 'port').status).toBe(FAIL);
    expect(out.ok).toBe(false);
    expect(out.exitCode).toBe(1);
  });
});
