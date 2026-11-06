// The bar while the mode is on: what a click does, whether the tab is shared, a region by two clicks, the page's
// annotations and the way out.

import { button, h, setText } from './dom';
import type { MessageKey } from './messages';
import { LIST_BUTTON, LIST_HEADING, type Mode } from './mode';
import { escapeKey } from './panels';

/** The bar, built once while it shows, its texts kept up to date so the focus stays on its buttons. */
export class Bar {
  readonly element: HTMLElement;
  private readonly hint: HTMLSpanElement;
  private readonly focused: HTMLButtonElement;
  private readonly sharing: HTMLSpanElement;
  private readonly dot: HTMLSpanElement;
  private readonly region: HTMLButtonElement;
  private readonly listButton: HTMLButtonElement;

  constructor(
    private readonly mode: Mode,
    document: Document,
  ) {
    const text = (key: MessageKey): string => mode.text(key);
    this.hint = h(document, 'span', { class: 'muted' });
    const enter = { cap: text('keyEnter'), shortcut: 'Enter' };
    this.focused = button(document, { label: text('pinFocused'), key: enter, primary: true }, () => {
      const { hover } = mode.state;
      if (hover !== undefined) {
        void mode.pin(hover.element, undefined, true);
      }
    });
    this.dot = h(document, 'span', { class: 'dot', 'aria-hidden': 'true' });
    this.sharing = h(document, 'span');
    this.region = button(document, { label: text('regionButton'), attributes: { 'aria-pressed': 'false' } }, () =>
      mode.set({ corners: mode.state.corners === 'off' ? 'first' : 'off' }),
    );
    this.listButton = button(document, { label: '', attributes: { id: LIST_BUTTON, 'aria-expanded': 'false' } }, () =>
      mode.set({ panel: true, focus: { ours: LIST_HEADING } }),
    );
    const done = button(document, { label: text('done'), key: escapeKey(mode) }, () => mode.leave());
    this.element = h(
      document,
      'section',
      { class: 'bar interactive', 'aria-label': text('mode') },
      h(document, 'span', { class: 'bar-title' }, text('mode')),
      this.hint,
      this.focused,
      h(document, 'span', { class: 'sharing' }, this.dot, this.sharing),
      this.region,
      this.listButton,
      done,
    );
  }

  /** What a click does now, in words. */
  private hintText(): string {
    const { hover, corners } = this.mode.state;
    if (corners !== 'off') {
      return this.mode.text(corners === 'first' ? 'cornerFirst' : 'cornerSecond');
    }
    return hover?.byKeyboard === true ? this.mode.text('focused', { target: hover.words }) : this.mode.text('hint');
  }

  /** Shows the mode's state now. */
  update(): void {
    const { hover, corners, capture, shown } = this.mode.state;
    setText(this.hint, this.hintText());
    this.focused.hidden = hover?.byKeyboard !== true || corners !== 'off';
    this.dot.classList.toggle('on', capture !== undefined);
    setText(this.sharing, this.mode.text(capture === undefined ? 'unshared' : 'shared'));
    this.region.setAttribute('aria-pressed', String(corners !== 'off'));
    setText(this.listButton, this.mode.text('onPage', { count: shown.length }));
  }
}
