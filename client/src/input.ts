// The window's keys and pointer for the mode. The keys are heard always, as the shortcut switches the mode on; the
// pointer, the focus and scrolling while it is on. In the capture phase the listeners keep the page's elements from
// every click and key: a click pins what lies under the pointer, a drag or two clicks with "Region" pin a region, and
// by keyboard Tab or the arrow keys pick, and Enter or A pins. Tab, scrolling and the browser's shortcuts still work.

import { brief, isOurs, picked, stepped } from './describe';
import { keyUse, type At, type Press } from './keys';
import type { Mode } from './mode';
import { between, type Point } from './place';
import { dragging, type Drag } from './state';
import { wordsOf } from './targets';

/** The pointer and mouse events the mode takes from the page while it is on. */
const POINTER_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'click',
  'auxclick',
  'dblclick',
  'mousedown',
  'mouseup',
  'contextmenu',
  'dragstart',
  'selectstart',
];

/** Input types that take text, where the shortcut types its letter. */
const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time']);

/** Roles of controls that take the arrow keys or Space themselves. */
const CONTROL_ROLES = new Set([
  'slider',
  'spinbutton',
  'combobox',
  'listbox',
  'menu',
  'tablist',
  'radiogroup',
  'grid',
  'tree',
]);

/** The element an event happened on, inside shadow roots too. */
function innermost(event: Event): Element | undefined {
  const [first] = event.composedPath();
  return first instanceof Element ? first : undefined;
}

/** The element of the page an event happened on, as the window sees it. */
function targetOf(event: Event): Element | undefined {
  return event.target instanceof Element ? event.target : undefined;
}

/** Whether `element` takes typed text. */
function takesText(element: Element): boolean {
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUTS.has(element.type);
  }
  return element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable);
}

/** Whether `element` takes the arrow keys or Space itself. */
function isControl(element: Element): boolean {
  const role = element.getAttribute('role') ?? '';
  return (
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLInputElement && element.type === 'range') ||
    CONTROL_ROLES.has(role)
  );
}

/** Keeps `event` from the page: its listeners and what the browser would do. */
function withhold(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/** The listeners of a window, which `stop` removes. */
export class Listeners {
  private readonly added: [string, EventListener][] = [];

  constructor(private readonly target: Window) {}

  /** Listens to `type` in the capture phase. */
  add(type: string, listener: EventListener): void {
    this.target.addEventListener(type, listener, true);
    this.added.push([type, listener]);
  }

  /** Removes every listener added. */
  stop(): void {
    this.added.splice(0).forEach(([type, listener]) => this.target.removeEventListener(type, listener, true));
  }
}

/** Hears the window's keys for `mode`. */
export function listenKeys(mode: Mode, window: Window): Listeners {
  const listeners = new Listeners(window);
  listeners.add('keydown', (event) => {
    if (event instanceof KeyboardEvent) {
      onKeydown(mode, event);
    }
  });
  return listeners;
}

/** A key: the mode's shortcut, and while the mode is on, what {@link keyUse} says. */
function onKeydown(mode: Mode, event: KeyboardEvent): void {
  const target = targetOf(event);
  const inner = innermost(event);
  const byKeyboard = mode.state.hover?.byKeyboard === true ? mode.state.hover.element : undefined;
  const pick =
    byKeyboard ??
    (target !== undefined && !['body', 'html'].includes(target.localName) && !isOurs(target) ? target : undefined);
  const at: At = {
    on: mode.state.stage !== 'off',
    picking: mode.picking(),
    picked: pick !== undefined,
    ours: target !== undefined && isOurs(target),
    typing: inner !== undefined && takesText(inner),
    control: inner !== undefined && isControl(inner),
  };
  const press: Press = {
    key: event.key,
    code: event.code,
    alt: event.altKey,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    composing: event.isComposing,
  };
  const use = keyUse(press, at);
  switch (use.use) {
    case 'pass':
      return;
    case 'browser':
      event.stopPropagation();
      return;
    case 'withhold':
      withhold(event);
      return;
    case 'switch':
      withhold(event);
      return at.on ? mode.leave() : void mode.start();
    case 'back':
      withhold(event);
      return mode.back();
    case 'pin':
      withhold(event);
      return pick === undefined ? undefined : void mode.pin(pick, undefined, true);
    case 'move': {
      withhold(event);
      const next = pick === undefined ? undefined : stepped(pick, use.step);
      if (next !== undefined) {
        next.scrollIntoView?.({ block: 'nearest' });
        const words = wordsOf(mode.messages(), brief(next));
        // The focus stays, so a screen reader hears the pick only from the mode.
        mode.say(words);
        mode.set({ hover: { element: next, words, byKeyboard: true } });
      }
    }
  }
}

/** Hears the window's pointer, focus and scrolling for `mode` while it is on. */
export function listenPage(mode: Mode, window: Window): Listeners {
  const listeners = new Listeners(window);
  for (const type of POINTER_EVENTS) {
    listeners.add(type, (event) => onPointer(mode, type, event));
  }
  listeners.add('focusin', (event) => onFocus(mode, event));
  // The pins and the outline follow their targets.
  listeners.add('scroll', () => mode.set({}));
  listeners.add('resize', () => mode.set({}));
  // A drag that left the window ends there.
  listeners.add('blur', (event) => {
    if (event.target === window) {
      mode.set({ drag: undefined });
    }
  });
  return listeners;
}

/** Where a pointer event happened, in the window's CSS pixels. */
function pointOf(event: Event): Point | undefined {
  return event instanceof MouseEvent ? [event.clientX, event.clientY] : undefined;
}

/** A pointer event: it hovers, clicks or drags for the mode, never for the page. */
function onPointer(mode: Mode, type: string, event: Event): void {
  const at = pointOf(event);
  if (type === 'pointercancel') {
    mode.set({ drag: undefined });
    return;
  }
  const released = type === 'pointerup' ? mode.state.drag : undefined;
  if (released !== undefined) {
    mode.set({ drag: undefined });
  }
  const target = targetOf(event);
  if (target === undefined) {
    return;
  }
  if (isOurs(target)) {
    // A drag ends wherever it is released, also over the mode's own parts.
    if (released !== undefined && at !== undefined && dragging({ ...released, to: at })) {
      void mode.region(between(released.from, at));
    }
    return;
  }
  if (type !== 'pointermove') {
    withhold(event);
  }
  if (!mode.picking()) {
    return;
  }
  if (
    type === 'pointerdown' &&
    event instanceof PointerEvent &&
    event.button === 0 &&
    event.isPrimary &&
    at !== undefined
  ) {
    mode.set({ drag: { from: at, to: at } });
  } else if (type === 'pointermove') {
    onMove(mode, event, target, at);
  } else if (type === 'pointerup' && released !== undefined && at !== undefined) {
    onRelease(mode, { ...released, to: at }, target);
  } else if (type === 'click' && mode.state.drag === undefined && event instanceof MouseEvent && event.detail === 0) {
    // A click no pointer made, as a screen reader's in browse mode, pins as Enter does.
    void mode.pin(picked(target), undefined, true);
  }
}

/** A pointer moving: it drags, or outlines what a click would pin. */
function onMove(mode: Mode, event: Event, target: Element, at: Point | undefined): void {
  const pressed: Drag | undefined = mode.state.drag;
  if (pressed !== undefined && event instanceof PointerEvent && event.buttons === 0) {
    // Released where the window did not see it.
    mode.set({ drag: undefined });
  } else if (pressed !== undefined && at !== undefined) {
    const drag = { ...pressed, to: at };
    mode.set(dragging(drag) ? { drag, hover: undefined } : { drag });
  } else if (pressed === undefined) {
    const element = picked(target);
    const shown = mode.state.hover;
    if (shown === undefined || shown.element !== element || shown.byKeyboard) {
      mode.set({ hover: { element, words: wordsOf(mode.messages(), brief(element)), byKeyboard: false } });
    }
  }
}

/** A pointer released: a drag pins a region, a click a corner of one or the element under it. */
function onRelease(mode: Mode, pressed: Drag, target: Element): void {
  const { corners } = mode.state;
  if (dragging(pressed)) {
    mode.set({ corners: 'off' });
    void mode.region(between(pressed.from, pressed.to));
  } else if (corners === 'first') {
    mode.set({ corners: pressed.to });
  } else if (corners !== 'off') {
    mode.set({ corners: 'off' });
    void mode.region(between(corners, pressed.to));
  } else {
    void mode.pin(picked(target), pressed.to, false);
  }
}

/** The focus moving to an element of the page, which Enter then pins. */
function onFocus(mode: Mode, event: Event): void {
  const target = targetOf(event);
  if (mode.picking() && target !== undefined && !isOurs(target)) {
    mode.set({ hover: { element: target, words: wordsOf(mode.messages(), brief(target)), byKeyboard: true } });
  }
}
