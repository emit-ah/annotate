// What a key does while the mode is on or off (FR-ANN-001 and 002 of tutti): the shortcut switches it, Escape goes
// back, Enter or A pins what the keyboard picked, the arrows move the pick, and Tab, scrolling and the browser's own
// shortcuts still work. The page's own elements get no key while the mode is on.

/** A way an arrow key moves the pick. */
export type Step = 'out' | 'in' | 'back' | 'on';

/** A key pressed, as the mode reads it. */
export interface Press {
  key: string;
  code: string;
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  composing: boolean;
}

/** Where a key was pressed. */
export interface At {
  /** The mode is on, in any stage. */
  on: boolean;
  /** The mode picks targets: it is on, past its question, and no comment is being written. */
  picking: boolean;
  /** Something is picked by keyboard, which the arrow keys move and Enter pins. */
  picked: boolean;
  /** The key goes to one of the mode's own parts. */
  ours: boolean;
  /** The key goes to a field that takes text. */
  typing: boolean;
  /** The key goes to a control that takes the arrow keys or Space itself, such as a slider. */
  control: boolean;
}

/** What a key does. */
export type KeyUse =
  | { use: 'switch' }
  | { use: 'back' }
  | { use: 'pin' }
  | { use: 'move'; step: Step }
  | { use: 'browser' }
  | { use: 'withhold' }
  | { use: 'pass' };

const ARROWS: Readonly<Record<string, Step>> = {
  ArrowUp: 'out',
  ArrowDown: 'in',
  ArrowLeft: 'back',
  ArrowRight: 'on',
};

const SCROLL_KEYS = ['PageUp', 'PageDown', 'Home', 'End', ' '];

/**
 * Whether `press` is the mode's shortcut, `Alt+Shift+A`: by the key's letter, or by its place where the letter is
 * another, as a Mac's Option key makes "Å".
 */
function isShortcut(press: Press): boolean {
  const letter = press.key.toLowerCase() === 'a';
  const byPlace = press.code === 'KeyA' && !/^[\x20-\x7e]*$/.test(press.key);
  return press.alt && press.shift && !press.ctrl && !press.meta && (letter || byPlace);
}

/** What `press` does `at` where it was pressed. */
export function keyUse(press: Press, at: At): KeyUse {
  // In a field, the shortcut types its letter.
  if (isShortcut(press) && !at.typing) {
    return { use: 'switch' };
  }
  if (!at.on) {
    return { use: 'pass' };
  }
  if (press.key === 'Escape') {
    return { use: 'back' };
  }
  if (at.ours) {
    return { use: 'pass' };
  }
  if (press.composing) {
    return { use: 'withhold' };
  }
  const pins = press.key === 'Enter' || (press.key.toLowerCase() === 'a' && !press.alt);
  if (press.ctrl || press.meta) {
    // Ctrl+Enter would open a link in a new tab.
    return pins ? { use: 'withhold' } : { use: 'browser' };
  }
  if (press.key === 'Tab') {
    return { use: 'browser' };
  }
  const step = ARROWS[press.key];
  if (at.picking && at.picked && pins && !press.alt) {
    return { use: 'pin' };
  }
  if (at.picking && at.picked && step !== undefined) {
    return { use: 'move', step };
  }
  const scrolls = step !== undefined || SCROLL_KEYS.includes(press.key);
  return scrolls && !at.control && !at.typing ? { use: 'browser' } : { use: 'withhold' };
}
