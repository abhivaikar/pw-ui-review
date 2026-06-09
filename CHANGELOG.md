# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-09

### Added

- Post-run review UI for failed Playwright `toHaveScreenshot()` /
  `toMatchSnapshot()` assertions, with per-assertion approve/reject.
- Test-contextual step sequence, including the exact failing assertion code,
  via a bundled Playwright reporter (`pw-ui-review/reporter`) that writes a
  `pw-ui-review-steps.json` sidecar.
- Expected / Actual / Diff comparison with side-by-side, slider, and single-image
  modes, plus a full-screen overlay.
- Approve ("Update baseline") and reject ("Keep current baseline") with in-session
  undo, consequence captions, and a revisit "decision banner".
- External baseline import with dimension validation and provenance tracking.
- Session persistence keyed to the test run.
- Comprehensive startup dependency validation with actionable messages.
- Light and dark themes driven by `prefers-color-scheme`, with a manual toggle.

[Unreleased]: https://github.com/abhivaikar/pw-ui-review/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/abhivaikar/pw-ui-review/releases/tag/v0.1.0
