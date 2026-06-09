# pw-ui-review

[![CI](https://github.com/abhivaikar/pw-ui-review/actions/workflows/ci.yml/badge.svg)](https://github.com/abhivaikar/pw-ui-review/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pw-ui-review.svg)](https://www.npmjs.com/package/pw-ui-review)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A local, open-source CLI that opens a web UI for reviewing **Playwright visual
snapshot test failures**. It replaces the blunt `--update-snapshots` flag with a
deliberate, per-assertion approve/reject workflow: see what changed, in what
context, and decide — before any baseline PNG is touched.

Strictly local-first. No cloud, no accounts, no third-party services. Nothing
leaves your machine.

---

## Features (v0.1)

- **Post-run review UI** — review every failed `toHaveScreenshot()` /
  `toMatchSnapshot()` assertion from your most recent run.
- **Expected / Actual / Diff** — the three images side by side, zoomable, with
  a full-screen overlay.
- **Approve / Reject** — *Update baseline* promotes the actual screenshot;
  *Keep current baseline* leaves everything untouched. In-session undo.
- **External baseline import** — bring in a PNG from outside the test run
  (e.g. a design export), with dimension validation before anything is written.
- **Session state** — your progress is saved to a local sidecar file so you can
  close and reopen without losing your place.
- **Dependency validation** — thorough startup checks with actionable messages.
- **Light & dark themes** — follows your OS `prefers-color-scheme`.

> **Test steps:** the detail view shows the action sequence (goto, click,
> screenshot, …) leading to the failed assertion. Current Playwright versions
> omit a per-step `steps` array from JSON reporter output, so pw-ui-review ships
> a tiny **custom reporter** that captures the sequence into a sidecar file. Add
> one line to your config (below). We never parse `trace.zip`.

---

## Install

```bash
npm install -g pw-ui-review
```

Global install. It does not modify your project's `package.json`,
`node_modules`, or `playwright.config.ts`.

### Prerequisite — reporters

Your `playwright.config.ts` needs two reporters: the JSON reporter (failure
metadata + screenshot attachments) and the bundled pw-ui-review reporter (the
test-step sequence):

```ts
reporter: [
  ['json', { outputFile: 'test-results/results.json' }],
  ['pw-ui-review/reporter'],   // ← captures step context into a sidecar
  // ...other reporters
],
```

The pw-ui-review reporter writes `test-results/pw-ui-review-steps.json` next to
`results.json`. It's optional — without it everything works, but the Steps
section shows a fallback instead of the action sequence. The startup checks tell
you if it's missing.

---

## Usage

Run from your Playwright project root, after a test run that produced visual
failures:

```bash
pw-ui-review
```

It validates dependencies, starts a local server, and opens your browser.

### Options

| Argument | Default | Description |
|---|---|---|
| `--results <path>` | `./test-results/results.json` | Playwright JSON reporter output |
| `--snapshots <path>` | auto | Root directory of snapshot baselines |
| `--port <number>` | `3456` | Port for the local web server |
| `--clean` | — | Remove tool sidecar files from this project and exit |
| `-h, --help` | — | Show help |

```bash
pw-ui-review \
  --results ./custom-results/results.json \
  --snapshots ./e2e/__snapshots__ \
  --port 4242
```

Stop with `Ctrl+C`. Decisions already written to disk remain.

---

## Getting started for development

This repo links the demo Playwright project
[`pw-visual-tests-demo`](https://github.com/abhivaikar/pw-visual-tests-demo) as a
git submodule at `./demo`. The submodule is the development and integration-test
fixture — we never scaffold a sample project inside this repo.

```bash
# 1. Clone pw-ui-review with the submodule
git clone --recurse-submodules https://github.com/abhivaikar/pw-ui-review

# If you already cloned without --recurse-submodules
git submodule update --init

# 2. Install pw-ui-review dependencies
npm install

# 3. Install demo project dependencies
cd demo && npm install && npx playwright install

# 4. Generate baselines in the demo project (first time only)
npx playwright test --update-snapshots

# 5. Run demo tests to produce results
npx playwright test

# 6. Run pw-ui-review against the demo results
cd .. && node bin/pw-ui-review.js \
  --results ./demo/test-results/results.json \
  --snapshots ./demo/snapshots
```

With the submodule initialised and the demo tests run, `node bin/pw-ui-review.js`
with **no arguments** also works from the repo root — the tool falls back to
`./demo/test-results/results.json` and `./demo/snapshots` automatically.

### Triggering visual failures for development

The tool only has something to display when at least one assertion fails. After
generating baselines, make any change to the demo app and run the demo tests
again **without** `--update-snapshots`. The demo also ships a variant config that
surfaces failures directly:

```bash
cd demo && npm run simulate:failures   # runs the v2 variant against v1 baselines
```

See the demo repo's README for the full explanation.

### Build the UI bundle

The CLI serves a built UI from `dist/`. During development:

```bash
npm run build      # production bundle into dist/
npm run dev        # Vite dev server with /api proxied to a running tool
```

### Tests

```bash
npm test           # full unit + component suite (Vitest)
npm run test:watch
```

The codebase is split so that all logic lives in framework-free modules under
`src/core` (parser, path resolution, validation, file operations) with the
Express server (`src/server`) and CLI (`bin/`) as thin adapters. This keeps the
core fast to unit test and ready for the `./demo`-backed integration suite.

---

## Architecture

```
bin/pw-ui-review.js     CLI entry — args, validation output, server start, --clean
src/core/               framework-free logic (pure, heavily unit tested)
  parser.js             JSON reporter -> failure model (handles both shapes)
  steps.js              step shaping + reporter-sidecar correlation/merge
  paths.js              --results/--snapshots resolution + ./demo fallback
  validation.js         startup dependency checks
  fileops.js            session, provenance, approve/restore, import (the only writer)
src/reporter/           bundled Playwright reporter ('pw-ui-review/reporter')
src/server/             Express adapter over the core
  store.js              in-memory review state for one run
  app.js                HTTP routes (state, image streaming, decisions, import)
  serve.js              bootstrap (store + app + listen)
src/ui/                 React + Vite single-page UI (light/dark)
src/cli/report.js       terminal rendering of the validation checklist
```

### File ownership (what the tool writes)

- `__snapshots__/` (or your snapshot dir) — written **only** on explicit approve
  or external import.
- `.playwright-review-session.json` — review progress. Gitignored.
- `.playwright-baseline-provenance.json` — external-import provenance. **Commit
  this** — it's a team artifact.
- `test-results/` and `playwright.config.ts` are never written.

---

## Known limitations (v0.1)

- **Test step sequence** requires the bundled `pw-ui-review/reporter` (one line
  in your config) because current Playwright versions omit a `steps` array from
  JSON reporter output. We deliberately do **not** parse `trace.zip` (it's an
  internal, version-unstable format). Without the reporter the UI shows a clear
  fallback in the Steps section.
- **Baseline history** (git timeline of a baseline PNG) is **out of scope for
  v0.1**.

---

## Contributing

Issues and PRs welcome on the public tracker. MIT licensed.

### Updating the demo submodule pointer

When the demo repo is updated, update the submodule pointer in pw-ui-review with:

```
cd demo && git pull origin main && cd ..
git add demo
git commit -m "chore: update demo submodule to latest"
```

### Integration tests

The `./demo` submodule is the intended surface for integration tests: run
`npx playwright test` inside `./demo`, then invoke the tool's core logic against
the produced results and assert on parsing, file writes on approve, no writes on
reject, and session-state updates. (Integration tests are not included in v0.1;
the architecture and path conventions are in place to add them.)

---

## Compatibility

- Node.js ≥ 18
- `@playwright/test` ≥ 1.40
- macOS, Linux, Windows
- Desktop browser, minimum 1024px wide
