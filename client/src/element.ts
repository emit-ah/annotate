// The mode's custom element, `<annotate-mode>`: its parts live in an open shadow root, styled by an adopted stylesheet,
// so they neither take the host's CSS nor give it theirs, and screen readers and tests still find them. The element is
// defined only when the page mounts it, so importing the client on a server, as in server-side rendering, touches no DOM.

import { asksForMode } from './address';
import { Capture } from './capture';
import type { Config } from './config';
import { HOST_TAG } from './describe';
import { hear } from './diagnostics';
import { listenKeys, listenPage, type Listeners } from './input';
import { Mode } from './mode';
import { Outbox } from './outbox';
import { styleSheet } from './styles';
import { Overlay } from './view';

/** The mode's element, as the page holds it. */
export interface AnnotateElement extends HTMLElement {
  readonly mode: Mode | undefined;
}

/** Defines `<annotate-mode>` in `window` with `config`, once; the element's class. */
export function defineElement(window: Window & typeof globalThis, config: Config): void {
  if (window.customElements.get(HOST_TAG) !== undefined) {
    return;
  }
  class Element extends window.HTMLElement implements AnnotateElement {
    mode: Mode | undefined;
    private keys: Listeners | undefined;
    private page: Listeners | undefined;
    private unsubscribe: (() => void) | undefined;

    connectedCallback(): void {
      if (this.mode !== undefined) {
        return;
      }
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      const sheet = styleSheet();
      if (sheet !== undefined) {
        root.adoptedStyleSheets = [sheet];
      }
      const heard = hear(window);
      const mode = new Mode({
        config,
        fetch: heard.fetch,
        outbox: new Outbox(window.indexedDB),
        window,
        startCapture: (ended) => Capture.start(ended),
        diagnostics: heard.diagnostics,
      });
      const overlay = new Overlay(mode, root);
      this.mode = mode;
      this.unsubscribe = mode.subscribe(() => {
        overlay.render();
        this.listenWhileOn(mode);
      });
      overlay.render();
      this.keys = listenKeys(mode, window);
      if (asksForMode(window.location.search)) {
        void mode.start();
      }
    }

    disconnectedCallback(): void {
      this.mode?.leave();
      this.keys?.stop();
      this.page?.stop();
      this.unsubscribe?.();
      this.mode = undefined;
      this.keys = undefined;
      this.page = undefined;
    }

    /** Hears the page's pointer while the mode is on, and stops once it is off. */
    private listenWhileOn(mode: Mode): void {
      const on = mode.state.stage !== 'off';
      if (on && this.page === undefined) {
        this.page = listenPage(mode, window);
      } else if (!on && this.page !== undefined) {
        this.page.stop();
        this.page = undefined;
      }
    }
  }
  window.customElements.define(HOST_TAG, Element);
}
