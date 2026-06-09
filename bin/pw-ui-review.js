#!/usr/bin/env node
// pw-ui-review CLI entry point.
//
// Thin adapter: parse args -> resolve paths -> validate -> (clean | start
// server + open browser). All logic lives in src/core and src/server.

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import open from 'open';

import { resolvePaths } from '../src/core/paths.js';
import { runValidation } from '../src/core/validation.js';
import { cleanSidecars } from '../src/core/fileops.js';
import { readStepsSidecar, attachSteps } from '../src/core/steps.js';
import { startServer } from '../src/server/serve.js';
import { renderValidation } from '../src/cli/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const distDir = path.join(here, '..', 'dist');

const HELP = `pw-ui-review v${pkg.version}
Review Playwright visual snapshot test failures in a local web UI.

Usage:
  pw-ui-review [options]

Options:
  --results <path>     Path to Playwright JSON reporter output
                       (default: ./test-results/results.json, then ./demo/...)
  --snapshots <path>   Root directory for snapshot baselines (default: auto)
  --port <number>      Port for the local web server (default: 3456)
  --clean              Remove tool sidecar files from this project and exit
  -h, --help           Show this help
`;

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        results: { type: 'string' },
        snapshots: { type: 'string' },
        port: { type: 'string' },
        clean: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    });
  } catch (err) {
    console.error(err.message);
    console.error('\n' + HELP);
    process.exit(2);
  }

  const opts = parsed.values;
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  const cwd = process.cwd();

  if (opts.clean) {
    await runClean(cwd);
    return;
  }

  const resolved = resolvePaths(opts, { cwd });
  const outcome = await runValidation(
    { resultsPath: resolved.resultsPath, snapshotsPath: resolved.snapshotsPath, port: resolved.port },
    { cwd }
  );

  console.log(renderValidation(outcome, { version: pkg.version }));

  if (!outcome.shouldStartServer) {
    process.exit(outcome.exitCode);
  }

  const failures = outcome.parsed.failures;
  // Merge step context from the reporter sidecar (if present) onto failures
  // whose results.json carried no steps.
  attachSteps(failures, await readStepsSidecar(outcome.resolved.stepsPath));

  const { server, url } = await startServer({
    resultsPath: resolved.resultsPath,
    runId: outcome.parsed.runId,
    failures,
    stale: outcome.stale,
    projectRoot: cwd,
    port: resolved.port,
    distDir: existsSync(distDir) ? distDir : undefined,
  });

  if (!existsSync(distDir)) {
    console.log('\nNote: UI bundle not found (dist/). Run `npm run build` to build the UI.');
    console.log('The API server is running and can be exercised directly.');
  }

  try { await open(url); } catch { /* headless / no browser — fine */ }

  console.log(`\npw-ui-review is running at ${url}`);
  console.log('Press Ctrl+C to stop.');

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runClean(cwd) {
  // Inspect first so we can prompt before removing the committable provenance.
  const peek = await cleanSidecars(cwd, { removeProvenance: false });
  let removeProvenance = false;
  if (peek.provenanceExists) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(
      '.playwright-baseline-provenance.json may be committed to your repo. Remove it too? [y/N] '
    )).trim().toLowerCase();
    rl.close();
    removeProvenance = answer === 'y' || answer === 'yes';
    if (removeProvenance) await cleanSidecars(cwd, { removeProvenance: true });
  }
  const removed = [...peek.removed, ...(removeProvenance ? ['.playwright-baseline-provenance.json'] : [])];
  if (removed.length === 0) {
    console.log('No tool sidecar files found in this project.');
  } else {
    console.log('Removed:');
    for (const f of removed) console.log(`  ${f}`);
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
