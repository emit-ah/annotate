// Building the mode's parts without a framework: elements from their tag, attributes and children, texts only as
// text nodes, never as markup, and places through CSSOM, which a CSP that forbids style attributes allows.

import type { Rect } from "./model";

/** An element's attributes; `false` and `undefined` leave one out, `true` sets it empty. */
export type Attributes = Readonly<
  Record<string, string | number | boolean | undefined>
>;

/** A child: an element, or a text, which never reads as markup. */
export type Child = Node | string | undefined | false;

/** An element of `tag` in the document of `owner`, with `attributes` and `children`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  owner: Document,
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = owner.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== false) {
      element.setAttribute(name, value === true ? "" : String(value));
    }
  }
  append(element, children);
  return element;
}

/** Appends `children` to `parent`. */
export function append(parent: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child !== undefined && child !== false) {
      parent.appendChild(
        typeof child === "string"
          ? parent.ownerDocument.createTextNode(child)
          : child,
      );
    }
  }
}

/** Sets `element`'s CSS `properties` through CSSOM, in pixels where they are numbers. */
export function place(
  element: HTMLElement,
  properties: Readonly<Record<string, number | string>>,
): void {
  for (const [name, value] of Object.entries(properties)) {
    element.style.setProperty(
      name,
      typeof value === "number" ? `${value}px` : value,
    );
  }
}

/** Places `element` at `rect`. */
export function placeAt(element: HTMLElement, rect: Rect): void {
  place(element, {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

/** Sets `element`'s text, where it changed. */
export function setText(element: Element, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

/** Moves the focus to `element`, where it takes it. */
export function focus(element: Element | null | undefined): void {
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    element.focus();
  }
}

/** What a button of the mode shows and does. */
export interface ButtonOf {
  label: string;
  /** The key's cap it shows, and the shortcut it names to assistive technology. */
  key?: { cap: string; shortcut: string };
  primary?: boolean;
  /** Other attributes, such as an ID. */
  attributes?: Attributes;
}

/** A button of the mode that does `action` when pressed. */
export function button(
  owner: Document,
  of: ButtonOf,
  action: () => void,
): HTMLButtonElement {
  const element = h(
    owner,
    "button",
    {
      type: "button",
      class: of.primary === true ? "button primary" : "button",
      "aria-keyshortcuts": of.key?.shortcut,
      ...of.attributes,
    },
    of.label,
    of.key !== undefined &&
      h(owner, "kbd", { "aria-hidden": "true" }, of.key.cap),
  );
  element.addEventListener("click", action);
  return element;
}
