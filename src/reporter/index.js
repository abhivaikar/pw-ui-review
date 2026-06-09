// pw-ui-review Playwright reporter.
//
// Add it alongside your existing reporters:
//
//   reporter: [
//     ['json', { outputFile: 'test-results/results.json' }],
//     ['pw-ui-review/reporter'],
//   ],
//
// It captures the step sequence (which current Playwright versions omit from the
// JSON reporter output) and writes a sidecar file that pw-ui-review reads to
// render the test-contextual sequence view. It records ONLY what the tool needs
// — step title, category, duration, and error — and only for failing tests.
//
// Options:
//   outputFile  Path of the sidecar to write.
//               Default: <rootDir>/test-results/pw-ui-review-steps.json

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  STEPS_SIDECAR_FILENAME,
  STEPS_SIDECAR_VERSION,
  computeTestKey,
} from '../core/steps.js';

export default class PwUiReviewReporter {
  constructor(options = {}) {
    this._options = options;
    this._rootDir = process.cwd();
    this._outputFile = null;
    this._byResult = new Map(); // result -> { steps: [], nodes: Map<step,node> }
    this._tests = []; // [{ meta, steps }]
  }

  onBegin(config) {
    this._rootDir = config?.rootDir ?? process.cwd();
    // Write the sidecar next to where the JSON reporter writes results.json.
    // The JSON reporter resolves its outputFile relative to the config
    // directory (dirname of the config file), NOT config.rootDir — which
    // Playwright sets to the common test directory (e.g. ./e2e). Mirror that so
    // results.json and the sidecar end up in the same test-results/ folder.
    const base = config?.configFile ? path.dirname(config.configFile) : this._rootDir;
    this._outputFile = this._options.outputFile
      ? path.resolve(base, this._options.outputFile)
      : path.join(base, 'test-results', STEPS_SIDECAR_FILENAME);
  }

  onStepBegin(test, result, step) {
    const rec = this._rec(result);
    const node = { title: step.title, category: step.category, steps: [] };
    const parentNode = step.parentStep ? rec.nodes.get(step.parentStep) : null;
    (parentNode ? parentNode.steps : rec.steps).push(node);
    rec.nodes.set(step, node);
  }

  onStepEnd(test, result, step) {
    const rec = this._byResult.get(result);
    const node = rec?.nodes.get(step);
    if (!node) return;
    if (typeof step.duration === 'number') node.duration = step.duration;
    if (step.error) node.error = { message: String(step.error.message ?? step.error) };
  }

  onTestEnd(test, result) {
    // Only retain steps for failing attempts — that's all the tool reviews.
    if (!isFailed(result.status)) {
      this._byResult.delete(result);
      return;
    }
    const rec = this._rec(result);
    const meta = {
      projectName: projectNameOf(test),
      file: relFile(this._rootDir, test.location?.file),
      line: test.location?.line ?? null,
      column: test.location?.column ?? null,
      title: test.title,
    };
    // De-dupe by key, keeping the latest (final) failing attempt.
    const key = computeTestKey(meta);
    this._tests = this._tests.filter((t) => computeTestKey(t.meta) !== key);
    this._tests.push({ meta, steps: stripInternal(rec.steps) });
    this._byResult.delete(result);
  }

  onEnd() {
    if (!this._outputFile) return;
    const payload = {
      pwUiReviewSteps: STEPS_SIDECAR_VERSION,
      createdAt: new Date().toISOString(),
      tests: this._tests,
    };
    try {
      mkdirSync(path.dirname(this._outputFile), { recursive: true });
      writeFileSync(this._outputFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    } catch (err) {
      // Never fail the test run because of the sidecar.
      // eslint-disable-next-line no-console
      console.error(`[pw-ui-review] could not write steps sidecar: ${err.message}`);
    }
  }

  // Quiet reporter — produces no terminal output of its own.
  printsToStdio() { return false; }

  _rec(result) {
    let rec = this._byResult.get(result);
    if (!rec) { rec = { steps: [], nodes: new Map() }; this._byResult.set(result, rec); }
    return rec;
  }
}

function isFailed(status) {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

function relFile(rootDir, file) {
  if (!file) return null;
  const rel = path.relative(rootDir, file);
  return rel.startsWith('..') ? file : rel;
}

// Find the enclosing project suite's name (robust across Playwright versions).
function projectNameOf(test) {
  let s = test.parent;
  while (s) {
    if (typeof s.project === 'function') {
      const p = s.project();
      if (p?.name) return p.name;
    }
    s = s.parent;
  }
  // Fallback: titlePath() is ['', projectName, file, ...describe, title].
  const tp = typeof test.titlePath === 'function' ? test.titlePath() : [];
  return tp.length > 1 ? tp[1] : '';
}

// Drop any transient fields, keeping the serializable node shape.
function stripInternal(nodes) {
  return nodes.map((n) => ({
    title: n.title,
    category: n.category,
    ...(typeof n.duration === 'number' ? { duration: n.duration } : {}),
    ...(n.error ? { error: n.error } : {}),
    ...(n.steps?.length ? { steps: stripInternal(n.steps) } : {}),
  }));
}
