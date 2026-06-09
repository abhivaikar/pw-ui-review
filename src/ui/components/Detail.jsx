import { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';

const REJECT_RESTORE_MS = 4000;  // reject: show guidance, then restore the decision banner

// ── Header ──────────────────────────────────────────────────────────────────
export function DetailHeader({ failure }) {
  const resolved = failure.decision === 'updated' || failure.decision === 'imported';
  return (
    <div className="detail__section detail__section--header">
      <h1 className="detail-header__name">
        <span className="detail-header__test">{failure.title}</span>
        <span className="detail-header__sep">›</span>
        {failure.assertionName}
      </h1>
      <p className="detail-header__path">
        {failure.specFile}{failure.line != null ? `:${failure.line}` : ''}
      </p>
      {failure.diffSummary && (
        <p className={`detail-header__diff ${resolved ? 'detail-header__diff--stale' : ''}`}>
          <span className="detail-header__diff-value">{failure.diffSummary}</span>
          {resolved && <span className="detail-header__diff-note"> · from previous run</span>}
        </p>
      )}
      {failure.provenance?.source === 'external' && (
        <p className="detail-header__provenance">
          Baseline imported externally{failure.provenance.originalFilename ? ` from ${failure.provenance.originalFilename}` : ''}
        </p>
      )}
    </div>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────
export function Steps({ failure }) {
  return (
    <div className="detail__section">
      <div className="section-title">Steps</div>
      {failure.steps.length > 0 ? (
        failure.steps.map((s) => (
          s.failed ? (
            <div key={s.number}>
              <div className="step-row step-row--failed">
                <span className="step-row__num">{s.number}</span>
                <span className="step-row__title">{s.title}</span>
                <span className="step-row__badge">FAILED</span>
              </div>
              {failure.assertionCode && <div className="step-code">{failure.assertionCode}</div>}
            </div>
          ) : (
            <div key={s.number} className="step-row">
              <span className="step-row__num">{s.number}</span>
              <span className="step-row__title">{s.title}</span>
              <span className="step-row__dur">{s.durationMs != null ? `${s.durationMs}ms` : ''}</span>
            </div>
          )
        ))
      ) : (
        <div className="steps-empty">
          Step details aren’t available — this run’s JSON reporter did not record a{' '}
          <code>steps</code> array. The failed assertion is{' '}
          <code>{failure.assertionName}</code>.
        </div>
      )}
    </div>
  );
}

// ── Visual diff ─────────────────────────────────────────────────────────────
// An image whose load failure (missing file, Git-LFS pointer, unreadable PNG)
// degrades to a clear "Image unavailable" message instead of a broken-image icon.
function useImgError(src) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return [failed, () => setFailed(true)];
}

function DiffPanel({ label, sub, src, onZoom, stale }) {
  const [failed, onError] = useImgError(src);
  const showImg = src && !failed;
  return (
    <div className={`diff-panel ${stale ? 'diff-panel--stale' : ''}`}>
      <div className="diff-panel__label">{label}</div>
      {showImg ? (
        <div className="diff-panel__img-wrap" onClick={onZoom}>
          <img className="diff-panel__img" src={src} alt={label} onError={onError} />
        </div>
      ) : (
        <div className="diff-panel__img-wrap diff-panel__img-wrap--empty">
          {src ? 'Image unavailable' : 'No baseline yet'}
        </div>
      )}
      <div className="diff-panel__sub">{sub}</div>
    </div>
  );
}

function SingleDiff({ sub, src, alt, onZoom }) {
  const [failed, onError] = useImgError(src);
  const showImg = src && !failed;
  return (
    <div>
      {showImg ? (
        <div className="diff-single__img-wrap" onClick={onZoom}>
          <img className="diff-single__img" src={src} alt={alt} onError={onError} />
        </div>
      ) : (
        <div className="diff-single__img-wrap diff-panel__img-wrap--empty">
          {src ? 'Image unavailable' : 'No image available'}
        </div>
      )}
      <div className="diff-single__sub">{sub}</div>
    </div>
  );
}

// Draggable slider: Expected on the left of the divider, Actual on the right.
// Clicking (without dragging) opens the actual image full-screen.
function SliderCompare({ expectedSrc, actualSrc, onZoom }) {
  const [pos, setPos] = useState(50);
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);
  const dragged = useRef(false);

  if (failed) {
    return <div className="diff-single__img-wrap diff-panel__img-wrap--empty">Image unavailable</div>;
  }

  function setFromClientX(clientX) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  }

  function onDividerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragged.current = false;
    const move = (ev) => { dragged.current = true; setFromClientX(ev.clientX); };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <div
      className="slider"
      ref={ref}
      onClick={() => { if (!dragged.current) onZoom(); }}
    >
      <img className="slider__img" src={expectedSrc} alt="Expected" draggable={false}
        onError={() => setFailed(true)} />
      <img className="slider__overlay" src={actualSrc} alt="Actual" draggable={false}
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }} onError={() => setFailed(true)} />
      <span className="slider__tag slider__tag--left">Expected</span>
      <span className="slider__tag slider__tag--right">Actual</span>
      <div className="slider__divider" style={{ left: `${pos}%` }}
        onMouseDown={onDividerDown} onClick={(e) => e.stopPropagation()}>
        <div className="slider__handle" />
      </div>
    </div>
  );
}

const COMPARE_TABS = [
  ['side-by-side', 'Side by side'],
  ['slider', 'Slider'],
  ['actual', 'Actual'],
  ['expected', 'Expected'],
];

export function VisualDiff({ failure, onZoom }) {
  const [mode, setMode] = useState('side-by-side');
  const v = failure.decision ?? 'init'; // bust image cache after a decision
  const url = (kind) => api.imageUrl(failure.key, kind, v);
  const hasExpected = Boolean(failure.images.expected);
  const hasActual = Boolean(failure.images.actual);
  const hasDiff = Boolean(failure.images.diff);

  // Once the baseline has been written (approved or imported), the on-disk
  // Diff/pixel-count are from the PREVIOUS run and no longer reflect reality.
  // Expected now holds the new baseline. "kept" changes nothing, so it's exempt.
  const resolved = failure.decision === 'updated' || failure.decision === 'imported';
  const baselineSub = resolved
    ? (failure.decision === 'imported' ? 'imported baseline' : 'updated baseline')
    : 'current baseline';

  return (
    <div className="detail__section">
      <div className="section-title">Visual diff</div>

      {resolved && (
        <div className="diff-stale-note">
          <strong>Baseline {failure.decision === 'imported' ? 'imported' : 'updated'}.</strong>{' '}
          Re-run your Playwright tests to verify — the Diff panel below is from the previous run and
          no longer reflects the new baseline.
        </div>
      )}

      <div className="diff-tabs">
        {COMPARE_TABS.map(([m, label]) => (
          <button
            key={m}
            className={`diff-tab ${mode === m ? 'diff-tab--active' : ''}`}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'side-by-side' && (
        <div className="visual-diff">
          <DiffPanel label="Expected" sub={baselineSub}
            src={hasExpected ? url('expected') : null}
            onZoom={() => onZoom(url('expected'), 'Expected')} />
          <DiffPanel label="Actual" sub="this test run"
            src={hasActual ? url('actual') : null}
            onZoom={() => onZoom(url('actual'), 'Actual')} />
          <DiffPanel label="Diff" stale={resolved}
            sub={resolved ? 'previous run — re-run to verify' : 'pixel difference'}
            src={hasDiff ? url('diff') : null}
            onZoom={() => onZoom(url('diff'), 'Diff')} />
        </div>
      )}

      {mode === 'slider' && (
        hasExpected && hasActual ? (
          <SliderCompare expectedSrc={url('expected')} actualSrc={url('actual')}
            onZoom={() => onZoom(url('actual'), 'Actual')} />
        ) : (
          <SingleDiff sub="this test run" alt="Actual"
            src={hasActual ? url('actual') : null}
            onZoom={() => onZoom(url('actual'), 'Actual')} />
        )
      )}

      {mode === 'actual' && (
        <SingleDiff sub="this test run" alt="Actual"
          src={hasActual ? url('actual') : null}
          onZoom={() => onZoom(url('actual'), 'Actual')} />
      )}

      {mode === 'expected' && (
        <SingleDiff sub={baselineSub} alt="Expected"
          src={hasExpected ? url('expected') : null}
          onZoom={() => onZoom(url('expected'), 'Expected')} />
      )}
    </div>
  );
}

// ── Action bar + confirmation ───────────────────────────────────────────────
const REJECT_GUIDANCE =
  'Baseline unchanged. This test will continue to fail.\n\n' +
  'What you can do next:\n' +
  '  · Fix the code that caused this visual change and re-run your tests\n' +
  '  · Adjust your threshold or masking config if this is a rendering noise issue\n' +
  '  · Import a correct baseline below if you have one from outside your test run';

const APPROVE_HELP = "Replaces the baseline with this run's actual screenshot. This test will pass on the next run.";
const REJECT_HELP = 'Leaves the baseline unchanged. This test will continue to fail until you fix the change.';

// Shown when you revisit an already-decided failure: states the current
// decision and offers a single way back to the buttons to change it.
function DecisionBanner({ decision, onChange }) {
  const resolved = decision === 'updated' || decision === 'imported';
  const label = decision === 'imported' ? 'Baseline imported'
    : decision === 'updated' ? 'Baseline updated'
    : 'Baseline kept';
  const hint = resolved
    ? 'Re-run your Playwright tests to verify.'
    : 'Left unchanged — this test will keep failing until you fix the change.';
  return (
    <div className="decision-bar">
      <div className={`decision-bar__status ${resolved ? 'decision-bar__status--pass' : 'decision-bar__status--kept'}`}>
        <span className="decision-bar__label">{resolved ? '✓ ' : ''}{label}</span>
        <span className="decision-bar__hint">{hint}</span>
      </div>
      <button className="btn btn--reject decision-bar__change" onClick={onChange}>Change decision</button>
    </div>
  );
}

export function ActionBar({ confirmed, decision, changing, onApprove, onReject, onChange, busy }) {
  // 1) Reject shows post-rejection guidance briefly before the decision banner.
  if (confirmed === 'kept') {
    return <div className="confirmation confirmation--reject">{REJECT_GUIDANCE}</div>;
  }
  // 2) A decision exists — just made in this view (approve/import) or on a
  //    revisit — so show the decision banner instead of the raw buttons.
  const settled = confirmed ?? decision;
  if (settled && !changing) {
    return <DecisionBanner decision={settled} onChange={onChange} />;
  }
  // 3) Undecided, or actively changing a decision — the two action buttons.
  return (
    <div className="action-bar">
      <div className="action">
        <button className="btn btn--approve" onClick={onApprove} disabled={busy} title={APPROVE_HELP}>Update baseline</button>
        <p className="action__caption">{APPROVE_HELP}</p>
      </div>
      <div className="action">
        <button className="btn btn--reject" onClick={onReject} disabled={busy} title={REJECT_HELP}>Keep current baseline</button>
        <p className="action__caption">{REJECT_HELP}</p>
      </div>
    </div>
  );
}

// ── Import section ──────────────────────────────────────────────────────────
function ImportSection({ failure, onValidated, onImported, onInteract }) {
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function onChoose(e) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    onInteract?.(); // cancel any pending auto-advance
    setError(null); setValidation(null); setFile(chosen);
    try {
      const res = await api.validateImport(failure.key, chosen);
      if (res.ok) setValidation(res);
      else {
        setError(
          `Dimension mismatch: imported image is ${res.source.width}×${res.source.height}, ` +
          `expected ${res.reference.width}×${res.reference.height}. Please crop or resize to match.`
        );
      }
      onValidated?.(res);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onConfirm() {
    setBusy(true);
    try {
      const next = await api.confirmImport(failure.key);
      onImported?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail__section">
      <div className="section-title">Import baseline</div>
      <div className="import-row">
        <span>Have a PNG from outside your test run?</span>
        <button className="import-button" onClick={() => inputRef.current?.click()}>Choose file</button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={onChoose}
          data-testid="import-input"
        />
      </div>
      {error && <div className="import-error">{error}</div>}
      {validation?.ok && (
        <div>
          <div className="import-preview">
            <DiffPanel label="Imported" sub={file?.name} src={URL.createObjectURL(file)} />
            <DiffPanel label="Actual" sub="this test run"
              src={failure.images.actual ? api.imageUrl(failure.key, 'actual') : null} />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn--approve" onClick={onConfirm} disabled={busy}>Confirm import</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Composed detail view ────────────────────────────────────────────────────
export function Detail({ failure, onDecided, onZoom }) {
  const [confirmed, setConfirmed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const timer = useRef(null);

  // Reset when switching failures.
  useEffect(() => {
    setConfirmed(null);
    setBusy(false);
    setChanging(false);
    return () => clearTimeout(timer.current);
  }, [failure.key]);

  function clearTimer() { clearTimeout(timer.current); }

  async function decide(decision) {
    setBusy(true);
    setChanging(false);
    try {
      const next = await api.decide(failure.key, decision);
      clearTimer();
      if (decision === 'kept') {
        // Reject: show guidance briefly, then settle into the decision banner.
        setConfirmed('kept');
        timer.current = setTimeout(() => setConfirmed(null), REJECT_RESTORE_MS);
      } else {
        // Approve: record and show the decision banner right here. We stay on
        // this failure — no auto-advance. Completion is handled by the parent.
        setConfirmed(decision);
      }
      onDecided?.(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail">
      <DetailHeader failure={failure} />
      <Steps failure={failure} />
      <VisualDiff failure={failure} onZoom={onZoom} />
      <div className="detail__section">
        <ActionBar
          confirmed={confirmed}
          decision={failure.decision}
          changing={changing}
          busy={busy}
          onApprove={() => decide('updated')}
          onReject={() => decide('kept')}
          onChange={() => setChanging(true)}
        />
      </div>
      <ImportSection
        failure={failure}
        onInteract={clearTimer}
        onImported={(next) => {
          // Import records the decision and stays on this failure — no advance.
          clearTimer();
          setConfirmed('imported');
          onDecided?.(next);
        }}
      />
    </div>
  );
}
