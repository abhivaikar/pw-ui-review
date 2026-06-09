// Express app — a thin HTTP adapter over ReviewStore. No business logic lives
// here beyond request/response shaping and serving the built UI.

import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { stageUpload } from './io.js';
import { DECISIONS } from '../core/fileops.js';

const IMAGE_KINDS = new Set(['expected', 'actual', 'diff']);

/**
 * @param {object} opts
 * @param {import('./store.js').ReviewStore} opts.store
 * @param {string} [opts.distDir] - built UI directory to serve (optional in tests)
 */
export function createApp({ store, distDir } = {}) {
  const app = express();
  app.use(express.json());

  // ── State ──────────────────────────────────────────────────────────────────
  app.get('/api/state', (_req, res) => {
    res.json(store.getState());
  });

  // ── Images ───────────────────────────────────────────────────────────────
  app.get('/api/image/:key/:kind', (req, res) => {
    const { key, kind } = req.params;
    if (!IMAGE_KINDS.has(kind)) return res.status(400).json({ error: `Invalid image kind: ${kind}` });
    let failure;
    try { failure = store.require(key); } catch { return res.status(404).json({ error: 'Unknown failure' }); }
    const filePath = failure.images[kind];
    if (!filePath || !existsSync(filePath)) return res.status(404).json({ error: `No ${kind} image available` });
    res.type(path.extname(filePath) || '.png');
    res.setHeader('Cache-Control', 'no-store'); // baselines change during a session
    res.sendFile(filePath);
  });

  // ── Decisions: approve / keep ──────────────────────────────────────────────
  app.post('/api/decision', async (req, res) => {
    const { key, decision } = req.body ?? {};
    try {
      if (decision === DECISIONS.UPDATED) {
        return res.json(await store.approve(key));
      }
      if (decision === DECISIONS.KEPT) {
        return res.json(await store.keep(key));
      }
      return res.status(400).json({ error: `Unsupported decision: ${decision}` });
    } catch (err) {
      return res.status(errStatus(err)).json({ error: err.message });
    }
  });

  // ── External import ─────────────────────────────────────────────────────────
  // Raw PNG/JPEG bytes in the body; filename passed as a query param.
  app.post('/api/import/:key/validate',
    express.raw({ type: () => true, limit: '64mb' }),
    async (req, res) => {
      const { key } = req.params;
      const filename = typeof req.query.filename === 'string' ? req.query.filename : 'import.png';
      try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json({ error: 'Empty upload.' });
        }
        const tmpPath = await stageUpload(req.body, filename);
        const result = await store.importValidate(key, tmpPath, filename);
        return res.json(result);
      } catch (err) {
        return res.status(errStatus(err)).json({ error: err.message });
      }
    });

  app.post('/api/import/:key/confirm', async (req, res) => {
    try {
      return res.json(await store.importConfirm(req.params.key));
    } catch (err) {
      return res.status(errStatus(err)).json({ error: err.message });
    }
  });

  // ── Static UI ──────────────────────────────────────────────────────────────
  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback for any non-API GET.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

function errStatus(err) {
  if (err.code === 'UNKNOWN_KEY') return 404;
  if (err.code === 'NO_PENDING_IMPORT') return 409;
  if (/mismatch/i.test(err.message)) return 422;
  return 500;
}
