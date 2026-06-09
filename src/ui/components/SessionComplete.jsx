// Shown in the right panel once every failure has a decision.
export function SessionComplete({ summary }) {
  return (
    <div className="centered">
      <div>
        <div className="session-complete__title">✓ Session complete</div>
        <div className="session-complete__grid">
          <span className="session-complete__label">Updated (approved)</span>
          <span className="session-complete__num">{summary.updated}</span>
          <span className="session-complete__label">Kept (rejected)</span>
          <span className="session-complete__num">{summary.kept}</span>
          <span className="session-complete__label">Imported externally</span>
          <span className="session-complete__num">{summary.imported}</span>
          <div className="session-complete__rule" />
          <span className="session-complete__label">Total reviewed</span>
          <span className="session-complete__num">{summary.reviewed}</span>
        </div>
        <div className="session-complete__footer">
          Run your Playwright tests again to verify updated baselines.
        </div>
      </div>
    </div>
  );
}
