# Contributing to pw-ui-review

Thanks for your interest in improving pw-ui-review! This document covers how to
set up the project, run the tests, and submit changes.

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js ≥ 18
- git (with [Git LFS](https://git-lfs.com) if you want to work with the demo
  project's baseline PNGs)

## Getting started

The repo links the demo Playwright project
[`pw-visual-tests-demo`](https://github.com/abhivaikar/pw-visual-tests-demo) as a
git submodule at `./demo`. It's the development and integration-test fixture.

```bash
# 1. Clone with the submodule
git clone --recurse-submodules https://github.com/abhivaikar/pw-ui-review
# (if you already cloned without it: git submodule update --init)

# 2. Install dependencies
npm install

# 3. (optional) Set up the demo project to run the tool against real results
cd demo && npm install && npx playwright install
npx playwright test --update-snapshots   # generate baselines (first time)
npm run simulate:failures                # produce real visual failures
cd ..

# 4. Run the tool against the demo results
node bin/pw-ui-review.js \
  --results ./demo/test-results/results.json \
  --snapshots ./demo/snapshots
```

With the submodule initialised and demo tests run, `node bin/pw-ui-review.js`
with no arguments also works from the repo root.

## Project layout

```
bin/            CLI entry point
src/core/       framework-free logic (parser, paths, validation, file ops, steps)
src/server/     Express adapter over the core
src/reporter/   bundled Playwright reporter ('pw-ui-review/reporter')
src/cli/        terminal rendering
src/ui/         React + Vite single-page UI
test/unit/      Vitest unit tests (core + server)
test/ui/        Vitest + Testing Library component tests
test/e2e/       Playwright UI tests (browser, backend stubbed)
```

All business logic lives in `src/core` as pure, framework-free modules; the
server and CLI are thin adapters. Please keep that separation — it's what keeps
the core fast to test.

## Running tests

```bash
npm test               # unit + component tests (Vitest)
npm run test:watch     # Vitest in watch mode

npm run test:e2e       # Playwright UI tests (real browser, API stubbed)
npm run test:e2e:report  # open the HTML report from the last e2e run
```

The unit/component and e2e suites do **not** require the demo submodule or Git
LFS — unit tests use a checked-in fixture and tmpdirs; e2e mocks the backend.

## Code style

```bash
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only — what CI runs)
```

Please run lint + format before opening a PR. CI enforces both.

## Submitting changes

1. Create a feature branch off `main`.
2. Add or update tests for your change (we aim to keep behavior covered).
3. Make sure `npm test`, `npm run test:e2e`, `npm run lint`, and
   `npm run format:check` all pass.
4. Update `CHANGELOG.md` under the `[Unreleased]` heading.
5. Open a pull request describing the change and the motivation.

Keep PRs focused; smaller is easier to review.

## Updating the demo submodule pointer

When the demo repo is updated, bump the submodule pointer here:

```bash
cd demo && git pull origin main && cd ..
git add demo
git commit -m "chore: update demo submodule to latest"
```

## Reporting bugs / requesting features

Use the GitHub issue templates. For security issues, please follow
[SECURITY.md](./SECURITY.md) instead of filing a public issue.
