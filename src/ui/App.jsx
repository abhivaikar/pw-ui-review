import { useState, useEffect, useCallback } from 'react';
import { api } from './api.js';
import { Topbar } from './components/Topbar.jsx';
import { FailureList } from './components/FailureList.jsx';
import { Detail } from './components/Detail.jsx';
import { SessionComplete } from './components/SessionComplete.jsx';
import { ImageOverlay } from './components/ImageOverlay.jsx';

export function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [overlay, setOverlay] = useState(null);

  useEffect(() => {
    api.getState()
      .then((s) => {
        setState(s);
        setActiveKey(s.nextUnreviewed ?? s.failures[0]?.key ?? null);
      })
      .catch((err) => setError(err.message));
  }, []);

  const onDecided = useCallback((next) => {
    setState(next);
    // No auto-advance between items: you stay on the failure you just decided.
    // The one exception is the very end — once everything is reviewed, drop the
    // selection so the Session-complete summary takes over.
    if (next?.summary?.complete) setActiveKey(null);
  }, []);

  if (error) {
    return <div className="loading">Failed to load: {error}</div>;
  }
  if (!state) {
    return <div className="loading">Loading…</div>;
  }

  const failures = state.failures;
  const activeFailure = failures.find((f) => f.key === activeKey) ?? null;

  return (
    <div className="app">
      <Topbar />
      <div className="app__body">
        <FailureList
          failures={failures}
          activeKey={activeKey}
          onSelect={setActiveKey}
          summary={state.summary}
          stale={state.stale}
        />
        {renderRight()}
      </div>
      {overlay && (
        <ImageOverlay src={overlay.src} alt={overlay.alt} onClose={() => setOverlay(null)} />
      )}
      <div className="narrow-warning">
        <div>
          This window is too narrow. pw-ui-review needs at least 1024px of width
          so the Expected / Actual / Diff panels stay legible. Please widen the window.
        </div>
      </div>
    </div>
  );

  function renderRight() {
    if (failures.length === 0) {
      return (
        <div className="centered">
          <div className="empty-state">
            No visual snapshot failures found in the most recent test run.<br />
            Nothing to review.
          </div>
        </div>
      );
    }
    if (activeFailure) {
      return (
        <Detail
          key={activeFailure.key}
          failure={activeFailure}
          onDecided={onDecided}
          onZoom={(src, alt) => setOverlay({ src, alt })}
        />
      );
    }
    if (state.summary.complete) {
      return <SessionComplete summary={state.summary} />;
    }
    return <div className="loading">Select a failure to review.</div>;
  }
}
