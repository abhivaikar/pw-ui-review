// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// Mock the API module the Detail component talks to.
vi.mock('../../src/ui/api.js', () => ({
  api: {
    decide: vi.fn(),
    validateImport: vi.fn(),
    confirmImport: vi.fn(),
    imageUrl: (key, kind) => `/api/image/${key}/${kind}`,
  },
}));

import { api } from '../../src/ui/api.js';
import { Detail } from '../../src/ui/components/Detail.jsx';

function mkFailure(over = {}) {
  return {
    key: 'hero-chromium-darwin.png', index: 0, title: 'hero matches baseline',
    assertionName: 'hero', specFile: 'e2e/home.spec.ts', specFileName: 'home.spec.ts',
    line: 5, projectName: 'chromium', diffSummary: '100 pixels different (1%)',
    steps: [], stepsAvailable: false, hasBaseline: true,
    images: { expected: true, actual: true, diff: true }, decision: null, provenance: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('Detail — approve flow', () => {
  it('approves, shows confirmation, then auto-advances after the delay', async () => {
    vi.useFakeTimers();
    const next = { summary: { updated: 1 }, nextUnreviewed: 'b.png' };
    api.decide.mockResolvedValue(next);
    const onDecided = vi.fn();
    const onAdvance = vi.fn();

    render(<Detail failure={mkFailure()} onDecided={onDecided} onAdvance={onAdvance} onZoom={() => {}} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Update baseline'));
    });

    expect(api.decide).toHaveBeenCalledWith('hero-chromium-darwin.png', 'updated');
    expect(onDecided).toHaveBeenCalledWith(next);
    expect(screen.getByText(/Baseline updated/)).toBeInTheDocument();
    expect(onAdvance).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('Detail — reject flow', () => {
  it('keeps the baseline and shows post-rejection guidance', async () => {
    api.decide.mockResolvedValue({ summary: { kept: 1 }, nextUnreviewed: null });
    render(<Detail failure={mkFailure()} onDecided={() => {}} onAdvance={() => {}} onZoom={() => {}} />);

    await act(async () => { fireEvent.click(screen.getByText('Keep current baseline')); });

    expect(api.decide).toHaveBeenCalledWith('hero-chromium-darwin.png', 'kept');
    expect(screen.getByText(/Baseline unchanged/)).toBeInTheDocument();
    expect(screen.getByText(/Import a correct baseline below/)).toBeInTheDocument();
  });
});

describe('Detail — import flow', () => {
  it('validates a matching file, previews, and confirms the import', async () => {
    api.validateImport.mockResolvedValue({ ok: true, source: { width: 100, height: 80 }, reference: { width: 100, height: 80 } });
    api.confirmImport.mockResolvedValue({ summary: { imported: 1 }, nextUnreviewed: null });
    const onDecided = vi.fn();

    render(<Detail failure={mkFailure()} onDecided={onDecided} onAdvance={() => {}} onZoom={() => {}} />);

    const file = new File([new Uint8Array([1, 2, 3])], 'design.png', { type: 'image/png' });
    const input = screen.getByTestId('import-input');
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });

    expect(api.validateImport).toHaveBeenCalledWith('hero-chromium-darwin.png', file);
    await waitFor(() => expect(screen.getByText('Confirm import')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText('Confirm import')); });
    expect(api.confirmImport).toHaveBeenCalledWith('hero-chromium-darwin.png');
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
  });

  it('shows a dimension-mismatch error and offers no confirm', async () => {
    api.validateImport.mockResolvedValue({ ok: false, source: { width: 1280, height: 900 }, reference: { width: 1280, height: 800 } });
    render(<Detail failure={mkFailure()} onDecided={() => {}} onAdvance={() => {}} onZoom={() => {}} />);

    const file = new File([new Uint8Array([1])], 'wrong.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } }); });

    await waitFor(() => expect(screen.getByText(/Dimension mismatch: imported image is 1280×900/)).toBeInTheDocument());
    expect(screen.queryByText('Confirm import')).toBeNull();
  });
});
