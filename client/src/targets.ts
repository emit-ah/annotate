// What a pin or a region is about, in the record's words, with the app's hooks: an element by role, name and text
// IDs, what a canvas draws in the app's own words, or a region with the elements and canvas items it covers.

import type { Config } from './config';
import {
  CANVAS,
  REDACTED,
  brief,
  briefOf,
  canvasName,
  canvasOf,
  describe,
  inRegion,
  isOurs,
  isPrivate,
  rectOf,
  textsToLookUp,
} from './describe';
import { say, type Messages } from './messages';
import { MAX_ITEMS, type CanvasItems, type Element as Described, type Rect, type Target } from './model';
import { overlap, relativeTo, type Point } from './place';
import { squeezed } from './text';

/** The most characters of a name in a region's list of names. */
const MAX_LISTED_NAME = 40;

/** The most characters of a page's title in a region's heading. */
const MAX_TITLE = 60;

/** A target and the words the popover heads it with. */
export interface Aimed {
  target: Target;
  heading: string;
  detail: string;
  label?: string;
  anchor: Rect;
}

/** `[role, name]` in a few words, such as "button · Repeat". */
export function wordsOf(messages: Messages, [role, name]: [string, string | undefined]): string {
  return name === undefined ? role : say(messages, 'target', { role, name });
}

/** `element` in a few words, for the outline. */
export function wordsOfElement(messages: Messages, element: Element): string {
  return wordsOf(messages, brief(element));
}

/** `element` in the record's words, with the app's text IDs. */
async function described(config: Config, element: Element): Promise<Described> {
  return describe(element, await config.textIds(textsToLookUp(element)));
}

/** What the canvas `canvas` shows at `rect` in its CSS pixels, by the app's hook; none where it says nothing. */
async function canvasItems(
  config: Config,
  canvas: Element,
  rect: Rect,
  kind: 'point' | 'region',
): Promise<CanvasItems | undefined> {
  const name = canvasName(canvas);
  const hits = await config.canvas({ canvas: name, kind, rect });
  return hits.length === 0 ? undefined : { canvas: name, rect, hits };
}

/** What a pin on `element` at `at`, if a pointer pinned it, is about. */
export async function pinned(
  config: Config,
  messages: Messages,
  element: Element,
  at: Point | undefined,
): Promise<Aimed> {
  const canvas = canvasOf(element);
  if (canvas !== undefined && at !== undefined) {
    const place = rectOf(canvas);
    const point = relativeTo({ x: at[0], y: at[1], width: 0, height: 0 }, place);
    const items = await canvasItems(config, canvas, point, 'point');
    if (items !== undefined) {
      return {
        target: { kind: 'canvas', ...items },
        heading: items.hits[0]?.words ?? items.canvas,
        detail: items.hits
          .slice(1)
          .map((hit) => hit.words)
          .join(', '),
        anchor: { ...point, x: at[0], y: at[1] },
      };
    }
  }
  const record = await described(config, element);
  return {
    target: { kind: 'element', ...record },
    heading: wordsOf(messages, briefOf(record)),
    detail: '',
    anchor: record.rect,
  };
}

/** The names of `elements` in a list, such as `“Today's review”, “Up next”, link`. */
function namesOf(messages: Messages, elements: readonly Described[]): string {
  return elements
    .map((element) =>
      element.name === undefined
        ? (element.role ?? element.tag)
        : say(messages, 'named', { name: squeezed(element.name, MAX_LISTED_NAME) }),
    )
    .join(', ');
}

/** What the canvases of `document` show in `region`, by the app's hook. */
async function canvasesIn(config: Config, document: Document, region: Rect): Promise<CanvasItems[]> {
  const items: CanvasItems[] = [];
  for (const canvas of Array.from(document.querySelectorAll(CANVAS))) {
    const place = rectOf(canvas);
    const covered = isOurs(canvas) || isPrivate(canvas) ? undefined : overlap(region, place);
    const found =
      covered === undefined ? undefined : await canvasItems(config, canvas, relativeTo(covered, place), 'region');
    if (found !== undefined && items.length < MAX_ITEMS) {
      items.push(found);
    }
  }
  return items;
}

/** What a region `rect` of `document` is about. */
export async function regionOf(config: Config, messages: Messages, document: Document, rect: Rect): Promise<Aimed> {
  const elements = await Promise.all(inRegion(document, rect).map((element) => described(config, element)));
  const items = await canvasesIn(config, document, rect);
  const page = squeezed(document.title, MAX_TITLE);
  return {
    target: { kind: 'region', rect, elements, items },
    heading: say(messages, 'regionOn', { page }),
    detail: namesOf(messages, elements),
    label: say(messages, 'region', { count: elements.length }),
    anchor: rect,
  };
}

/** Where the elements the app redacts lie in the window, which pictures paint over. */
export function redactedRects(document: Document): Rect[] {
  return Array.from(document.querySelectorAll(REDACTED))
    .map(rectOf)
    .filter((rect) => rect.width > 0 && rect.height > 0);
}
