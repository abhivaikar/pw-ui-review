// Server bootstrap: assemble a ReviewStore + Express app and start listening.
// Separated from the CLI so it can be driven from tests or other entry points.

import { once } from 'node:events';
import { ReviewStore } from './store.js';
import { createApp } from './app.js';

/**
 * @param {object} opts
 * @param {string} opts.resultsPath
 * @param {string} opts.runId
 * @param {object[]} opts.failures - parsed failures (with hasBaseline set)
 * @param {object|null} opts.stale
 * @param {string} opts.projectRoot - where sidecar files live
 * @param {number} opts.port
 * @param {string} [opts.distDir] - built UI dir
 * @param {string} [opts.host]
 */
export async function startServer(opts) {
  const { resultsPath, runId, failures, stale = null, projectRoot, port, distDir, host = '127.0.0.1' } = opts;

  const store = new ReviewStore({ projectRoot, resultsPath, runId, failures, stale });
  await store.init();

  const app = createApp({ store, distDir });
  const server = app.listen(port, host);
  await once(server, 'listening');

  return { server, store, url: `http://localhost:${port}` };
}
