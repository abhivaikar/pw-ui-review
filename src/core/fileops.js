// File operations — the only module that writes to disk.
//
// Honors the spec Section 10.3 ownership rules:
//   - test-results/      : never written (read-only source of actual/diff)
//   - __snapshots__/     : written ONLY on explicit approve or external import
//   - playwright.config  : never touched
//
// Sidecar files (session + provenance) live at the project root. All functions
// take explicit absolute paths so they are trivial to drive from unit and the
// future ./demo integration tests.

import { readFile, writeFile, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const SESSION_FILE = '.playwright-review-session.json';
export const PROVENANCE_FILE = '.playwright-baseline-provenance.json';

/** Valid decision values stored in the session file. */
export const DECISIONS = Object.freeze({
  UNREVIEWED: null,
  UPDATED: 'updated',
  KEPT: 'kept',
  IMPORTED: 'imported',
});

// ── Session persistence ────────────────────────────────────────────────────

function sessionPath(projectRoot) {
  return path.join(projectRoot, SESSION_FILE);
}

/**
 * Load an existing session, or build a fresh one. If a session file exists and
 * its runId matches the current run, decisions are restored; otherwise a fresh
 * session is returned (the caller persists it on the next write).
 *
 * @returns {{ runId: string, resultsFile: string, decisions: Record<string,string|null> }}
 */
export async function loadSession(projectRoot, { runId, resultsFile, keys = [] }) {
  const fresh = () => ({
    runId,
    resultsFile,
    decisions: Object.fromEntries(keys.map((k) => [k, null])),
  });

  const file = sessionPath(projectRoot);
  if (!existsSync(file)) return fresh();

  try {
    const existing = JSON.parse(await readFile(file, 'utf8'));
    if (existing.runId !== runId) return fresh(); // stale — tests were re-run
    // Reconcile keys: keep known decisions, add any new keys as unreviewed.
    const decisions = Object.fromEntries(keys.map((k) => [k, existing.decisions?.[k] ?? null]));
    return { runId, resultsFile, decisions };
  } catch {
    return fresh();
  }
}

export async function saveSession(projectRoot, session) {
  await writeFile(sessionPath(projectRoot), JSON.stringify(session, null, 2) + '\n', 'utf8');
  return session;
}

/** Set one decision and persist. Validates the decision value. */
export async function recordDecision(projectRoot, session, key, decision) {
  const valid = Object.values(DECISIONS);
  if (!valid.includes(decision)) {
    throw new Error(`Invalid decision "${decision}". Expected one of: ${valid.map(String).join(', ')}`);
  }
  const next = { ...session, decisions: { ...session.decisions, [key]: decision } };
  await saveSession(projectRoot, next);
  return next;
}

// ── Approve / reject ───────────────────────────────────────────────────────

/**
 * Approve: promote the actual screenshot to the baseline.
 * Returns a backup of the previous baseline bytes (or null if none existed) so
 * the server can offer in-session undo.
 *
 * @returns {Promise<{ backup: Buffer|null }>}
 */
export async function approveBaseline({ expectedPath, actualPath }) {
  if (!expectedPath) throw new Error('Cannot approve: no baseline path is known for this assertion.');
  if (!actualPath || !existsSync(actualPath)) {
    throw new Error(`Cannot approve: actual screenshot not found at ${actualPath ?? '(none)'}`);
  }
  const backup = existsSync(expectedPath) ? await readFile(expectedPath) : null;
  await mkdir(path.dirname(expectedPath), { recursive: true });
  await copyFile(actualPath, expectedPath);
  return { backup };
}

/**
 * Undo an approve within the session: restore the previous baseline bytes, or
 * remove the file entirely if there was no baseline before.
 */
export async function restoreBaseline({ expectedPath, backup }) {
  if (backup == null) {
    if (existsSync(expectedPath)) await rm(expectedPath);
    return;
  }
  await mkdir(path.dirname(expectedPath), { recursive: true });
  await writeFile(expectedPath, backup);
}

// ── External baseline import ───────────────────────────────────────────────

/** Read PNG/JPEG dimensions via sharp. */
export async function imageDimensions(filePath) {
  const { width, height } = await sharp(filePath).metadata();
  return { width, height };
}

/**
 * Validate an import candidate against the reference dimensions (the existing
 * baseline if present, otherwise the actual screenshot).
 *
 * @returns {Promise<{ ok: boolean, source: {width,height}, reference: {width,height} }>}
 */
export async function validateImport({ sourcePath, expectedPath, actualPath }) {
  const referencePath = expectedPath && existsSync(expectedPath) ? expectedPath : actualPath;
  if (!referencePath || !existsSync(referencePath)) {
    throw new Error('Cannot validate import: no reference image (baseline or actual) available.');
  }
  const [source, reference] = await Promise.all([
    imageDimensions(sourcePath),
    imageDimensions(referencePath),
  ]);
  return {
    ok: source.width === reference.width && source.height === reference.height,
    source,
    reference,
  };
}

/**
 * Confirm an import: copy the source into the baseline location and record
 * provenance. Re-validates dimensions first so the write is never blind.
 */
export async function confirmImport({ projectRoot, key, sourcePath, expectedPath, actualPath, originalFilename, now = () => new Date() }) {
  if (!expectedPath) throw new Error('Cannot import: no baseline path is known for this assertion.');
  const check = await validateImport({ sourcePath, expectedPath, actualPath });
  if (!check.ok) {
    const err = new Error('Dimension mismatch.');
    err.dimensions = check;
    throw err;
  }
  await mkdir(path.dirname(expectedPath), { recursive: true });
  await copyFile(sourcePath, expectedPath);
  await writeProvenance(projectRoot, key, {
    source: 'external',
    importedAt: now().toISOString(),
    originalFilename: originalFilename ?? path.basename(sourcePath),
  });
  return { dimensions: check };
}

// ── Provenance ─────────────────────────────────────────────────────────────

function provenancePath(projectRoot) {
  return path.join(projectRoot, PROVENANCE_FILE);
}

export async function loadProvenance(projectRoot) {
  const file = provenancePath(projectRoot);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

export async function writeProvenance(projectRoot, key, record) {
  const all = await loadProvenance(projectRoot);
  all[key] = record;
  await writeFile(provenancePath(projectRoot), JSON.stringify(all, null, 2) + '\n', 'utf8');
  return all;
}

// ── Cleanup (--clean) ──────────────────────────────────────────────────────

/**
 * Remove the session sidecar. Provenance is removed only when explicitly
 * requested (it may be committed to the repo), and the caller is told whether
 * one existed so it can prompt.
 *
 * @returns {Promise<{ removed: string[], provenanceExists: boolean }>}
 */
export async function cleanSidecars(projectRoot, { removeProvenance = false } = {}) {
  const removed = [];
  const session = sessionPath(projectRoot);
  if (existsSync(session)) {
    await rm(session);
    removed.push(SESSION_FILE);
  }
  const provenance = provenancePath(projectRoot);
  const provenanceExists = existsSync(provenance);
  if (provenanceExists && removeProvenance) {
    await rm(provenance);
    removed.push(PROVENANCE_FILE);
  }
  return { removed, provenanceExists };
}

/** Did a path get modified? Small helper for tests/asserting no-write. */
export async function mtimeOf(p) {
  return (await stat(p)).mtimeMs;
}
