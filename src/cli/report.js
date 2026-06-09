// Terminal rendering for the dependency-validation checklist (spec §7.2).
// Pure string building so it can be snapshot-tested without capturing stdout.

import { PASS, FAIL, WARN, INFO } from '../core/validation.js';

const useColor = !process.env.NO_COLOR && process.stdout?.isTTY;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c('2', s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const cyan = (s) => c('36', s);

const RULE = '─'.repeat(31);

const GLYPH = {
  [PASS]: () => green('✓'),
  [FAIL]: () => red('✗'),
  [WARN]: () => yellow('⚠'),
  [INFO]: () => cyan('ℹ'),
};

/**
 * Render the full validation report.
 * @param {import('../core/validation.js').ValidationOutcome} outcome
 * @param {{ version: string }} meta
 */
export function renderValidation(outcome, { version }) {
  const lines = [];
  lines.push(`pw-ui-review v${version}`);
  lines.push(dim(RULE));
  lines.push('Checking dependencies...');
  lines.push('');

  for (const v of outcome.results) {
    const glyph = (GLYPH[v.status] ?? (() => '·'))();
    lines.push(`  ${glyph}  ${v.label}`);
    // Detail lines (used by warnings / failures / info).
    for (const detail of v.lines ?? []) {
      lines.push(detail ? `       ${detail}` : '');
    }
  }

  lines.push('');
  lines.push(dim(RULE));

  if (outcome.nothingToReview) {
    lines.push('Nothing to review. Exiting.');
  } else if (outcome.ok) {
    const { port } = outcome.resolved;
    lines.push(`Starting server at http://localhost:${port}`);
    lines.push('Opening browser...');
  } else {
    lines.push(red('Validation failed. See above. Tool did not start.'));
  }

  return lines.join('\n');
}
