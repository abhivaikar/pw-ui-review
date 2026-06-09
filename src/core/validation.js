// Dependency validation — Checks 1-10 from spec Section 7.
//
// Produces a structured, ordered list of check verdicts plus an overall outcome.
// The CLI layer is responsible for rendering this to the terminal and choosing
// process exit codes; this module performs the logic only. All environmental
// inputs (node version, fs, clock, port probe, git probe) are injectable so
// every branch can be unit tested deterministically.

import { existsSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { readResultsFile, parseResults } from './parser.js';
import { stepsSidecarPath } from './steps.js';

const STALE_MS = 24 * 60 * 60 * 1000;

/** Status values for a single check verdict. */
export const PASS = 'pass';
export const FAIL = 'fail';
export const WARN = 'warn';
export const INFO = 'info';

/**
 * Run all validation checks in order.
 *
 * @param {object} input
 * @param {string} input.resultsPath - resolved results JSON path
 * @param {string|null} input.snapshotsPath - resolved snapshots dir (may be null)
 * @param {number} input.port
 * @param {object} [deps] - injectable environment
 * @returns {Promise<ValidationOutcome>}
 */
export async function runValidation(input, deps = {}) {
  const d = withDefaults(deps);
  const results = [];
  const push = (v) => { results.push(v); return v; };

  // Check 1 — Node.js version
  const node = d.nodeVersionMajor();
  if (node < 18) {
    push({ id: 'node', status: FAIL, label: 'Node.js version',
      lines: [`Node.js 18 or higher is required. You are running Node.js ${node}.x.`,
              'Please upgrade: https://nodejs.org'] });
    return finalize(results, input, d, { parsed: null, gitAvailable: false });
  }
  push({ id: 'node', status: PASS, label: `Node.js ${node}.x` });

  // Check 2 — Playwright project detected
  const hasConfig = d.exists(path.join(d.cwd, 'playwright.config.ts')) ||
                    d.exists(path.join(d.cwd, 'playwright.config.js'));
  const resultsExist = d.exists(input.resultsPath);
  if (!hasConfig && !resultsExist) {
    push({ id: 'project', status: FAIL, label: 'Playwright project detected',
      lines: ['No playwright.config.ts or playwright.config.js found in the current directory.',
              'Run pw-ui-review from the root of your Playwright project,',
              'or use --results and --snapshots to specify paths explicitly.'] });
    return finalize(results, input, d, { parsed: null, gitAvailable: false });
  }
  push({ id: 'project', status: PASS, label: 'Playwright project detected' });

  // Check 3 — Results JSON exists
  if (!resultsExist) {
    push({ id: 'results', status: FAIL, label: 'Test results found',
      lines: [`No test results found at ${rel(d.cwd, input.resultsPath)}.`, '',
              'Either your tests have not been run yet, or the JSON reporter',
              'is not configured. Add the following to your playwright.config.ts:', '',
              "  reporter: [['json', { outputFile: 'test-results/results.json' }]],", '',
              'Then run your Playwright tests and try again.'] });
    return finalize(results, input, d, { parsed: null, gitAvailable: false });
  }

  // Parse results once, now that we know the file exists.
  let report;
  try {
    report = await d.readResults(input.resultsPath);
  } catch (err) {
    push({ id: 'results', status: FAIL, label: 'Test results found',
      lines: [`Could not read or parse ${rel(d.cwd, input.resultsPath)}.`, String(err.message ?? err)] });
    return finalize(results, input, d, { parsed: null, gitAvailable: false });
  }
  const parsed = d.parse(report);
  const runAge = resultsAge(input.resultsPath, d);
  push({ id: 'results', status: PASS, label: `Test results found (${runAge.text})` });

  // Check 4 — Results recency (non-blocking warning; surfaced in topbar too)
  let stale = null;
  if (runAge.ms != null && runAge.ms > STALE_MS) {
    stale = { isStale: true, ageText: runAge.text, mtime: runAge.mtimeISO };
    push({ id: 'recency', status: WARN, label: 'Test results recency',
      lines: [`Test results are from ${runAge.text} (${runAge.mtimeISO}).`,
              'You may be reviewing stale results. Consider re-running your tests.'] });
  }

  // Check 5 — At least one visual failure
  const failures = parsed.failures;
  if (failures.length === 0) {
    push({ id: 'failures', status: INFO, label: 'No visual failures',
      lines: ['No failed visual snapshot assertions found in the most recent test run.',
              'Nothing to review. Run your tests and try again when snapshots fail.'] });
    return finalize(results, input, d, { parsed, gitAvailable: false, nothingToReview: true });
  }
  push({ id: 'failures', status: PASS, label: `${failures.length} failed visual assertion${failures.length === 1 ? '' : 's'} found` });

  // Check — Step context (bundled reporter). Non-blocking: the tool works
  // without it, but the test-step sequence view needs either steps already in
  // results.json or the sidecar the pw-ui-review reporter writes.
  const sidecarPath = stepsSidecarPath(input.resultsPath);
  const resultsHaveSteps = failures.some((f) => f.stepsAvailable);
  if (resultsHaveSteps || d.exists(sidecarPath)) {
    push({ id: 'steps', status: PASS, label: 'Step context available' });
  } else {
    push({ id: 'steps', status: WARN, label: 'Step context unavailable',
      lines: ['Per-step context is unavailable for this run. To enable the test-step',
              'sequence view, add the pw-ui-review reporter to playwright.config.ts:', '',
              "  reporter: [",
              "    ['json', { outputFile: 'test-results/results.json' }],",
              "    ['pw-ui-review/reporter'],",
              "  ],", '',
              'Then re-run your tests. (The tool still works; the Steps section will',
              'show a fallback until the sidecar is present.)'] });
  }

  // Check 6 — Snapshot directories accessible (derived from expected paths)
  const snapshotDirs = new Set();
  for (const f of failures) {
    if (f.images.expected) snapshotDirs.add(path.dirname(f.images.expected));
  }
  const missingDir = [...snapshotDirs].find((dir) => !d.exists(dir));
  if (missingDir) {
    push({ id: 'snapshot-dirs', status: FAIL, label: 'Snapshot directories accessible',
      lines: [`Snapshot directory not found: ${rel(d.cwd, missingDir)}`, '',
              'This directory should have been created when your tests ran.',
              'Check that your snapshotDir configuration in playwright.config.ts',
              'matches the actual location of your snapshot files.'] });
    return finalize(results, input, d, { parsed, gitAvailable: false });
  }
  push({ id: 'snapshot-dirs', status: PASS, label: 'Snapshot directories accessible' });

  // Check 7 — Baseline PNG exists per failure (missing => non-blocking "no baseline")
  const noBaseline = [];
  for (const f of failures) {
    const present = f.images.expected ? d.exists(f.images.expected) : false;
    f.hasBaseline = present;
    if (!present) noBaseline.push(f.key);
  }
  if (noBaseline.length) {
    push({ id: 'baseline', status: WARN, label: 'Baseline PNGs',
      lines: [`No baseline found for ${noBaseline.length} assertion(s):`,
              ...noBaseline.map((k) => `  ${k}`),
              'These will be shown in the UI as a "No baseline" state.'] });
  } else {
    push({ id: 'baseline', status: PASS, label: 'Baseline PNGs present' });
  }

  // Check 8 — Actual and diff screenshots exist in test-results
  for (const f of failures) {
    const missingActual = !f.images.actual || !d.exists(f.images.actual);
    if (missingActual) {
      push({ id: 'actual', status: FAIL, label: 'Actual screenshots present',
        lines: [`Actual screenshot missing for: ${f.key}`,
                `Expected to find it at: ${f.images.actual ? rel(d.cwd, f.images.actual) : '(no path reported)'}`, '',
                'The test-results/ directory may have been cleared after your test run.',
                'Re-run your Playwright tests and try again.'] });
      return finalize(results, input, d, { parsed, gitAvailable: false });
    }
  }
  // Diff is only meaningful when a baseline exists; treat missing diff for a
  // baselined failure as a hard error, but tolerate it for no-baseline cases.
  for (const f of failures) {
    if (!f.hasBaseline) continue;
    const missingDiff = !f.images.diff || !d.exists(f.images.diff);
    if (missingDiff) {
      push({ id: 'diff', status: FAIL, label: 'Diff screenshots present',
        lines: [`Diff image missing for: ${f.key}`,
                `Expected to find it at: ${f.images.diff ? rel(d.cwd, f.images.diff) : '(no path reported)'}`, '',
                'The test-results/ directory may have been cleared after your test run.',
                'Re-run your Playwright tests and try again.'] });
      return finalize(results, input, d, { parsed, gitAvailable: false });
    }
  }
  push({ id: 'screenshots', status: PASS, label: 'Actual and diff screenshots present' });

  // Check — Port availability (baseline history is out of scope for v0.1, so
  // there is no git check).
  const portFree = await d.portAvailable(input.port);
  if (!portFree) {
    push({ id: 'port', status: FAIL, label: 'Port availability',
      lines: [`Port ${input.port} is already in use.`,
              `Try a different port: pw-ui-review --port ${input.port + 1}`] });
    return finalize(results, input, d, { parsed });
  }
  push({ id: 'port', status: PASS, label: `Port ${input.port} available` });

  return finalize(results, input, d, { parsed, stale });
}

function finalize(results, input, d, extra) {
  const failed = results.some((r) => r.status === FAIL);
  const nothingToReview = Boolean(extra.nothingToReview);
  return {
    results,
    ok: !failed && !nothingToReview,
    nothingToReview,
    // exit code: 0 when ok or cleanly nothing-to-review; 1 on hard failure
    exitCode: failed ? 1 : 0,
    shouldStartServer: !failed && !nothingToReview,
    resolved: {
      resultsPath: input.resultsPath,
      snapshotsPath: input.snapshotsPath,
      stepsPath: stepsSidecarPath(input.resultsPath),
      port: input.port,
    },
    parsed: extra.parsed ?? null,
    stale: extra.stale ?? null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

function rel(cwd, p) {
  const r = path.relative(cwd, p);
  return r.startsWith('..') ? p : `./${r}`;
}

function resultsAge(resultsPath, d) {
  try {
    const mtime = d.statMtime(resultsPath);
    const ms = d.now() - mtime.getTime();
    return { ms, text: humanizeAge(ms), mtimeISO: formatLocal(mtime) };
  } catch {
    return { ms: null, text: 'unknown age', mtimeISO: 'unknown' };
  }
}

function humanizeAge(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 90) return 'run just now';
  const min = Math.round(sec / 60);
  if (min < 90) return `run ${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `run ${hr} hour${hr === 1 ? '' : 's'} ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function withDefaults(deps) {
  return {
    cwd: deps.cwd ?? process.cwd(),
    nodeVersionMajor: deps.nodeVersionMajor ?? (() => parseInt(process.versions.node.split('.')[0], 10)),
    exists: deps.exists ?? existsSync,
    statMtime: deps.statMtime ?? ((p) => statSync(p).mtime),
    now: deps.now ?? (() => Date.now()),
    readResults: deps.readResults ?? readResultsFile,
    parse: deps.parse ?? parseResults,
    portAvailable: deps.portAvailable ?? defaultPortAvailable,
  };
}

function defaultPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/** @typedef {{ results: object[], ok: boolean, nothingToReview: boolean, exitCode: number, shouldStartServer: boolean, resolved: object, parsed: object|null, stale: object|null }} ValidationOutcome */
