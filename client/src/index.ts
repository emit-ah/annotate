// The client's API (ADR-0001): plain functions over JSON-serialisable data, the same as `window.annotate` offers to
// any language. Importing it does nothing; `mount` puts the mode on the page.

import { Config, type HookName, type Hooks, type Options } from './config';
import { HOST_TAG } from './describe';
import { defineElement, type AnnotateElement } from './element';
import { hear } from './diagnostics';

export type { CanvasQuery, HookName, Hooks, Options } from './config';
export type { Messages } from './messages';
export type * from './model';

/** The client's version. */
export const version: string = __ANNOTATE_VERSION__;

const config = new Config();

/** Takes the app's settings and hooks over those given before. */
export function configure(options: Options): void {
  config.configure(options);
}

/** Sets the hook `name`, or removes it where `hook` is none. */
export function register<N extends HookName>(name: N, hook: Hooks[N] | undefined): void {
  config.register(name, hook);
}

/** The mode's element on the page, put there once: the mode listens for its shortcut from then on. */
export function mount(): AnnotateElement {
  hear(window);
  defineElement(window, config);
  const found =
    document.querySelector(HOST_TAG) ??
    (document.body ?? document.documentElement).appendChild(document.createElement(HOST_TAG));
  if (!isMode(found)) {
    throw new Error(`<${HOST_TAG}> is another element on this page`);
  }
  return found;
}

/** Whether `element` is the mode's element. */
function isMode(element: Element): element is AnnotateElement {
  return element.localName === HOST_TAG && 'mode' in element;
}

/** Switches the mode on, as its shortcut does. */
export async function start(): Promise<void> {
  await mount().mode?.start();
}

/** Switches the mode off, as Escape does. */
export function stop(): void {
  const element = document.querySelector(HOST_TAG);
  if (element !== null && isMode(element)) {
    element.mode?.leave();
  }
}

/** The API as `window.annotate` offers it. */
export const api = { version, configure, register, mount, start, stop };

/** Offers the API as `window.annotate`, and tells the page with `annotate:ready` on its document. */
export function install(): void {
  Object.defineProperty(window, 'annotate', { value: Object.freeze({ ...api }), configurable: true });
  document.dispatchEvent(new CustomEvent('annotate:ready'));
}
