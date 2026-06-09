import type { Page } from '@playwright/test';

// A tiny valid 1×1 PNG, returned for every image request so <img> elements load
// in the browser (or aborted, to exercise the broken-image fallback).
export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

type Decision = 'updated' | 'kept' | 'imported' | null;

interface Failure {
  key: string; index: number; title: string; assertionName: string;
  specFile: string; specFileName: string; line: number; projectName: string;
  diffSummary: string | null; steps: any[]; stepsAvailable: boolean;
  assertionCode: string | null; hasBaseline: boolean;
  images: { expected: boolean; actual: boolean; diff: boolean };
  decision: Decision; provenance: any;
}

const img = () => ({ expected: true, actual: true, diff: true });

// Three failures across two spec files; profile.spec has two snapshots in one
// test (same title+line) to exercise the grouped/nested left-panel rendering.
export function defaultFailures(): Failure[] {
  return [
    {
      key: 'checkout-form-chromium-darwin.png', index: 0,
      title: 'form filled state matches', assertionName: 'checkout-form',
      specFile: 'e2e/checkout.spec.ts', specFileName: 'checkout.spec.ts', line: 5,
      projectName: 'chromium', diffSummary: '2,340 pixels different (1.23%)',
      steps: [
        { number: 1, title: "page.goto('/checkout')", category: 'pw:api', durationMs: 120, failed: false },
        { number: 2, title: 'Expect "toHaveScreenshot"', category: 'expect', durationMs: 300, failed: true },
      ],
      stepsAvailable: true,
      assertionCode: "await expect(page).toHaveScreenshot('checkout-form.png')",
      hasBaseline: true, images: img(), decision: null, provenance: null,
    },
    {
      key: 'profile-header-chromium-darwin.png', index: 1,
      title: 'profile renders', assertionName: 'profile-header',
      specFile: 'e2e/profile.spec.ts', specFileName: 'profile.spec.ts', line: 9,
      projectName: 'chromium', diffSummary: '8,910 pixels different (4.67%)',
      steps: [], stepsAvailable: false, assertionCode: null,
      hasBaseline: true, images: img(), decision: null, provenance: null,
    },
    {
      key: 'profile-footer-chromium-darwin.png', index: 2,
      title: 'profile renders', assertionName: 'profile-footer',
      specFile: 'e2e/profile.spec.ts', specFileName: 'profile.spec.ts', line: 9,
      projectName: 'chromium', diffSummary: '120 pixels different (0.06%)',
      steps: [], stepsAvailable: false, assertionCode: null,
      hasBaseline: true, images: img(), decision: null, provenance: null,
    },
  ];
}

export function makeState(over: Partial<{ failures: Failure[]; stale: any }> = {}) {
  const failures = over.failures ?? defaultFailures();
  const count = (d: Decision) => failures.filter((f) => f.decision === d).length;
  const reviewed = count('updated') + count('kept') + count('imported');
  return {
    runId: 'run-1',
    stale: over.stale ?? null,
    failures,
    summary: {
      updated: count('updated'), kept: count('kept'), imported: count('imported'),
      reviewed, total: failures.length,
      complete: reviewed === failures.length && failures.length > 0,
    },
    nextUnreviewed: failures.find((f) => !f.decision)?.key ?? null,
  };
}

/**
 * Stub the backend so the UI runs in isolation. Routes:
 *  - GET  /api/state            -> the provided state
 *  - GET  /api/image/**         -> a 1×1 PNG (or aborted if failImages)
 *  - POST /api/decision         -> applies the decision and returns fresh state
 *  - POST /api/import/**        -> validate ok + confirm
 */
export async function mockApi(page: Page, opts: { state?: ReturnType<typeof makeState>; failImages?: boolean } = {}) {
  let state = opts.state ?? makeState();

  await page.route('**/api/state', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) })
  );

  await page.route('**/api/image/**', (route) =>
    opts.failImages
      ? route.fulfill({ status: 500, body: 'unavailable' })
      : route.fulfill({ contentType: 'image/png', body: PNG_1x1 })
  );

  await page.route('**/api/decision', async (route) => {
    const { key, decision } = JSON.parse(route.request().postData() || '{}');
    const failures = state.failures.map((f) => (f.key === key ? { ...f, decision } : f));
    state = makeState({ failures });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
  });

  await page.route('**/api/import/**/validate**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, source: { width: 1, height: 1 }, reference: { width: 1, height: 1 } }),
    })
  );
  await page.route('**/api/import/**/confirm', async (route) => {
    const m = route.request().url().match(/\/api\/import\/([^/]+)\/confirm/);
    const key = m ? decodeURIComponent(m[1]) : null;
    if (key) {
      const failures = state.failures.map((f) => (f.key === key ? { ...f, decision: 'imported' as const } : f));
      state = makeState({ failures });
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
  });

  return { getState: () => state };
}
