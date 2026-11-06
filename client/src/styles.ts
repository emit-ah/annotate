// The mode's look, adopted by its shadow root as a constructed stylesheet: no style element or attribute, so a strict
// CSP needs no 'unsafe-inline'. A host may set the custom properties `--annotate-accent`, `--annotate-on-accent`,
// `--annotate-surface`, `--annotate-ink`, `--annotate-muted` and `--annotate-problem` on `annotate-mode` to theme it.

export const STYLES = `
:host {
  --accent: var(--annotate-accent, #1d4ed8);
  --on-accent: var(--annotate-on-accent, #ffffff);
  --surface: var(--annotate-surface, #ffffff);
  --raised: var(--annotate-raised, #f3f4f6);
  --ink: var(--annotate-ink, #111827);
  --muted: var(--annotate-muted, #4b5563);
  --line: var(--annotate-line, #9ca3af);
  --problem: var(--annotate-problem, #b91c1c);
  --ok: var(--annotate-ok, #15803d);
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
}
@media (prefers-color-scheme: dark) {
  :host {
    --accent: var(--annotate-accent, #93b4ff);
    --on-accent: var(--annotate-on-accent, #0b1220);
    --surface: var(--annotate-surface, #111827);
    --raised: var(--annotate-raised, #1f2937);
    --ink: var(--annotate-ink, #f9fafb);
    --muted: var(--annotate-muted, #d1d5db);
    --line: var(--annotate-line, #6b7280);
    --problem: var(--annotate-problem, #fca5a5);
    --ok: var(--annotate-ok, #86efac);
  }
}
.layer.hidden { visibility: hidden; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.interactive { pointer-events: auto; }
.frame {
  position: fixed; border: 2px solid var(--accent); outline: 1px solid var(--on-accent); border-radius: 4px;
}
.frame.dashed { border-style: dashed; }
.frame.drag { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.frame-label {
  position: absolute; bottom: 100%; left: 0; margin-bottom: 4px; padding: 2px 6px; border-radius: 4px;
  background: var(--accent); color: var(--on-accent); font-size: 12px; white-space: nowrap;
}
.corner {
  position: fixed; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%;
  border: 2px solid var(--on-accent); background: var(--accent);
}
.pin {
  position: fixed; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 2px solid var(--on-accent);
  background: var(--accent); color: var(--on-accent); font: 600 12px/1 system-ui, sans-serif; cursor: pointer;
}
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, textarea:focus-visible, [tabindex]:focus-visible, .pin:focus-visible {
  outline: 3px solid var(--accent); outline-offset: 2px;
}
.button {
  display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 12px; border-radius: 8px;
  border: 1px solid var(--accent); background: var(--surface); color: var(--ink);
}
.button[aria-pressed="true"], .button.primary { background: var(--accent); color: var(--on-accent); }
.button.primary[aria-disabled="true"] { background: transparent; color: var(--muted); border-color: var(--line); }
kbd { font: 11px/1 system-ui, sans-serif; border: 1px solid currentColor; border-radius: 4px; padding: 2px 4px; }
.bar {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; flex-wrap: wrap;
  align-items: center; gap: 8px 16px; max-width: calc(100vw - 32px); padding: 8px 20px; border-radius: 24px;
  border: 1px solid var(--accent); background: var(--surface); box-shadow: 0 8px 32px rgb(0 0 0 / 30%);
}
.bar-title { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.muted { color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--muted); display: inline-block; }
.dot.on { background: var(--ok); border-color: var(--ok); }
.sharing { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
.looking {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); padding: 8px 20px; border-radius: 24px;
  border: 1px solid var(--accent); background: var(--surface);
}
dialog {
  width: min(32rem, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 24px;
  border-radius: 12px; border: 2px solid var(--accent); background: var(--surface); color: var(--ink);
}
dialog::backdrop { background: rgb(0 0 0 / 60%); }
.caption { margin: 0; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
h2 { margin: 8px 0 0; font-size: 24px; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; margin-top: 24px; }
.popover {
  position: fixed; display: flex; flex-direction: column; gap: 12px; width: 384px; max-width: calc(100vw - 24px);
  overflow-y: auto; padding: 16px; border-radius: 12px; border-left: 4px solid var(--accent);
  background: var(--surface); box-shadow: 0 8px 32px rgb(0 0 0 / 30%);
}
.popover h2 { margin: 0; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.popover p { margin: 0; }
textarea {
  min-height: 96px; padding: 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--raised);
  color: var(--ink); font: inherit; resize: vertical;
}
.crop { display: flex; align-items: center; gap: 12px; }
.crop img { max-height: 64px; max-width: 160px; border: 1px solid var(--line); border-radius: 4px; }
.problem { color: var(--problem); }
.small { font-size: 12px; }
.panel {
  position: fixed; top: 0; bottom: 0; right: 0; display: flex; flex-direction: column; gap: 16px;
  width: min(28rem, 100vw); overflow-y: auto; padding: 24px; border-left: 1px solid var(--accent);
  background: var(--surface); box-shadow: 0 8px 32px rgb(0 0 0 / 30%);
}
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.panel ol { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }
.item {
  display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: 12px; border: 1px solid var(--line);
  background: var(--raised);
}
.item p { margin: 0; }
.item:focus { border-color: var(--accent); }
.number {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%;
  background: var(--accent); color: var(--on-accent); font-size: 12px; font-weight: 600; margin-right: 8px;
}
.answer { padding: 12px; border-radius: 8px; border: 1px solid var(--line); }
.panel-foot { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); }
`;

/** The mode's stylesheet, where the browser constructs stylesheets; none where it does not, as in some test DOMs. */
export function styleSheet(): CSSStyleSheet | undefined {
  if (typeof CSSStyleSheet === 'undefined' || typeof CSSStyleSheet.prototype.replaceSync !== 'function') {
    return undefined;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLES);
  return sheet;
}
