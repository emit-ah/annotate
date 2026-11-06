// What the host app tells the mode (ADR-0001): its name, its version and the service's address, from `<meta>` tags
// or `configure`, and its hooks, plain functions over JSON-serialisable data that any language can register through
// `window.annotate`. A hook that throws or takes too long counts as absent; `redact` and `pictures` fail closed.

import { isRedacted } from "./describe";
import {
  MAX_CONTEXT_BYTES,
  MAX_ITEMS,
  type Entry,
  type Hit,
  type Json,
  type NewAnnotation,
  type Rect,
} from "./model";
import { meta } from "./page";
import { asEntries, asHits, asText, asTexts, isRecord } from "./text";
import type { Messages } from "./messages";

/** Where the service answers on the app's own host, unless the app names another path. */
export const DEFAULT_ENDPOINT = "/api/v1/annotations";

/** The milliseconds a hook may take before it counts as absent, or as a denial where it guards privacy. */
export const HOOK_TIMEOUT_MS = 3_000;

/** What the canvas hook is asked: which canvas, and the point or rectangle in its CSS pixels. */
export interface CanvasQuery {
  canvas: string;
  kind: "point" | "region";
  rect: Rect;
}

/** The hooks an app may register; each takes and gives JSON-serialisable data, or a promise of it. */
export interface Hooks {
  /** The commit or version of the build. */
  version?: () => unknown;
  /** What a canvas shows at a point or in a rectangle: hits of `{kind, words, details}`, or `{hits}`. */
  canvas?: (query: CanvasQuery) => unknown;
  /** The app's IDs of the texts an element shows. */
  textIds?: (texts: string[]) => unknown;
  /** The view's state: a list of `{name, value}` or an object of names and values. */
  state?: () => unknown;
  /** The record to keep, changed as the app wants, or `null` to keep none. */
  redact?: (record: NewAnnotation) => unknown;
  /** Whether pictures of the tab may be taken now. */
  pictures?: () => unknown;
  /** What the app attaches to an annotation as it is saved, such as a trace of its last steps, as JSON. */
  context?: () => unknown;
}

/** The name of a hook, as `register` takes it. */
export type HookName = keyof Hooks;

/** Every hook's name. */
const HOOK_NAMES: readonly HookName[] = [
  "version",
  "canvas",
  "textIds",
  "state",
  "redact",
  "pictures",
  "context",
];

/** What `configure` takes: settings beside the hooks; `version` may be a text or a hook. */
export interface Options extends Omit<Hooks, "version"> {
  app?: string;
  endpoint?: string;
  version?: string | (() => unknown);
  messages?: Partial<Messages>;
  /** Whether annotations carry the console's latest errors and failed requests; they do unless this is `false`. */
  console?: boolean;
  /** The query parameters whose values an annotation keeps; of the others it keeps the names only. */
  query?: string[];
}

/** Whether `name` names a hook. */
export function isHookName(name: string): name is HookName {
  return (HOOK_NAMES as readonly string[]).includes(name);
}

/** What `hook` gives for `args` within {@link HOOK_TIMEOUT_MS}; it throws where the hook throws or takes longer. */
async function call<A extends unknown[]>(
  name: string,
  hook: (...args: A) => unknown,
  ...args: A
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`the ${name} hook took longer than ${HOOK_TIMEOUT_MS} ms`),
        ),
      HOOK_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => hook(...args)),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** What `hook` gives, or `fallback` where there is no hook or it fails, which the console hears of. */
async function tryHook<A extends unknown[], T>(
  name: string,
  hook: ((...args: A) => unknown) | undefined,
  read: (value: unknown) => T,
  fallback: T,
  ...args: A
): Promise<T> {
  if (hook === undefined) {
    return fallback;
  }
  try {
    return read(await call(name, hook, ...args));
  } catch (error) {
    console.warn(`annotate: the ${name} hook failed`, error);
    return fallback;
  }
}

/** The facts of `data-annotate-state` attributes outside what the app redacts: `name=value` pairs separated by `;`. */
function stateOfAttributes(document: Document): Entry[] {
  const pairs: Record<string, string> = {};
  const stated = Array.from(
    document.querySelectorAll("[data-annotate-state]"),
  ).filter((element) => !isRedacted(element));
  for (const element of stated) {
    for (const pair of (
      element.getAttribute("data-annotate-state") ?? ""
    ).split(";")) {
      const [name, ...value] = pair.split("=");
      if (name !== undefined && name.trim() !== "") {
        pairs[name.trim()] = value.join("=").trim();
      }
    }
  }
  return asEntries(pairs);
}

/** `value` as a record the redact hook gave back: an object with the record's main fields; else none. */
function asRecord(value: unknown): NewAnnotation | null {
  const fields = ["app", "comment", "path", "version"];
  if (
    !isRecord(value) ||
    !fields.every((field) => typeof value[field] === "string") ||
    !isRecord(value["target"])
  ) {
    return null;
  }
  // The service checks every field and limit; the client sends what the app gave as JSON.
  return JSON.parse(JSON.stringify(value)) as NewAnnotation;
}

/**
 * `value` as JSON of at most {@link MAX_CONTEXT_BYTES} bytes; where it is larger, a note of its size instead. It throws
 * where `value` is no JSON, as a cycle or a BigInt.
 */
export function asContext(value: unknown): Json | undefined {
  if (value === undefined) {
    return undefined;
  }
  const json = JSON.stringify(value);
  if (json === undefined) {
    return undefined;
  }
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_CONTEXT_BYTES) {
    console.warn(
      `annotate: the context has ${bytes} bytes, more than ${MAX_CONTEXT_BYTES}, and is left out`,
    );
    return {
      omitted: `the context has ${bytes} bytes, more than ${MAX_CONTEXT_BYTES}`,
    };
  }
  return JSON.parse(json) as Json;
}

/** The app's settings and hooks. */
export class Config {
  private options: Options = {};

  /** Takes `options` over those given before. */
  configure(options: Options): void {
    this.options = { ...this.options, ...options };
  }

  /** Sets the hook `name` to `hook`, or removes it where `hook` is none. */
  register(
    name: string,
    hook: ((...args: never[]) => unknown) | undefined,
  ): void {
    if (!isHookName(name)) {
      throw new TypeError(
        `annotate has no hook ${name}; it has ${HOOK_NAMES.join(", ")}`,
      );
    }
    if (hook !== undefined && typeof hook !== "function") {
      throw new TypeError(`the ${name} hook is no function`);
    }
    this.options = { ...this.options, [name]: hook };
  }

  /** The app's name, from `configure` or `<meta name="annotate-app">`. */
  app(document: Document): string | undefined {
    return this.options.app ?? meta(document, "app");
  }

  /**
   * The service's path on the page's own host, from `configure` or `<meta name="annotate-endpoint">`, else
   * {@link DEFAULT_ENDPOINT}; none where it names another host, which the mode does not send to.
   */
  endpoint(document: Document): string | undefined {
    const given =
      this.options.endpoint ?? meta(document, "endpoint") ?? DEFAULT_ENDPOINT;
    const resolved = new URL(given, document.baseURI);
    return resolved.origin === new URL(document.baseURI).origin
      ? `${resolved.pathname}${resolved.search}`
      : undefined;
  }

  /** The query parameters whose values an annotation keeps, from `configure` or `<meta name="annotate-query">`. */
  queryKept(document: Document): string[] {
    const listed =
      meta(document, "query")
        ?.split(",")
        .map((name) => name.trim()) ?? [];
    return (this.options.query ?? listed).filter((name) => name !== "");
  }

  /** The build's version, from `configure`, its hook or `<meta name="annotate-version">`. */
  async version(document: Document): Promise<string | undefined> {
    const { version } = this.options;
    if (typeof version === "string") {
      return version;
    }
    const given = await tryHook("version", version, asText, undefined);
    return given ?? meta(document, "version");
  }

  /** The app's text IDs for `texts`; none without its hook. */
  async textIds(texts: string[]): Promise<string[]> {
    return texts.length === 0
      ? []
      : tryHook("textIds", this.options.textIds, asTexts, [], texts);
  }

  /** What the canvas shows for `query`, in the app's words; none without its hook. */
  async canvas(query: CanvasQuery): Promise<Hit[]> {
    const read = (value: unknown): Hit[] =>
      asHits(isRecord(value) ? value["hits"] : value);
    return tryHook("canvas", this.options.canvas, read, [], query);
  }

  /** The view's state: the page's `data-annotate-state` facts, then the hook's, at most {@link MAX_ITEMS}. */
  async state(document: Document): Promise<Entry[]> {
    const given = await tryHook("state", this.options.state, asEntries, []);
    return [...stateOfAttributes(document), ...given].slice(0, MAX_ITEMS);
  }

  /** The record to keep of `record`, as the app redacts it; none where the app denies it or its hook fails. */
  async redact(record: NewAnnotation): Promise<NewAnnotation | null> {
    const { redact } = this.options;
    return redact === undefined
      ? record
      : tryHook("redact", redact, asRecord, null, record);
  }

  /** Whether pictures may be taken now; not where the app's hook says no or fails. */
  async pictures(): Promise<boolean> {
    const { pictures } = this.options;
    return (
      pictures === undefined ||
      tryHook("pictures", pictures, (value) => value === true, false)
    );
  }

  /** What the app attaches as context, as JSON; none without its hook or where it fails. */
  async context(): Promise<Json | undefined> {
    return tryHook("context", this.options.context, asContext, undefined);
  }

  /** Whether annotations carry the console's latest errors and failed requests. */
  console(document: Document): boolean {
    return (
      this.options.console !== false && meta(document, "console") !== "off"
    );
  }

  /** The texts the app gives instead of the mode's own. */
  messages(): Partial<Messages> {
    return this.options.messages ?? {};
  }
}
