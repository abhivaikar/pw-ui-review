// In-memory review store — holds session state for one run and orchestrates the
// core file operations. The Express app is a thin adapter over this; unit tests
// can drive it directly without HTTP. All disk mutations go through fileops, so
// the §10.3 ownership guarantees hold here too.

import {
  loadSession, recordDecision, loadProvenance,
  approveBaseline, restoreBaseline,
  validateImport, confirmImport, DECISIONS,
} from '../core/fileops.js';

export class ReviewStore {
  constructor({ projectRoot, resultsPath, runId, failures, stale = null }) {
    this.projectRoot = projectRoot;
    this.resultsPath = resultsPath;
    this.runId = runId;
    this.failures = failures;
    this.stale = stale;
    this.byKey = new Map(failures.map((f) => [f.key, f]));
    // Per-key original baseline bytes, captured on first approve, kept for the
    // whole session so an approve can be undone (and re-done) at any time.
    this.backups = new Map();
    // Pending validated imports awaiting confirm: key -> { path, filename }.
    this.pendingImports = new Map();
    this.session = null;
    this.provenance = {};
  }

  async init() {
    this.session = await loadSession(this.projectRoot, {
      runId: this.runId,
      resultsFile: this.resultsPath,
      keys: this.failures.map((f) => f.key),
    });
    this.provenance = await loadProvenance(this.projectRoot);
    return this;
  }

  require(key) {
    const f = this.byKey.get(key);
    if (!f) {
      const err = new Error(`Unknown failure key: ${key}`);
      err.code = 'UNKNOWN_KEY';
      throw err;
    }
    return f;
  }

  // ── decisions ─────────────────────────────────────────────────────────────

  async approve(key) {
    const f = this.require(key);
    // Capture the true original exactly once per session.
    if (!this.backups.has(key)) {
      const { backup } = await approveBaseline({ expectedPath: f.images.expected, actualPath: f.images.actual });
      this.backups.set(key, backup);
    } else {
      await approveBaseline({ expectedPath: f.images.expected, actualPath: f.images.actual });
    }
    f.hasBaseline = true;
    await this._setDecision(key, DECISIONS.UPDATED);
    return this.getState();
  }

  async keep(key) {
    const f = this.require(key);
    // If this key was previously approved/imported in-session, undo the write
    // back to the captured original ("Keep current baseline" as undo, §9.1).
    if (this.backups.has(key)) {
      await restoreBaseline({ expectedPath: f.images.expected, backup: this.backups.get(key) });
      f.hasBaseline = this.backups.get(key) != null;
    }
    await this._setDecision(key, DECISIONS.KEPT);
    return this.getState();
  }

  async importValidate(key, tmpPath, filename) {
    const f = this.require(key);
    const result = await validateImport({
      sourcePath: tmpPath,
      expectedPath: f.images.expected,
      actualPath: f.images.actual,
    });
    if (result.ok) {
      this.pendingImports.set(key, { path: tmpPath, filename });
    }
    return result;
  }

  async importConfirm(key) {
    const f = this.require(key);
    const pending = this.pendingImports.get(key);
    if (!pending) {
      const err = new Error('No validated import is pending for this assertion.');
      err.code = 'NO_PENDING_IMPORT';
      throw err;
    }
    // Capture original once for undo, then write the imported file.
    if (!this.backups.has(key)) {
      const { readFileIfExists } = await import('./io.js');
      this.backups.set(key, await readFileIfExists(f.images.expected));
    }
    await confirmImport({
      projectRoot: this.projectRoot,
      key,
      sourcePath: pending.path,
      expectedPath: f.images.expected,
      actualPath: f.images.actual,
      originalFilename: pending.filename,
    });
    f.hasBaseline = true;
    this.pendingImports.delete(key);
    this.provenance = await loadProvenance(this.projectRoot);
    await this._setDecision(key, DECISIONS.IMPORTED);
    return this.getState();
  }

  async _setDecision(key, decision) {
    this.session = await recordDecision(this.projectRoot, this.session, key, decision);
  }

  // ── views ──────────────────────────────────────────────────────────────────

  clientFailure(f) {
    return {
      key: f.key,
      index: f.index,
      title: f.title,
      assertionName: f.assertionName,
      assertionCode: f.assertionCode ?? null,
      specFile: f.specFile,
      specFileName: f.specFileName,
      line: f.line,
      projectName: f.projectName,
      diffSummary: f.diffSummary,
      pixelsDifferent: f.pixelsDifferent,
      percentDifferent: f.percentDifferent,
      steps: f.steps,
      stepsAvailable: Boolean(f.stepsAvailable),
      hasBaseline: f.hasBaseline ?? Boolean(f.images.expected),
      images: {
        expected: Boolean(f.images.expected) && (f.hasBaseline ?? true),
        actual: Boolean(f.images.actual),
        diff: Boolean(f.images.diff) && (f.hasBaseline ?? true),
      },
      decision: this.session?.decisions?.[f.key] ?? null,
      provenance: this.provenance?.[f.key] ?? null,
    };
  }

  summary() {
    const d = Object.values(this.session?.decisions ?? {});
    const count = (v) => d.filter((x) => x === v).length;
    const updated = count(DECISIONS.UPDATED);
    const kept = count(DECISIONS.KEPT);
    const imported = count(DECISIONS.IMPORTED);
    const reviewed = updated + kept + imported;
    return {
      updated, kept, imported, reviewed,
      total: this.failures.length,
      complete: reviewed === this.failures.length && this.failures.length > 0,
    };
  }

  // First unreviewed failure at or after `fromIndex` (wraps), else null.
  nextUnreviewed(fromIndex = 0) {
    const n = this.failures.length;
    for (let i = 0; i < n; i++) {
      const f = this.failures[(fromIndex + i) % n];
      if ((this.session?.decisions?.[f.key] ?? null) == null) return f.key;
    }
    return null;
  }

  getState() {
    return {
      runId: this.runId,
      stale: this.stale,
      failures: this.failures.map((f) => this.clientFailure(f)),
      summary: this.summary(),
      nextUnreviewed: this.nextUnreviewed(),
    };
  }
}
