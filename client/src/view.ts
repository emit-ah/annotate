// The mode's parts on the page: the bar, the question whether to share the tab, the outline of what a click would
// pin, the frame of a drag, the numbered pins, the comment's popover and the list. All lie in one layer in the
// mode's shadow root, which takes no pointer itself; their places come through CSSOM.

import { anchor, rectOf } from './describe';
import { Bar } from './bar';
import { button, focus, h, place, placeAt, setText } from './dom';
import type { MessageKey } from './messages';
import type { Mode } from './mode';
import { COMMENT, itemId, list, popover } from './panels';
import { between, spread, type Point } from './place';
import { bodyOf, dragging, type Draft, type Unable } from './state';

/** A pin's size in CSS pixels, 24 as WCAG 2.5.8 asks, and the room between pins. */
const PIN = 24;
const PIN_GAP = 4;

/** The room the page keeps at its end for the bar while the mode is on. */
const BAR_ROOM = '6rem';

const PROMPT_TITLE = 'annotate-prompt-title';

/** What the question says where the mode keeps nothing. */
const UNABLE_TEXTS: Readonly<Record<Unable, MessageKey>> = {
  'no-app': 'noApp',
  'no-version': 'noVersion',
  'no-service': 'noService',
  'not-now': 'notNow',
};

/** The mode's layer, which shows `mode`'s state in `root`. */
export class Overlay {
  private readonly document: Document;
  private readonly layer: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly marks: HTMLDivElement;
  private readonly pins: HTMLDivElement;
  private bar: Bar | undefined;
  private prompt: { key: string; element: HTMLDialogElement } | undefined;
  private draft: { shown: Draft['target']; element: HTMLElement } | undefined;
  private panel: { shown: unknown; element: HTMLElement } | undefined;
  private room = false;
  private rendering = false;
  private again = false;

  constructor(
    private readonly mode: Mode,
    root: ShadowRoot,
  ) {
    this.document = root.ownerDocument;
    this.status = h(this.document, 'p', { role: 'status', class: 'sr-only' });
    this.marks = h(this.document, 'div');
    this.pins = h(this.document, 'div');
    this.layer = h(this.document, 'div', { class: 'layer' }, this.status, this.marks, this.pins);
    root.appendChild(this.layer);
  }

  /** Shows the mode's state now; a change while it renders, as a blur when a part goes, renders again after. */
  render(): void {
    if (this.rendering) {
      this.again = true;
      return;
    }
    this.rendering = true;
    try {
      do {
        this.again = false;
        this.renderOnce();
      } while (this.again);
    } finally {
      this.rendering = false;
    }
  }

  private renderOnce(): void {
    const { state } = this.mode;
    const on = state.stage !== 'off';
    this.layer.classList.toggle('hidden', state.hidden);
    setText(this.status, state.said);
    this.setRoom(on);
    this.renderMarks();
    this.renderPins();
    this.renderBar();
    this.renderPrompt();
    this.renderDraft();
    this.renderPanel();
    this.applyFocus();
  }

  /** Leaves room at the page's end for the bar while `on`, so the page scrolls from under it. */
  private setRoom(on: boolean): void {
    if (on === this.room) {
      return;
    }
    this.room = on;
    const { documentElement, body } = this.document;
    if (on) {
      documentElement.style.setProperty('scroll-padding-bottom', BAR_ROOM);
      body.style.setProperty('padding-bottom', BAR_ROOM);
    } else {
      documentElement.style.removeProperty('scroll-padding-bottom');
      body.style.removeProperty('padding-bottom');
    }
  }

  /** The outline of what a click would pin, the frame of a drag, a region's first corner and the draft's target. */
  private renderMarks(): void {
    const { hover, drag, corners, draft, stage } = this.mode.state;
    const frames: HTMLElement[] = [];
    const frame = (rect: Parameters<typeof placeAt>[1], kind: string, label: string | undefined): void => {
      const element = h(
        this.document,
        'div',
        { class: `frame ${kind}` },
        label !== undefined && h(this.document, 'span', { class: 'frame-label' }, label),
      );
      placeAt(element, rect);
      frames.push(element);
    };
    const isDragging = drag !== undefined && dragging(drag);
    if (stage !== 'off' && hover !== undefined && !isDragging && draft === undefined) {
      frame(rectOf(hover.element), 'dashed', hover.words);
    }
    if (drag !== undefined && isDragging) {
      frame(between(drag.from, drag.to), 'drag', this.mode.text('regionLabel'));
    }
    if (typeof corners !== 'string') {
      const corner = h(this.document, 'div', { class: 'corner' });
      place(corner, { left: corners[0], top: corners[1] });
      frames.push(corner);
    }
    if (draft !== undefined) {
      frame(draft.anchor, '', draft.label);
    }
    this.marks.replaceChildren(...frames);
  }

  /** The numbered pins of the page's annotations, at their targets' top right corners, side by side. */
  private renderPins(): void {
    const { shown, stage } = this.mode.state;
    const [width, height] = this.mode.windowSize();
    const anchored: [number, Point][] = [];
    if (stage === 'on') {
      shown.forEach((item, index) => {
        const rect = anchor(this.document, bodyOf(item).target);
        if (rect !== undefined) {
          const y = Math.min(Math.max(rect.y - PIN / 2, 0), Math.max(height - PIN, 0));
          anchored.push([index + 1, [rect.x + rect.width - PIN / 2, y]]);
        }
      });
    }
    const places = spread(
      anchored.map(([, at]) => at),
      PIN + PIN_GAP,
      width - PIN,
    );
    const existing = new Map(Array.from(this.pins.children).map((pin) => [pin.getAttribute('data-number'), pin]));
    const kept = anchored.map(([number], index) => {
      const pin = existing.get(String(number)) ?? this.pin(number);
      const [x, y] = places[index] ?? [0, 0];
      if (pin instanceof HTMLElement) {
        place(pin, { left: x, top: y });
      }
      return pin;
    });
    if (kept.length !== this.pins.children.length || kept.some((pin, index) => this.pins.children[index] !== pin)) {
      this.pins.replaceChildren(...kept);
    }
  }

  /** The pin of annotation `number`, which opens the list at it. */
  private pin(number: number): HTMLButtonElement {
    const pin = h(
      this.document,
      'button',
      {
        type: 'button',
        class: 'pin interactive',
        'data-number': number,
        'aria-label': this.mode.text('pin', { number }),
      },
      String(number),
    );
    pin.addEventListener('click', () => this.mode.set({ panel: true, focus: { item: number } }));
    return pin;
  }

  /** The bar while the mode is on and the list is closed. */
  private renderBar(): void {
    const { stage, panel } = this.mode.state;
    const shows = stage === 'on' && !panel;
    if (shows && this.bar === undefined) {
      this.bar = new Bar(this.mode, this.document);
      this.layer.appendChild(this.bar.element);
    } else if (!shows && this.bar !== undefined) {
      this.bar.element.remove();
      this.bar = undefined;
    }
    this.bar?.update();
  }

  /** The question when the mode starts, or why it keeps nothing: a modal dialog, so the page is inert behind it. */
  private renderPrompt(): void {
    const { stage, unable } = this.mode.state;
    const key = stage === 'looking' || stage === 'asking' || stage === 'unable' ? `${stage}:${unable ?? ''}` : '';
    if (this.prompt?.key === key) {
      return;
    }
    this.prompt?.element.remove();
    this.prompt = undefined;
    this.layer.querySelector('.looking')?.remove();
    if (stage === 'looking') {
      this.layer.appendChild(h(this.document, 'p', { class: 'looking' }, this.mode.text('looking')));
    } else if (key !== '') {
      const element = this.dialog();
      this.layer.appendChild(element);
      element.showModal?.();
      this.prompt = { key, element };
      focus(element.querySelector('.primary'));
    }
  }

  /** The question's dialog: share the tab or go without pictures, or why the mode keeps nothing. */
  private dialog(): HTMLDialogElement {
    const { stage, unable } = this.mode.state;
    const text = (key: MessageKey): string => this.mode.text(key);
    const asking = stage === 'asking';
    const actions = asking
      ? [
          button(this.document, { label: text('without') }, () => void this.mode.answer(false)),
          button(this.document, { label: text('share'), primary: true }, () => void this.mode.answer(true)),
        ]
      : [button(this.document, { label: text('leave'), primary: true }, () => this.mode.leave())];
    const element = h(
      this.document,
      'dialog',
      { class: 'interactive', 'aria-labelledby': PROMPT_TITLE },
      h(this.document, 'p', { class: 'caption' }, text('mode')),
      h(this.document, 'h2', { id: PROMPT_TITLE }, text(asking ? 'shareTitle' : 'unableTitle')),
      h(this.document, 'p', {}, text(asking ? 'shareText' : UNABLE_TEXTS[unable ?? 'no-service'])),
      h(this.document, 'div', { class: 'actions' }, ...actions),
    );
    // Escape goes back through the mode's keys, which leave it, rather than closing only the dialog.
    element.addEventListener('cancel', (event) => event.preventDefault());
    return element;
  }

  /** The comment being written, in a popover beside its target. */
  private renderDraft(): void {
    const { draft } = this.mode.state;
    if (draft?.target !== this.draft?.shown) {
      this.draft?.element.remove();
      this.draft = undefined;
      if (draft !== undefined) {
        const element = popover(this.mode, draft, this.document);
        this.layer.appendChild(element);
        this.draft = { shown: draft.target, element };
        focus(element.querySelector(`#${COMMENT}`));
      }
    }
    const problem = this.draft?.element.querySelector('[role="alert"]');
    if (problem !== undefined && problem !== null) {
      setText(problem, draft?.problem ?? '');
    }
  }

  /** The list of the page's annotations, while it is open. */
  private renderPanel(): void {
    const { panel, shown } = this.mode.state;
    if (panel && this.panel?.shown === shown) {
      return;
    }
    this.panel?.element.remove();
    this.panel = undefined;
    if (panel) {
      const element = list(this.mode, this.document);
      this.layer.appendChild(element);
      this.panel = { shown, element };
    }
  }

  /** Moves the focus where an action asked it to go, once its part is there. */
  private applyFocus(): void {
    const request = this.mode.state.focus;
    if (request === undefined) {
      return;
    }
    this.mode.state.focus = undefined;
    if ('page' in request) {
      focus(request.page);
    } else {
      const id = 'item' in request ? itemId(request.item) : request.ours;
      focus(this.layer.querySelector(`#${id}`));
    }
  }
}
