import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseResults } from '../../src/core/parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '..', 'fixtures', 'sample-results.json');

async function loadSample() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

describe('parseResults — sample fixture', () => {
  it('extracts exactly the three visual failures across two spec files', async () => {
    const { failures } = parseResults(await loadSample());
    expect(failures).toHaveLength(3);
    expect(failures.map((f) => f.title)).toEqual([
      'form filled state matches baseline',
      'confirmation page matches baseline',
      'profile header matches baseline',
    ]);
  });

  it('uses the basename of the expected baseline as the session key', async () => {
    const { failures } = parseResults(await loadSample());
    expect(failures.map((f) => f.key)).toEqual([
      'checkout-form-filled-chromium-darwin.png',
      'checkout-confirmation-chromium-darwin.png',
      'profile-header-chromium-darwin.png',
    ]);
  });

  it('derives the assertion header name from the toHaveScreenshot title', async () => {
    const { failures } = parseResults(await loadSample());
    expect(failures[0].assertionName).toBe('checkout-form-filled');
  });

  it('exposes spec file metadata for grouping', async () => {
    const { failures } = parseResults(await loadSample());
    expect(failures[0].specFile).toBe('e2e/checkout.spec.ts');
    expect(failures[0].specFileName).toBe('checkout.spec.ts');
    expect(failures[0].line).toBe(5);
    expect(failures[2].specFileName).toBe('profile.spec.ts');
  });

  it('filters out hook steps and numbers the rest 1-based', async () => {
    const { failures } = parseResults(await loadSample());
    const steps = failures[0].steps;
    expect(steps.every((s) => s.category !== 'hook')).toBe(true);
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
    expect(steps[0].title).toBe('page.goto(https://my-app.local/checkout)');
  });

  it('flags the failed toHaveScreenshot step and only that step', async () => {
    const { failures } = parseResults(await loadSample());
    const failed = failures[0].steps.filter((s) => s.failed);
    expect(failed).toHaveLength(1);
    expect(failed[0].category).toBe('expect');
    expect(failed[0].title).toContain('toHaveScreenshot');
  });

  it('parses and formats the pixel-diff summary', async () => {
    const { failures } = parseResults(await loadSample());
    expect(failures[0].pixelsDifferent).toBe(2340);
    expect(failures[0].percentDifferent).toBe(1.23);
    expect(failures[0].diffSummary).toBe('2,340 pixels different (1.23%)');
    expect(failures[2].diffSummary).toBe('8,910 pixels different (4.67%)');
  });

  it('captures expected/actual/diff image paths and the trace path', async () => {
    const { failures } = parseResults(await loadSample());
    const f = failures[0];
    expect(f.images.expected).toMatch(/checkout-form-filled-chromium-darwin\.png$/);
    expect(f.images.actual).toMatch(/actual\.png$/);
    expect(f.images.diff).toMatch(/diff\.png$/);
    expect(f.tracePath).toMatch(/trace\.zip$/);
  });

  it('returns the run start time as runId', async () => {
    const { runId } = parseResults(await loadSample());
    expect(runId).toBe('2026-06-06T10:32:14.000Z');
  });

  it('assigns a contiguous 0-based index for ordering', async () => {
    const { failures } = parseResults(await loadSample());
    expect(failures.map((f) => f.index)).toEqual([0, 1, 2]);
  });
});

describe('parseResults — edge cases', () => {
  it('returns an empty list when there are no failures', () => {
    const { failures } = parseResults({ suites: [], stats: { startTime: 't' } });
    expect(failures).toEqual([]);
  });

  it('ignores passing results', () => {
    const report = {
      suites: [
        {
          file: 'e2e/ok.spec.ts',
          specs: [
            {
              title: 'passes',
              tests: [{ projectName: 'chromium', results: [{ status: 'passed', steps: [], attachments: [] }] }],
            },
          ],
        },
      ],
    };
    expect(parseResults(report).failures).toEqual([]);
  });

  it('ignores non-visual failures (no screenshot signature)', () => {
    const report = {
      suites: [
        {
          file: 'e2e/logic.spec.ts',
          specs: [
            {
              title: 'bad assertion',
              tests: [
                {
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'failed',
                      error: { message: 'expect(received).toBe(expected)' },
                      steps: [{ title: 'expect(x).toBe(y)', category: 'expect', error: { message: 'nope' } }],
                      attachments: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseResults(report).failures).toEqual([]);
  });

  it('synthesizes a key from screenshot name + project when no expected attachment exists', () => {
    const report = {
      suites: [
        {
          file: 'e2e/first.spec.ts',
          specs: [
            {
              title: 'first run no baseline',
              line: 9,
              tests: [
                {
                  projectName: 'firefox',
                  results: [
                    {
                      status: 'failed',
                      error: { message: 'A snapshot doesn\'t exist' },
                      attachments: [{ name: 'actual', path: '/tmp/x/actual.png' }],
                      steps: [
                        { title: 'expect(page).toHaveScreenshot(hero.png)', category: 'expect', error: { message: 'missing' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { failures } = parseResults(report);
    expect(failures).toHaveLength(1);
    expect(failures[0].key).toBe('hero-firefox.png');
    expect(failures[0].images.expected).toBeNull();
    expect(failures[0].diffSummary).toBeNull();
  });

  it('handles real Playwright shape: suffixed attachments, ratio message, no steps', () => {
    const report = {
      config: { rootDir: '/app' },
      suites: [
        {
          file: 'e2e/home.spec.ts',
          specs: [
            {
              title: 'full page — named screenshot',
              line: 12,
              tests: [
                {
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'failed',
                      // ANSI-laden message in the real "ratio" dialect.
                      error: { message: '[31mError[0m: toHaveScreenshot(expected) failed\n  219877 pixels (ratio 0.24 of all image pixels) are different.' },
                      attachments: [
                        { name: 'home-named-expected.png', contentType: 'image/png', path: '/app/snapshots/home.spec.ts/home-named-chromium-darwin.png' },
                        { name: 'home-named-actual.png', contentType: 'image/png', path: '/app/test-results/home/home-named-actual.png' },
                        { name: 'home-named-diff.png', contentType: 'image/png', path: '/app/test-results/home/home-named-diff.png' },
                        { name: 'trace', contentType: 'application/zip', path: '/app/test-results/home/trace.zip' },
                      ],
                      // no `steps` field at all
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { failures } = parseResults(report);
    expect(failures).toHaveLength(1);
    const f = failures[0];
    expect(f.key).toBe('home-named-chromium-darwin.png');
    expect(f.assertionName).toBe('home-named');
    expect(f.diffSummary).toBe('219,877 pixels different (24%)');
    expect(f.stepsAvailable).toBe(false);
    expect(f.steps).toEqual([]);
    expect(f.images.expected).toMatch(/home-named-chromium-darwin\.png$/);
    expect(f.images.actual).toMatch(/home-named-actual\.png$/);
    expect(f.tracePath).toMatch(/trace\.zip$/);
  });

  it('detects toMatchSnapshot (Buffer) failures', () => {
    const report = {
      suites: [
        {
          file: 'e2e/buffer.spec.ts',
          specs: [
            {
              title: 'buffer compared via toMatchSnapshot',
              tests: [
                {
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'failed',
                      error: { message: 'expect(Buffer).toMatchSnapshot(expected) failed\n  469 pixels (ratio 0.01 of all image pixels) are different.' },
                      attachments: [
                        { name: 'buttons-buffer-expected.png', contentType: 'image/png', path: '/app/snapshots/buffer.spec.ts/buttons-buffer-chromium-darwin.png' },
                        { name: 'buttons-buffer-diff.png', contentType: 'image/png', path: '/app/test-results/b/buttons-buffer-diff.png' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { failures } = parseResults(report);
    expect(failures).toHaveLength(1);
    expect(failures[0].assertionName).toBe('buttons-buffer');
    expect(failures[0].percentDifferent).toBe(1);
  });

  it('parses a dimension-mismatch message with no pixel count', () => {
    const report = {
      suites: [
        {
          file: 'e2e/size.spec.ts',
          specs: [
            {
              title: 'fullPage size changed',
              tests: [
                {
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'failed',
                      error: { message: 'toHaveScreenshot(expected) failed\n  Expected an image 1280px by 1114px, received 1280px by 720px.' },
                      attachments: [
                        { name: 'big-expected.png', contentType: 'image/png', path: '/app/snapshots/size.spec.ts/big-chromium-darwin.png' },
                        { name: 'big-actual.png', contentType: 'image/png', path: '/app/test-results/s/big-actual.png' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { failures } = parseResults(report);
    expect(failures[0].pixelsDifferent).toBeNull();
    expect(failures[0].sizeMismatch).toEqual({
      expected: { width: 1280, height: 1114 },
      received: { width: 1280, height: 720 },
    });
    expect(failures[0].diffSummary).toBe('Image size changed — received 1280×720, expected 1280×1114');
  });

  it('walks nested suites to find specs', () => {
    const report = {
      config: { rootDir: '/root' },
      suites: [
        {
          file: 'e2e/nested.spec.ts',
          suites: [
            {
              file: 'e2e/nested.spec.ts',
              specs: [
                {
                  title: 'deep',
                  tests: [
                    {
                      projectName: 'chromium',
                      results: [
                        {
                          status: 'failed',
                          error: { message: '10 pixels (0.01%) are different.' },
                          attachments: [
                            { name: 'expected', path: '/root/e2e/nested.spec.ts-snapshots/deep-chromium-darwin.png' },
                            { name: 'diff', path: '/tmp/diff.png' },
                          ],
                          steps: [
                            { title: 'Before Hooks', category: 'hook' },
                            { title: 'expect(page).toHaveScreenshot(deep.png)', category: 'expect', error: { message: 'x' } },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { failures } = parseResults(report);
    expect(failures).toHaveLength(1);
    expect(failures[0].key).toBe('deep-chromium-darwin.png');
    expect(failures[0].rootDir).toBe('/root');
  });
});
