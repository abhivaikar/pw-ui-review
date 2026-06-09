// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Topbar } from '../../src/ui/components/Topbar.jsx';
import { FailureList } from '../../src/ui/components/FailureList.jsx';
import { SessionComplete } from '../../src/ui/components/SessionComplete.jsx';
import { Steps, ActionBar, VisualDiff, DetailHeader } from '../../src/ui/components/Detail.jsx';

function mkFailure(over = {}) {
  return {
    key: 'hero-chromium-darwin.png', index: 0, title: 'hero matches baseline',
    assertionName: 'hero', specFile: 'e2e/home.spec.ts', specFileName: 'home.spec.ts',
    line: 5, projectName: 'chromium', diffSummary: '100 pixels different (1%)',
    pixelsDifferent: 100, percentDifferent: 1, steps: [], stepsAvailable: false,
    hasBaseline: true, images: { expected: true, actual: true, diff: true },
    decision: null, provenance: null, ...over,
  };
}

describe('Topbar', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('renders the branded tool name and a theme toggle', () => {
    render(<Topbar />);
    expect(screen.getByText('pw')).toBeInTheDocument(); // branded fragment
    expect(screen.getByRole('button', { name: /Auto|Light|Dark/ })).toBeInTheDocument();
  });

  it('cycles the theme auto -> light -> dark -> auto via the toggle', () => {
    render(<Topbar />);
    const btn = screen.getByRole('button', { name: /Auto|Light|Dark/ });
    expect(document.documentElement.dataset.theme).toBeUndefined(); // auto
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBeUndefined(); // back to auto
  });
});

describe('FailureList', () => {
  const failures = [
    mkFailure({ key: 'a.png', title: 'a', specFileName: 'checkout.spec.ts', line: 5, decision: null }),
    mkFailure({ key: 'b.png', title: 'b', specFileName: 'checkout.spec.ts', line: 6, decision: 'updated' }),
    mkFailure({ key: 'c.png', title: 'c', specFileName: 'profile.spec.ts', line: 7, decision: 'kept' }),
  ];
  const renderList = (items, activeKey, onSelect = () => {}) =>
    render(
      <FailureList
        failures={items}
        activeKey={activeKey}
        onSelect={onSelect}
        summary={{ reviewed: items.filter((f) => f.decision).length, total: items.length }}
        stale={null}
      />
    );

  it('shows review progress and total failing checks in the panel', () => {
    renderList(failures, 'a.png');
    expect(screen.getByText('2 of 3 reviewed')).toBeInTheDocument();
    expect(screen.getByText('3 failing visual checks')).toBeInTheDocument();
  });

  it('groups failures by spec file', () => {
    renderList(failures, 'a.png');
    expect(screen.getByText('checkout.spec.ts')).toBeInTheDocument();
    expect(screen.getByText('profile.spec.ts')).toBeInTheDocument();
  });

  it('collapses and expands a spec file when its header is clicked', () => {
    renderList(failures, 'a.png');
    expect(screen.getByText('a')).toBeInTheDocument();
    fireEvent.click(screen.getByText('checkout.spec.ts')); // collapse
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.queryByText('b')).toBeNull();
    expect(screen.getByText('c')).toBeInTheDocument(); // other spec unaffected
    fireEvent.click(screen.getByText('checkout.spec.ts')); // expand
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('marks the active item and fires onSelect on click', () => {
    const onSelect = vi.fn();
    const { container } = renderList(failures, 'a.png', onSelect);
    expect(container.querySelector('.failure-item--active')).toHaveTextContent('a');
    fireEvent.click(screen.getByText('c'));
    expect(onSelect).toHaveBeenCalledWith('c.png');
  });

  it('groups multiple snapshot failures from one test under a non-clickable header', () => {
    const onSelect = vi.fn();
    const multi = [
      mkFailure({ key: 's1.png', title: 'renders states', assertionName: 'state-empty', specFileName: 'states.spec.ts', line: 11 }),
      mkFailure({ key: 's2.png', title: 'renders states', assertionName: 'state-error', specFileName: 'states.spec.ts', line: 11 }),
    ];
    const { container } = renderList(multi, 's1.png', onSelect);
    expect(container.querySelector('.failure-group__header')).toHaveTextContent('renders states');
    const children = container.querySelectorAll('.failure-item--child');
    expect(children).toHaveLength(2);
    expect(children[0]).toHaveTextContent('state-empty');
    fireEvent.click(screen.getByText('state-error'));
    expect(onSelect).toHaveBeenCalledWith('s2.png');
  });

  it('shows a single failing snapshot directly, with no group header', () => {
    const one = [mkFailure({ key: 'only.png', title: 'just one', specFileName: 'a.spec.ts', line: 9 })];
    const { container } = renderList(one, 'only.png');
    expect(container.querySelector('.failure-group__header')).toBeNull();
    expect(container.querySelector('.failure-item')).toHaveTextContent('just one');
  });

  it('applies reviewed styling and the right indicator per decision', () => {
    const { container } = renderList(failures, 'a.png');
    const items = container.querySelectorAll('.failure-item');
    expect(items[0].querySelector('.failure-item__indicator--pass')).toBeNull();
    expect(items[1].classList.contains('failure-item--reviewed')).toBe(true);
    expect(items[1].querySelector('.failure-item__indicator--pass')).not.toBeNull();
    expect(items[2].querySelector('.failure-item__indicator--kept')).not.toBeNull();
  });
});

describe('Steps', () => {
  it('renders a fallback when no steps are available', () => {
    render(<Steps failure={mkFailure({ steps: [], stepsAvailable: false })} />);
    expect(screen.getByText(/Step details aren’t available/)).toBeInTheDocument();
  });

  it('renders step rows and highlights the failed step with a FAILED badge', () => {
    const failure = mkFailure({
      stepsAvailable: true,
      steps: [
        { number: 1, title: 'page.goto(/)', category: 'pw:api', durationMs: 412, failed: false },
        { number: 2, title: 'expect(page).toHaveScreenshot()', category: 'expect', durationMs: 1037, failed: true },
      ],
    });
    const { container } = render(<Steps failure={failure} />);
    expect(screen.getByText('page.goto(/)')).toBeInTheDocument();
    expect(screen.getByText('412ms')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(container.querySelector('.step-row--failed')).not.toBeNull();
  });

  it('shows the exact assertion code beneath the failed step', () => {
    const failure = mkFailure({
      stepsAvailable: true,
      assertionCode: "expect(buffer).toMatchSnapshot('home-buffer.png')",
      steps: [{ number: 1, title: 'Expect "toMatchSnapshot"', category: 'expect', durationMs: 5, failed: true }],
    });
    const { container } = render(<Steps failure={failure} />);
    expect(container.querySelector('.step-code')).toHaveTextContent("expect(buffer).toMatchSnapshot('home-buffer.png')");
  });
});

describe('DetailHeader', () => {
  it('renders the test › snapshot breadcrumb', () => {
    const { container } = render(
      <DetailHeader failure={mkFailure({ title: 'page.screenshot() compared via toMatchSnapshot', assertionName: 'home-buffer' })} />
    );
    expect(container.querySelector('.detail-header__test')).toHaveTextContent('page.screenshot() compared via toMatchSnapshot');
    expect(container.querySelector('.detail-header__name')).toHaveTextContent('home-buffer');
  });

  it('marks the pixel count as stale after the baseline is updated', () => {
    const { container } = render(<DetailHeader failure={mkFailure({ decision: 'updated' })} />);
    expect(container.querySelector('.detail-header__diff--stale')).not.toBeNull();
    expect(screen.getByText(/from previous run/)).toBeInTheDocument();
  });
});

describe('ActionBar', () => {
  it('shows the two action buttons when undecided', () => {
    render(<ActionBar confirmed={null} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText('Update baseline')).toBeInTheDocument();
    expect(screen.getByText('Keep current baseline')).toBeInTheDocument();
  });
  it('shows a consequence caption under each button', () => {
    render(<ActionBar confirmed={null} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/Replaces the baseline with this run's actual screenshot/)).toBeInTheDocument();
    expect(screen.getByText(/Leaves the baseline unchanged/)).toBeInTheDocument();
  });

  it('shows the approve confirmation', () => {
    render(<ActionBar confirmed="updated" />);
    expect(screen.getByText(/Baseline updated/)).toBeInTheDocument();
  });
  it('shows the reject confirmation with guidance', () => {
    render(<ActionBar confirmed="kept" />);
    expect(screen.getByText(/Baseline unchanged/)).toBeInTheDocument();
    expect(screen.getByText(/What you can do next/)).toBeInTheDocument();
  });
  it('fires the right handlers', () => {
    const onApprove = vi.fn(); const onReject = vi.fn();
    render(<ActionBar confirmed={null} onApprove={onApprove} onReject={onReject} />);
    fireEvent.click(screen.getByText('Update baseline'));
    fireEvent.click(screen.getByText('Keep current baseline'));
    expect(onApprove).toHaveBeenCalled();
    expect(onReject).toHaveBeenCalled();
  });

  it('shows a decision banner (not raw buttons) when revisiting a decided item', () => {
    const onChange = vi.fn();
    render(<ActionBar confirmed={null} decision="updated" onChange={onChange} />);
    expect(screen.getByText('✓ Baseline updated')).toBeInTheDocument();
    expect(screen.queryByText('Update baseline')).toBeNull();
    expect(screen.queryByText('Keep current baseline')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change decision' }));
    expect(onChange).toHaveBeenCalled();
  });

  it('shows a Kept banner for a kept decision', () => {
    render(<ActionBar confirmed={null} decision="kept" onChange={() => {}} />);
    expect(screen.getByText('Baseline kept')).toBeInTheDocument();
  });

  it('reveals the buttons again while changing a decision', () => {
    render(<ActionBar confirmed={null} decision="updated" changing onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText('Update baseline')).toBeInTheDocument();
    expect(screen.getByText('Keep current baseline')).toBeInTheDocument();
  });
});

describe('VisualDiff', () => {
  it('renders the compare tabs and three panels by default, and zooms on click', () => {
    const onZoom = vi.fn();
    render(<VisualDiff failure={mkFailure()} onZoom={onZoom} />);
    // four compare-mode tabs
    expect(screen.getByRole('button', { name: 'Side by side' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Slider' })).toBeInTheDocument();
    // three labeled panels (images carry alt = label)
    expect(screen.getByAltText('Expected')).toBeInTheDocument();
    expect(screen.getByAltText('Actual')).toBeInTheDocument();
    expect(screen.getByAltText('Diff')).toBeInTheDocument();
    fireEvent.click(screen.getByAltText('Expected'));
    expect(onZoom).toHaveBeenCalledWith(expect.any(String), 'Expected');
  });

  it('switches to the single Actual view via its tab', () => {
    const onZoom = vi.fn();
    render(<VisualDiff failure={mkFailure()} onZoom={onZoom} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actual' })); // the tab, not the panel label
    fireEvent.click(screen.getByAltText('Actual'));
    expect(onZoom).toHaveBeenCalledWith(expect.any(String), 'Actual');
  });

  it('switches to the Slider view showing both images', () => {
    render(<VisualDiff failure={mkFailure()} onZoom={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Slider' }));
    expect(screen.getByAltText('Expected')).toBeInTheDocument();
    expect(screen.getByAltText('Actual')).toBeInTheDocument();
  });

  it('degrades to "Image unavailable" when an image fails to load', () => {
    render(<VisualDiff failure={mkFailure()} onZoom={() => {}} />);
    fireEvent.error(screen.getByAltText('Expected')); // e.g. server down / missing file
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });

  it('marks the diff stale and shows a re-run note once the baseline is updated', () => {
    const { container } = render(<VisualDiff failure={mkFailure({ decision: 'updated' })} onZoom={() => {}} />);
    expect(screen.getByText(/Re-run your Playwright tests to verify/i)).toBeInTheDocument();
    expect(container.querySelector('.diff-panel--stale')).not.toBeNull();
    expect(screen.getByText('updated baseline')).toBeInTheDocument(); // Expected sub-label
  });

  it('does NOT mark the diff stale for a kept decision', () => {
    const { container } = render(<VisualDiff failure={mkFailure({ decision: 'kept' })} onZoom={() => {}} />);
    expect(screen.queryByText(/Re-run your Playwright tests to verify/i)).toBeNull();
    expect(container.querySelector('.diff-panel--stale')).toBeNull();
  });

  it('shows a "No baseline yet" placeholder when expected image is absent', () => {
    render(<VisualDiff failure={mkFailure({ hasBaseline: false, images: { expected: false, actual: true, diff: false } })} onZoom={() => {}} />);
    expect(screen.getAllByText('No baseline yet').length).toBeGreaterThan(0);
  });
});

describe('SessionComplete', () => {
  it('renders the review tally', () => {
    render(<SessionComplete summary={{ updated: 2, kept: 1, imported: 1, reviewed: 4, total: 4, complete: true }} />);
    expect(screen.getByText(/Session complete/)).toBeInTheDocument();
    expect(screen.getByText('Updated (approved)')).toBeInTheDocument();
    expect(screen.getByText('Total reviewed')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
