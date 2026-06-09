import { useState } from 'react';

// Left panel: a review-progress summary, then failures grouped by spec file
// (collapsible, with a failing-check count) and, within each spec, by test. A
// test with more than one failing snapshot becomes a non-clickable group header
// with the individual snapshots nested beneath.

function indicatorClass(decision) {
  if (decision === 'updated' || decision === 'imported') return 'failure-item__indicator--pass';
  if (decision === 'kept') return 'failure-item__indicator--kept';
  return ''; // unreviewed -> default fail dot
}

function groupBy(items, keyOf) {
  const order = [];
  const map = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (!map.has(k)) { map.set(k, []); order.push(k); }
    map.get(k).push(it);
  }
  return order.map((k) => map.get(k));
}

const specNameOf = (f) => f.specFileName ?? f.specFile ?? 'unknown';

function Item({ failure, child, activeKey, onSelect, label }) {
  const reviewed = failure.decision != null;
  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'failure-item',
        child ? 'failure-item--child' : '',
        failure.key === activeKey ? 'failure-item--active' : '',
        reviewed ? 'failure-item--reviewed' : '',
      ].join(' ').replace(/\s+/g, ' ').trim()}
      onClick={() => onSelect(failure.key)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(failure.key); }}
      title={label}
    >
      <span className={`failure-item__indicator ${indicatorClass(failure.decision)}`} />
      <span className="failure-item__label">{label}</span>
    </div>
  );
}

function TestGroups({ fileFailures, activeKey, onSelect }) {
  const tests = groupBy(fileFailures, (f) => `${f.line ?? ''}::${f.title}`);
  return tests.map((testFailures) => {
    const head = testFailures[0];
    if (testFailures.length === 1) {
      return (
        <Item key={head.key} failure={head} activeKey={activeKey}
          onSelect={onSelect} label={head.title} />
      );
    }
    return (
      <div key={`${head.line}-${head.title}`}>
        <div className="failure-group__header" title={head.title}>{head.title}</div>
        {testFailures.map((f) => (
          <Item key={f.key} failure={f} child activeKey={activeKey}
            onSelect={onSelect} label={f.assertionName} />
        ))}
      </div>
    );
  });
}

export function FailureList({ failures, activeKey, onSelect, summary, stale }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const byFile = groupBy(failures, specNameOf);

  const toggle = (name) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });

  return (
    <nav className="failures" aria-label="Failures">
      <div className="failures__summary">
        <div className="failures__progress">{summary.reviewed} of {summary.total} reviewed</div>
        <div className="failures__count">
          {failures.length} failing visual {failures.length === 1 ? 'check' : 'checks'}
        </div>
        {stale?.isStale && (
          <div className="failures__stale">⚠ Results are {stale.ageText} — consider re-running your tests</div>
        )}
      </div>

      <div className="failures__list">
        {byFile.map((fileFailures) => {
          const fileName = specNameOf(fileFailures[0]);
          const isCollapsed = collapsed.has(fileName);
          return (
            <div key={fileName}>
              <div className="failures__spec" role="button" tabIndex={0}
                onClick={() => toggle(fileName)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(fileName); }}>
                <span className={`failures__chevron ${isCollapsed ? 'failures__chevron--collapsed' : ''}`} aria-hidden="true">›</span>
                <span className="failures__spec-name" title={fileName}>{fileName}</span>
              </div>
              {!isCollapsed && (
                <TestGroups fileFailures={fileFailures} activeKey={activeKey} onSelect={onSelect} />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
