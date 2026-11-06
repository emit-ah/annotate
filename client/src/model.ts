// What an annotation holds, as the service's OpenAPI document describes it (`crates/annotations`, ADR-0001). A test
// compares these types with `openapi.json`, so the client and the service speak the same JSON.

/** The most characters a comment or an answer has. */
export const MAX_COMMENT = 4_000;
/** The most characters any other text has. */
export const MAX_TEXT = 2_000;
/** The most entries a list has. */
export const MAX_ITEMS = 100;
/** The most bytes a picture has. */
export const MAX_PNG_BYTES = 2_000_000;
/** The most characters an app's name has. */
export const MAX_APP = 64;
/** The most characters a build's version has. */
export const MAX_VERSION = 64;
/** The most bytes the JSON of the app's context has. */
export const MAX_CONTEXT_BYTES = 262_144;
/** The most entries of the console an annotation keeps. */
export const MAX_CONSOLE = 50;
/** The most characters of a stack trace. */
export const MAX_STACK = 4_000;

/** A rectangle in CSS pixels: of the window, or of a canvas for a canvas's items. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The browser's window. */
export interface Viewport {
  width: number;
  height: number;
  pixel_ratio: number;
}

/** A value by its name, such as `zoom` and `180 %`. */
export interface Entry {
  name: string;
  value: string;
}

/** An element of the page, by role, accessible name and the app's text IDs. */
export interface Element {
  role?: string;
  name?: string;
  tag: string;
  text_ids: string[];
  text: string;
  components: string[];
  dom_path: string;
  rect: Rect;
  redacted: boolean;
}

/** One thing a canvas draws, in the app's words. */
export interface Hit {
  kind: string;
  words: string;
  details: Entry[];
}

/** What a canvas draws at a point or in a rectangle. */
export interface CanvasItems {
  canvas: string;
  rect: Rect;
  hits: Hit[];
}

/** A rectangle of the window, with the elements and canvas items it covers. */
export interface Region {
  rect: Rect;
  elements: Element[];
  items: CanvasItems[];
}

/** What an annotation is about. */
export type Target =
  ({ kind: 'element' } & Element) | ({ kind: 'canvas' } & CanvasItems) | ({ kind: 'region' } & Region);

/** What the user wrote, about what, and where. */
export interface AnnotationBody {
  app: string;
  comment: string;
  path: string;
  query: string;
  version: string;
  viewport: Viewport;
  browser: string;
  target: Target;
  state: Entry[];
}

/** What the console said, or a request that failed, before an annotation was saved. */
export type ConsoleKind = 'error' | 'warn' | 'uncaught' | 'rejection' | 'network';

/** One entry of the console, or a request that failed. */
export interface ConsoleEntry {
  kind: ConsoleKind;
  /** When, in UTC, RFC 3339. */
  time: string;
  message: string;
  stack?: string;
  /** A failed request's method, path without its query, and status; 0 where no answer came. */
  method?: string;
  url?: string;
  status?: number;
}

/** A value of JSON. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** An annotation as the client sends it; its pictures are PNG in Base64. */
export interface NewAnnotation extends AnnotationBody {
  crop?: string;
  frame?: string;
  context?: Json;
  console?: ConsoleEntry[];
}

/** Where an annotation stands. */
export type Status = 'open' | 'in_progress' | 'done' | 'wont_do';

/** Every status, in the order of its course. */
export const STATUSES: readonly Status[] = ['open', 'in_progress', 'done', 'wont_do'];

/** An annotation as the service keeps it. */
export interface Annotation extends AnnotationBody {
  id: string;
  created: string;
  updated: string;
  author: string;
  status: Status;
  answer?: string;
  resolved_in?: string;
  has_crop: boolean;
  has_frame: boolean;
  has_context: boolean;
  has_console: boolean;
}

/** Whether `name` names an app: 1 to {@link MAX_APP} lowercase letters, digits, `-` and `_`. */
export function isAppName(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_APP && /^[a-z0-9_-]+$/.test(name);
}

/** Whether `version` names a build: a commit such as `47d97f7+dirty` or a version such as `1.4.0-rc.1`. */
export function isVersion(version: string): boolean {
  return version.length >= 1 && version.length <= MAX_VERSION && /^[A-Za-z0-9._+-]+$/.test(version);
}

/** Whether `value` is a status the service knows. */
export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}
