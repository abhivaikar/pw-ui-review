import { useState, useEffect } from 'react';

// Theme toggle: cycles Auto (follow OS) → Light → Dark. The choice is applied by
// setting data-theme on <html> (consumed by the CSS palette overrides) and
// persisted to localStorage. "Auto" removes the attribute so prefers-color-scheme
// takes over again.
const MODES = ['auto', 'light', 'dark'];
const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const GLYPH = { auto: '◐', light: '☀', dark: '☾' };
const STORAGE_KEY = 'pwur-theme';

export function applyTheme(mode) {
  const el = document.documentElement;
  if (mode === 'auto') delete el.dataset.theme;
  else el.dataset.theme = mode;
}

export function ThemeToggle() {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'auto'; } catch { return 'auto'; }
  });

  useEffect(() => {
    applyTheme(mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const next = () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

  return (
    <button className="theme-toggle" onClick={next} title="Theme: auto / light / dark">
      <span aria-hidden="true">{GLYPH[mode]}</span>
      <span>{LABEL[mode]}</span>
    </button>
  );
}
