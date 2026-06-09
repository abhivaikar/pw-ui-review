// Results parser — pure module, no I/O beyond an optional JSON read helper.
//
// Turns Playwright's JSON reporter output into a flat list of visual-snapshot
// failures that the rest of the tool consumes. Per trace-file-note.md we never
// parse trace.zip; the trace path is captured for a future v0.2 but never read.
//
// Handles two real-world shapes of the JSON reporter:
//   - the simplified shape in docs/sample-results.json (attachments named
//     "expected"/"actual"/"diff", a populated `steps` array, "1.23%" messages)
//   - actual Playwright >=1.5x output (attachments named "<snap>-expected.png",
//     no `steps` array at all, "ratio 0.24 of all image pixels" messages)
//
// This module performs no filesystem checks: image paths are reported as-is and
// whether a baseline exists on disk is decided by the validation/fileops layers.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isScreenshotExpectStep, flattenSteps, shapeSteps, computeTestKey } from './steps.js';

export async function readResultsFile(resultsPath) {
  const raw = await readFile(resultsPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Extract the ordered list of visual-snapshot failures from reporter JSON.
 * @param {object} report - parsed Playwright JSON reporter output
 * @returns {{ runId: string|null, failures: Failure[] }}
 */
export function parseResults(report) {
  const rootDir = report?.config?.rootDir ?? null;
  const runId = report?.stats?.startTime ?? null;

  const failures = [];
  for (const suite of report?.suites ?? []) {
    collectFromSuite(suite, { rootDir, specFile: suite.file ?? null }, failures);
  }
  failures.forEach((f, i) => { f.index = i; });
  return { runId, failures };
}

function collectFromSuite(suite, ctx, out) {
  const specFile = suite.file ?? ctx.specFile;
  const nextCtx = { ...ctx, specFile };
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = pickResult(test.results);
      if (!result) continue;
      const att = classifyAttachments(result.attachments);
      if (!isVisualFailure(result, att)) continue;
      out.push(buildFailure({ spec, test, result, att, ctx: nextCtx }));
    }
  }
  for (const child of suite.suites ?? []) collectFromSuite(child, nextCtx, out);
}

function pickResult(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const failing = [...results].reverse().find((r) => isFailedStatus(r.status));
  return failing ?? results[results.length - 1];
}

function isFailedStatus(status) {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

// A visual failure = a failed result that involves a screenshot/snapshot
// comparison. Detected via screenshot attachments, an expect step, or the error
// message — robust to the JSON reporter omitting steps entirely.
function isVisualFailure(result, att) {
  if (!isFailedStatus(result.status)) return false;
  if (att.expected || att.diff) return true;
  if (flattenSteps(result.steps).some(isScreenshotExpectStep)) return true;
  const msg = stripAnsi(result.error?.message ?? '');
  return /toHaveScreenshot|toMatchSnapshot|Screenshot comparison/i.test(msg);
}

function buildFailure({ spec, test, result, att, ctx }) {
  const allSteps = flattenSteps(result.steps);
  const expectStep = allSteps.find(isScreenshotExpectStep);
  const stepsAvailable = (result.steps?.length ?? 0) > 0;

  const screenshotName = extractScreenshotName(expectStep, att.expectedName, att.expected, spec.title);
  const key = sessionKey(att.expected, screenshotName, test.projectName);
  const msg = stripAnsi(result.error?.message ?? expectStep?.error?.message ?? '');
  const diff = parseDiffSummary(msg);
  const size = diff ? null : parseSizeMismatch(msg);

  return {
    key,
    title: spec.title ?? screenshotName,
    assertionName: stripPng(screenshotName) ?? spec.title ?? key,
    /** the exact assertion line from Playwright's error code frame, if present */
    assertionCode: extractAssertionCode(result.error),
    specFile: ctx.specFile ?? spec.file ?? null,
    specFileName: ctx.specFile ? path.basename(ctx.specFile) : null,
    line: spec.line ?? null,
    column: spec.column ?? null,
    projectName: test.projectName ?? null,
    status: result.status,
    pixelsDifferent: diff?.pixels ?? null,
    percentDifferent: diff?.percent ?? null,
    diffSummary: diff ? formatDiffSummary(diff) : (size ? formatSizeMismatch(size) : null),
    sizeMismatch: size,
    /** numbered, hook-filtered step rows — empty until merged from the sidecar */
    steps: shapeSteps(result.steps),
    /** false when results.json carried no steps; the sidecar merge can flip it */
    stepsAvailable,
    /** correlation key to match steps from the reporter sidecar */
    testKey: computeTestKey({
      projectName: test.projectName,
      file: ctx.specFile ?? spec.file,
      line: spec.line,
      column: spec.column,
      title: spec.title,
    }),
    images: {
      expected: att.expected ?? null,
      actual: att.actual ?? null,
      diff: att.diff ?? null,
    },
    tracePath: att.trace ?? null, // captured for v0.2 only — never read in v0.1
    rootDir: ctx.rootDir ?? null,
  };
}

// Classify attachments into kinds, tolerating both naming conventions:
//   exact "expected"/"actual"/"diff"  (sample shape)
//   "<snapshot>-expected.png" etc.    (real Playwright shape)
function classifyAttachments(attachments) {
  const out = { expected: null, actual: null, diff: null, trace: null, expectedName: null };
  for (const a of attachments ?? []) {
    if (!a?.name) continue;
    const kind = attachmentKind(a);
    if (!kind || out[kind]) continue;
    if (kind === 'trace') { out.trace = a.path ?? null; continue; }
    if (!a.path) continue;
    out[kind] = a.path;
    if (kind === 'expected') out.expectedName = a.name;
  }
  return out;
}

function attachmentKind(a) {
  const name = a.name;
  if (name === 'trace' || a.contentType === 'application/zip') return 'trace';
  if (name === 'expected' || /-expected\.png$/i.test(name)) return 'expected';
  if (name === 'actual' || /-actual\.png$/i.test(name)) return 'actual';
  if (name === 'diff' || /-diff\.png$/i.test(name)) return 'diff';
  return null;
}

function extractScreenshotName(expectStep, expectedName, expectedPath, specTitle) {
  // 1) Name embedded in the assertion title: toHaveScreenshot(checkout.png)
  const m = expectStep?.title?.match(/toHave(?:Screenshot|Snapshot)\(\s*([^)]+?)\s*\)/) ??
            expectStep?.title?.match(/toMatchSnapshot\(\s*([^)]+?)\s*\)/);
  if (m && m[1] && m[1] !== 'expected') return m[1].trim();
  // 2) The expected attachment NAME with the -expected.png suffix stripped.
  if (expectedName && /-expected\.png$/i.test(expectedName)) {
    return expectedName.replace(/-expected\.png$/i, '');
  }
  // 3) The baseline file name.
  if (expectedPath) return path.basename(expectedPath);
  // 4) Fall back to the spec title.
  return specTitle ?? null;
}

function stripPng(name) {
  return name ? name.replace(/\.png$/i, '') : null;
}

// Session key: basename of the expected baseline path (exact, platform-unique).
// When absent (first-run "no baseline"), synthesize from screenshot name+project.
function sessionKey(expectedPath, screenshotName, projectName) {
  if (expectedPath) return path.basename(expectedPath);
  const base = stripPng(screenshotName) ?? 'unknown';
  return projectName ? `${base}-${projectName}.png` : `${base}.png`;
}

// Parse the differing-pixel summary, handling both message dialects:
//   "2340 pixels (1.23%) are different"
//   "219877 pixels (ratio 0.24 of all image pixels) are different"
function parseDiffSummary(message) {
  const percentForm = message.match(/([\d,]+)\s+pixels?\s*\(\s*([\d.]+)%\s*\)/i);
  if (percentForm) {
    return finishDiff(percentForm[1], Number(percentForm[2]));
  }
  const ratioForm = message.match(/([\d,]+)\s+pixels?\s*\(\s*ratio\s+([\d.]+)\b/i);
  if (ratioForm) {
    return finishDiff(ratioForm[1], Number(ratioForm[2]) * 100);
  }
  return null;
}

function finishDiff(pixelStr, percent) {
  const pixels = Number(pixelStr.replace(/,/g, ''));
  if (Number.isNaN(pixels) || Number.isNaN(percent)) return null;
  return { pixels, percent };
}

function formatDiffSummary({ pixels, percent }) {
  return `${pixels.toLocaleString('en-US')} pixels different (${formatPercent(percent)}%)`;
}

function formatPercent(p) {
  // Trim to at most 2 decimals, dropping trailing zeros.
  return String(Math.round(p * 100) / 100);
}

// Dimension-change failures carry no pixel count, e.g.:
//   "Expected an image 1280px by 1114px, received 1280px by 720px"
function parseSizeMismatch(message) {
  const m = message.match(/Expected an image\s+(\d+)px by (\d+)px,\s*received\s+(\d+)px by (\d+)px/i);
  if (!m) return null;
  return {
    expected: { width: Number(m[1]), height: Number(m[2]) },
    received: { width: Number(m[3]), height: Number(m[4]) },
  };
}

function formatSizeMismatch({ expected, received }) {
  return `Image size changed — received ${received.width}×${received.height}, expected ${expected.width}×${expected.height}`;
}

// Extract the exact failing assertion from Playwright's error code frame. The
// `snippet` marks the start line with ">", and the assertion may span several
// lines (e.g. a toHaveScreenshot call with an options object):
//   > 30 |     await expect(page).toHaveScreenshot('dynamic-stylepath.png', {
//        |                        ^
//     31 |       stylePath: path.join(__dirname, 'hide-dynamic.css'),
//     32 |     });
// We collect from the ">" line until brackets balance, then dedent. Returns the
// multi-line statement verbatim.
function extractAssertionCode(error) {
  const snippet = stripAnsi(error?.snippet ?? '');
  const rows = snippet.split('\n').map((l) => {
    // code-frame line: "  31 |   <code>"  (caret-only lines have no line number)
    const m = l.match(/^(>?)\s*\d+\s*\|\s?(.*)$/);
    return m ? { ptr: m[1] === '>', code: m[2] } : null;
  });
  const start = rows.findIndex((r) => r?.ptr);
  if (start === -1) return null;

  const collected = [];
  let depth = 0;
  let seenOpen = false;
  for (let i = start; i < rows.length && collected.length < 12; i++) {
    const row = rows[i];
    if (!row) continue; // skip caret-only lines
    collected.push(row.code);
    for (const ch of row.code) {
      if (ch === '(' || ch === '[' || ch === '{') { depth++; seenOpen = true; }
      else if (ch === ')' || ch === ']' || ch === '}') { depth--; }
    }
    if (seenOpen && depth <= 0) break;          // statement closed
    if (!seenOpen && /;\s*$/.test(row.code)) break; // single-line, no brackets
  }

  // Dedent by the smallest leading indentation among the collected lines.
  const indents = collected.filter((c) => c.trim()).map((c) => c.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  const text = collected.map((c) => c.slice(min)).join('\n').replace(/\s+$/, '');
  return text.trim() ? text : null;
}

// Strip ANSI color codes that Playwright embeds in error messages.
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** @typedef {ReturnType<typeof buildFailure>} Failure */
