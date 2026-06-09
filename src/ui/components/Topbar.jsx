import { ThemeToggle } from './ThemeToggle.jsx';

// Slim bar holding only the tool name (branded, Playwright logo colors) and the
// theme toggle. Review progress now lives in the left panel.
export function Topbar() {
  return (
    <div className="topbar">
      <span className="topbar__name"><b>pw</b>-ui-<i>review</i></span>
      <span className="topbar__spacer" />
      <ThemeToggle />
    </div>
  );
}
