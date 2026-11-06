// What an element is, in the words the record keeps: its role and accessible name by the rules tests find elements
// by, the app's text IDs, the components it lies in, a path to find it again, and where it is; which element a
// pointer, an arrow key or a region picks; and what the app keeps out of the record.

import { MAX_ITEMS, type Element as Described, type Rect, type Target } from './model';
import { holds, offsetBy } from './place';
import type { Step } from './keys';
import { squeezed } from './text';

/** The tag of the mode's own element, whose parts are no target. */
export const HOST_TAG = 'annotate-mode';

/** Elements whose name and text stay out of the record, and whose pixels are painted over in pictures. */
export const REDACTED = '[data-annotate-redact], [data-annotate-private]';

/** Elements that are no target at all, besides being redacted. */
export const PRIVATE = '[data-annotate-private]';

/** Elements that draw what the app describes in its own words through its canvas hook. */
export const CANVAS = 'canvas, [data-annotate-canvas]';

/** The elements a pointer, an arrow key or a region picks, as a user would name them. */
const PICKABLE =
  'a[href], button, input, select, textarea, summary, label, [role], h1, h2, h3, h4, h5, h6, p, li, img, canvas, ' +
  'svg, [data-annotate-id], [data-annotate-label], [data-annotate-canvas]';

/** Elements whose text is no text of the page. */
const NO_TEXT = 'script, style, template, noscript';

/** The most characters of an element's text or name the record keeps. */
const MAX_EXCERPT = 300;

/** The most characters of a name in brief, as the outline shows it. */
const MAX_BRIEF = 60;

/** The most text nodes of an element whose texts go to the app's text IDs, so a whole view stays quick. */
const MAX_TEXT_NODES = 400;

/** The roles that take their name from their content. */
const NAMED_BY_CONTENT = new Set([
  'button',
  'link',
  'heading',
  'tab',
  'option',
  'menuitem',
  'checkbox',
  'radio',
  'switch',
  'cell',
  'tooltip',
  'listitem',
  'paragraph',
]);

/** The roles of elements without their own `role`, by tag, a subset of HTML-AAM. */
const ROLES_BY_TAG: Readonly<Record<string, string>> = {
  button: 'button',
  summary: 'button',
  select: 'combobox',
  textarea: 'textbox',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  p: 'paragraph',
  dialog: 'dialog',
  table: 'table',
  details: 'group',
  fieldset: 'group',
  progress: 'progressbar',
  img: 'img',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

/** The roles of inputs by their type; a type not named is a text box. */
const ROLES_BY_INPUT: Readonly<Record<string, string | null>> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
  hidden: null,
};

/** The role of an element without its own `role`, as the browser gives it, by its tag and attributes. */
export function implicitRole(tag: string, attribute: (name: string) => string | null): string | undefined {
  if (tag === 'a') {
    return attribute('href') === null ? undefined : 'link';
  }
  if (tag === 'input') {
    const role = ROLES_BY_INPUT[(attribute('type') ?? '').toLowerCase()];
    return role === null ? undefined : (role ?? 'textbox');
  }
  if (tag === 'img' && attribute('alt') === '') {
    return undefined;
  }
  return ROLES_BY_TAG[tag];
}

/** Whether `node` is or lies in the mode's own element, also inside its shadow root. */
export function isOurs(node: Node): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current instanceof Element && current.localName === HOST_TAG) {
      return true;
    }
    const root: Node = current.getRootNode();
    current = current.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

/** Whether the app keeps `element`'s name and text out of the record. */
export function isRedacted(element: Element): boolean {
  return element.closest(REDACTED) !== null;
}

/** Whether `element` may not be a target at all. */
export function isPrivate(element: Element): boolean {
  return element.closest(PRIVATE) !== null;
}

/**
 * Whether `path` is one this module writes: tags, IDs and places among siblings, nothing a selector could do more with,
 * as paths come back from the service, where any user may have written them.
 */
export function isPlainPath(path: string): boolean {
  return (
    path !== '' &&
    /^[A-Za-z0-9 >#\-_:()]+$/.test(path) &&
    path
      .split(':')
      .slice(1)
      .every((pseudo) => pseudo.startsWith('nth-of-type('))
  );
}

/** Whether `element` holds text directly, not only in its children. */
function hasOwnText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  );
}

/** The element a pointer on `target` picks: `target` where it shows text of its own, else the nearest pickable one. */
export function picked(target: Element): Element {
  return hasOwnText(target) ? target : (target.closest(PICKABLE) ?? target);
}

/** Whether an arrow key may pick `element`. */
function pickable(element: Element): boolean {
  return element.matches(PICKABLE) && !isOurs(element);
}

/** The first pickable element in `element`, or itself. */
function firstIn(element: Element): Element | undefined {
  if (pickable(element)) {
    return element;
  }
  const found = element.querySelector(PICKABLE);
  return found !== null && !isOurs(found) ? found : undefined;
}

/** The pickable element that `step` from `from` leads to; none at the edges. */
export function stepped(from: Element, step: Step): Element | undefined {
  if (step === 'out') {
    const found = from.parentElement?.closest(PICKABLE) ?? null;
    return found !== null && !isOurs(found) ? found : undefined;
  }
  if (step === 'in') {
    const found = from.querySelector(PICKABLE);
    return found !== null && !isOurs(found) ? found : undefined;
  }
  const next = (element: Element): Element | null =>
    step === 'back' ? element.previousElementSibling : element.nextElementSibling;
  for (let sibling = next(from); sibling !== null; sibling = next(sibling)) {
    const found = firstIn(sibling);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Where `element` is, in the window's CSS pixels. */
export function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** The role of `element`, its own or the implicit one. */
function roleOf(element: Element): string | undefined {
  const own = element.getAttribute('role')?.trim().split(/\s+/)[0];
  return own !== undefined && own !== '' ? own : implicitRole(element.localName, (name) => element.getAttribute(name));
}

/** The texts of the text nodes in `node` that the app has not redacted, up to {@link MAX_TEXT_NODES}. */
function textsIn(node: Node, texts: string[] = []): string[] {
  for (const child of Array.from(node.childNodes)) {
    if (texts.length >= MAX_TEXT_NODES) {
      break;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text.trim() !== '') {
        texts.push(text);
      }
    } else if (child instanceof Element && !child.matches(REDACTED) && !child.matches(NO_TEXT) && !isOurs(child)) {
      const label = child.getAttribute('aria-label');
      if (label !== null && label.trim() !== '') {
        texts.push(label);
      }
      textsIn(child, texts);
    }
  }
  return texts;
}

/** The text of `element` that the app has not redacted, as its source has it, before CSS changes its case. */
function textOf(element: Element): string {
  return isRedacted(element) ? '' : squeezed(textsIn(element).join(' '), MAX_EXCERPT);
}

/** The texts of the elements whose IDs `ids` names, as `aria-labelledby` does. */
function textsOfIds(element: Element, ids: string): string {
  return ids
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id))
    .filter((labelling): labelling is HTMLElement => labelling !== null && !isRedacted(labelling))
    .map(textOf)
    .join(' ');
}

/** The text of a field's label: the one around it or the one that names its ID. */
function labelOf(element: Element): string | undefined {
  if (!['input', 'select', 'textarea'].includes(element.localName)) {
    return undefined;
  }
  const plainId = /^[A-Za-z0-9_-]+$/.test(element.id);
  const named = plainId ? element.ownerDocument.querySelector(`label[for="${element.id}"]`) : null;
  const label = element.closest('label') ?? named;
  const text = label === null ? '' : textOf(label);
  return text === '' ? undefined : text;
}

/** The value of the attribute `name` of `element`, where it has one with text. */
function attribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value !== null && value.trim() !== '' ? value : undefined;
}

/**
 * The accessible name of `element` with its `role`, by the steps of the accessible name computation: the app's
 * `data-annotate-label`, `aria-labelledby`, `aria-label`, a field's label, a picture's `alt`, the content for roles
 * named by it, then `title` and `placeholder`. Of a redacted element only the app's own label.
 */
function nameOf(element: Element, role: string | undefined): string | undefined {
  const own = attribute(element, 'data-annotate-label');
  if (own !== undefined || isRedacted(element)) {
    return own === undefined ? undefined : squeezed(own, MAX_EXCERPT);
  }
  const byIds = attribute(element, 'aria-labelledby');
  const labelled = byIds === undefined ? '' : textsOfIds(element, byIds);
  const byContent =
    (role !== undefined && NAMED_BY_CONTENT.has(role)) || ['label', 'legend', 'figcaption'].includes(element.localName);
  const content = byContent ? textOf(element) : '';
  const name =
    (labelled === '' ? undefined : labelled) ??
    attribute(element, 'aria-label') ??
    labelOf(element) ??
    attribute(element, 'alt') ??
    (content === '' ? undefined : content) ??
    attribute(element, 'title') ??
    attribute(element, 'placeholder');
  return name === undefined ? undefined : squeezed(name, MAX_EXCERPT);
}

/**
 * A selector that finds `element` again: from the nearest ancestor with an ID, else from the body, each step by its
 * tag and its place among its siblings of that tag.
 */
function pathOf(element: Element): string {
  const steps: string[] = [];
  for (let step: Element | null = element; step !== null; step = step.parentElement) {
    const tag = step.localName;
    if (step.id !== '' && /^[A-Za-z0-9_-]+$/.test(step.id)) {
      steps.push(`#${step.id}`);
      break;
    }
    if (tag === 'body' || tag === 'html') {
      steps.push(tag);
      break;
    }
    let place = 1;
    for (let before = step.previousElementSibling; before !== null; before = before.previousElementSibling) {
      place += before.localName === tag ? 1 : 0;
    }
    steps.push(`${tag}:nth-of-type(${place})`);
  }
  return steps.reverse().join(' > ');
}

/** The components `element` lies in, by the `data-annotate-component` or `data-component` of their roots. */
function componentsOf(element: Element): string[] {
  const components: string[] = [];
  for (let step: Element | null = element; step !== null; step = step.parentElement) {
    const name = step.getAttribute('data-annotate-component') ?? step.getAttribute('data-component');
    if (name !== null && name !== '') {
      components.push(squeezed(name, MAX_EXCERPT));
    }
  }
  return components.reverse().slice(0, MAX_ITEMS);
}

/** The `data-annotate-id` values of `element` and the elements in it: IDs, which are no content, also where redacted. */
function dataIdsOf(element: Element): string[] {
  const marked = [element, ...Array.from(element.querySelectorAll('[data-annotate-id]'))];
  return marked
    .map((each) => each.getAttribute('data-annotate-id') ?? '')
    .filter((id) => id !== '')
    .map((id) => squeezed(id, MAX_EXCERPT));
}

/** The texts that name `element` and that it shows, which the app's text IDs hook looks up; none where redacted. */
export function textsToLookUp(element: Element): string[] {
  if (isRedacted(element)) {
    return [];
  }
  const named = ['aria-label', 'title', 'placeholder', 'alt'].map((name) => attribute(element, name));
  const byIds = attribute(element, 'aria-labelledby');
  const texts = [...named, byIds === undefined ? undefined : textsOfIds(element, byIds), ...textsIn(element)];
  return texts.filter((text): text is string => text !== undefined && text.trim() !== '').map((text) => text.trim());
}

/** `element` in the words of the record, with `textIds` the app gave for its texts. */
export function describe(element: Element, textIds: readonly string[]): Described {
  const role = roleOf(element);
  const ids = [...new Set([...dataIdsOf(element), ...textIds])].slice(0, MAX_ITEMS);
  const name = nameOf(element, role);
  return {
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    tag: element.localName,
    text_ids: ids,
    text: textOf(element),
    components: componentsOf(element),
    dom_path: pathOf(element),
    rect: rectOf(element),
    redacted: isRedacted(element),
  };
}

/** What `element` is in brief, as the outline names it: its role, else its tag, and its name, else its text. */
export function brief(element: Element): [what: string, name: string | undefined] {
  const role = roleOf(element);
  const name = nameOf(element, role) ?? textOf(element);
  return [role ?? element.localName, name === '' ? undefined : squeezed(name, MAX_BRIEF)];
}

/** What the record `element` is in brief, as {@link brief} says it of an element on the page. */
export function briefOf(element: Described): [what: string, name: string | undefined] {
  const name = element.name ?? element.text;
  return [element.role ?? element.tag, name === '' ? undefined : squeezed(name, MAX_BRIEF)];
}

/** The elements wholly in `region`, the outermost of each nest, in the order of the page, at most {@link MAX_ITEMS}. */
export function inRegion(document: Document, region: Rect): Element[] {
  const kept: Element[] = [];
  for (const element of Array.from(document.querySelectorAll(PICKABLE))) {
    if (kept.length >= MAX_ITEMS) {
      break;
    }
    const skip = isOurs(element) || isPrivate(element) || kept.some((outer) => outer.contains(element));
    if (!skip && holds(region, rectOf(element))) {
      kept.push(element);
    }
  }
  return kept;
}

/** The name a canvas goes by: its `data-annotate-canvas`, else its ID, else `canvas`. */
export function canvasName(canvas: Element): string {
  return attribute(canvas, 'data-annotate-canvas') ?? (canvas.id === '' ? 'canvas' : canvas.id);
}

/** The canvas `element` lies in, where the app describes what it draws. */
export function canvasOf(element: Element): Element | undefined {
  return element.closest(CANVAS) ?? undefined;
}

/** The canvas of the name `name` on the page. */
function canvasNamed(document: Document, name: string): Element | undefined {
  return Array.from(document.querySelectorAll(CANVAS)).find((canvas) => canvasName(canvas) === name);
}

/** The element the record `element` was made of, while the page has it with the recorded tag, role and name. */
export function locate(document: Document, element: Described): Element | undefined {
  if (!isPlainPath(element.dom_path)) {
    return undefined;
  }
  const found = document.querySelector(element.dom_path);
  if (found === null) {
    return undefined;
  }
  const role = roleOf(found);
  const same = found.localName === element.tag && role === element.role && nameOf(found, role) === element.name;
  return same ? found : undefined;
}

/** Where the pin of `target` goes: at its element where the page still has it, else where the target was. */
export function anchor(document: Document, target: Target): Rect | undefined {
  switch (target.kind) {
    case 'element': {
      const found = locate(document, target);
      return found === undefined ? target.rect : rectOf(found);
    }
    case 'region':
      return target.rect;
    case 'canvas': {
      const canvas = canvasNamed(document, target.canvas);
      return canvas === undefined ? undefined : offsetBy(target.rect, rectOf(canvas));
    }
  }
}
