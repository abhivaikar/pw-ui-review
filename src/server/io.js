// Server I/O helpers: reading optional files and staging uploaded import
// candidates to a temp directory for validation before they are committed.

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function readFileIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return readFile(filePath);
}

/**
 * Write uploaded bytes to a fresh temp file and return its path. The caller is
 * responsible for cleanup (confirm consumes it; rejecting just leaves it for the
 * OS temp reaper).
 */
export async function stageUpload(bytes, filename = 'import.png') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pwur-import-'));
  const dest = path.join(dir, path.basename(filename) || 'import.png');
  await writeFile(dest, bytes);
  return dest;
}

export async function removeQuietly(p) {
  try { await rm(path.dirname(p), { recursive: true, force: true }); } catch { /* ignore */ }
}
