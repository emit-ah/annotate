// What went wrong in the app before an annotation was saved, heard without the app doing anything (ADR-0001): the
// latest console errors and warnings, uncaught errors, unhandled rejections and failed requests, each with its stack
// where it has one, in a ring of MAX_CONSOLE entries. `<meta name="annotate-console" content="off">` turns it off.
//
// What it keeps is scrubbed first: queries, Bearer and Basic tokens and `key=value` secrets go, objects are named by
// their keys or kind and never by their values, and a request keeps its path only. Tokens in a path are caught by a
// heuristic, long runs of letters and digits; a secret of another shape in a message stays.

import {
  MAX_CONSOLE,
  MAX_STACK,
  MAX_TEXT,
  MAX_WORD,
  type ConsoleEntry,
  type ConsoleKind,
} from "./model";
import { meta } from "./page";
import { capped } from "./text";

/** The HTTP status from which an answer counts as failed. */
const FAILED_STATUS = 400;

/** What stands for what was scrubbed. */
const REDACTED = "[redacted]";

/** What stands for a token in a path. */
const PATH_TOKEN = ":token";

/** A query in a text: a `?` and what follows it up to white space or a quote, where it has a `=`. */
const QUERY = /\?[^\s"'<>]*/g;

/** A token after `Bearer` or `Basic`. */
const AUTHORIZATION = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/** A `key=value` or `key: value` whose key names a secret. */
const SECRET =
  /\b([\w-]*(?:token|key|code|password|secret)|auth\w*)(\s*[=:]\s*)(?!(?:Bearer|Basic)\b)("[^"]*"|'[^']*'|[^\s&,;]+)/gi;

/** A segment of a path that looks like a token: a long run of letters, digits, `-` and `_` with a digit in it. */
const TOKEN_SEGMENT = /^(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}$/;

/** The schemes whose addresses have a path worth keeping. */
const WEB_SCHEMES = ["http:", "https:"];

/** The base a relative address is read against, which never shows. */
const LOCAL_BASE = "http://local.invalid";

/** `text` without queries, tokens and secrets. */
export function scrubbed(text: string): string {
  return text
    .replace(QUERY, (query) => (query.includes("=") ? "" : query))
    .replace(AUTHORIZATION, `$1 ${REDACTED}`)
    .replace(SECRET, `$1$2${REDACTED}`);
}

/** `value` as the console would print it, but an object by its keys or kind only. */
function inWords(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (typeof value === "object" && value !== null) {
    const kind = Object.getPrototypeOf(value)?.constructor?.name;
    return kind === undefined || kind === "Object"
      ? `{${Object.keys(value).join(", ")}}`
      : String(kind);
  }
  return String(value);
}

/** The path of `url` without its query, its fragment, tokens in it or the content of a `data:` or `blob:` address. */
export function pathOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, LOCAL_BASE);
  } catch {
    return capped(url.split(/[?#]/)[0] ?? "", MAX_TEXT);
  }
  if (!WEB_SCHEMES.includes(parsed.protocol)) {
    return parsed.protocol;
  }
  const path = parsed.pathname
    .split("/")
    .map((segment) => (TOKEN_SEGMENT.test(segment) ? PATH_TOKEN : segment))
    .join("/");
  return capped(
    parsed.origin === LOCAL_BASE ? path : `${parsed.origin}${path}`,
    MAX_TEXT,
  );
}

/** The ring of the latest entries, newest last. */
export class Diagnostics {
  private readonly entries: ConsoleEntry[] = [];

  /** The entries heard so far, the oldest first. */
  recent(): ConsoleEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  /** Keeps `entry`, and drops the oldest past MAX_CONSOLE. */
  private record(entry: Omit<ConsoleEntry, "time">): void {
    this.entries.push({ ...entry, time: new Date().toISOString() });
    this.entries.splice(0, Math.max(this.entries.length - MAX_CONSOLE, 0));
  }

  /** Keeps what `values` say, as the console would print them, scrubbed. */
  recordValues(kind: ConsoleKind, values: readonly unknown[]): void {
    const error = values.find(
      (value): value is Error => value instanceof Error,
    );
    const stack =
      error?.stack === undefined
        ? undefined
        : capped(scrubbed(error.stack), MAX_STACK);
    this.record({
      kind,
      message: capped(scrubbed(values.map(inWords).join(" ")), MAX_TEXT),
      ...(stack === undefined ? {} : { stack }),
    });
  }

  /** Keeps a request of `method` to `url` that failed with `status`, 0 where no answer came. */
  recordRequest(method: string, url: string, status: number): void {
    const path = pathOf(url);
    const verb = capped(method, MAX_WORD);
    this.record({
      kind: "network",
      message: capped(`${verb} ${path} ${status}`, MAX_TEXT),
      method: verb,
      url: path,
      status,
    });
  }
}

/** The URL and method of a fetch's arguments. */
function request(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): [method: string, url: string] {
  if (input instanceof Request) {
    return [init?.method ?? input.method, input.url];
  }
  return [init?.method ?? "GET", String(input)];
}

/** Hears the console of `window`. */
function hearConsole(
  diagnostics: Diagnostics,
  window: Window & typeof globalThis,
): void {
  const pageConsole = window.console;
  for (const kind of ["error", "warn"] as const) {
    const original = pageConsole[kind].bind(pageConsole);
    pageConsole[kind] = (...values: unknown[]) => {
      diagnostics.recordValues(kind, values);
      original(...values);
    };
  }
  window.addEventListener("error", (event) =>
    diagnostics.recordValues("uncaught", [event.error ?? event.message]),
  );
  window.addEventListener("unhandledrejection", (event) =>
    diagnostics.recordValues("rejection", [event.reason]),
  );
}

/** Hears the requests of `window` that fail, through `fetch` and `XMLHttpRequest`; it gives the fetch it wrapped. */
function hearRequests(
  diagnostics: Diagnostics,
  window: Window & typeof globalThis,
): typeof fetch {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const [method, url] = request(input, init);
    try {
      const response = await original(input, init);
      if (response.status >= FAILED_STATUS) {
        diagnostics.recordRequest(method, url, response.status);
      }
      return response;
    } catch (error) {
      diagnostics.recordRequest(method, url, 0);
      throw error;
    }
  };
  const { open } = window.XMLHttpRequest.prototype;
  window.XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.addEventListener("loadend", () => {
      if (this.status === 0 || this.status >= FAILED_STATUS) {
        diagnostics.recordRequest(method, String(url), this.status);
      }
    });
    return Reflect.apply(open, this, [method, url, ...rest]);
  } as typeof open;
  return original;
}

/** What the window's diagnostics are, and the fetch the mode's own requests go through, unheard. */
export interface Heard {
  diagnostics: Diagnostics;
  fetch: typeof fetch;
}

const HEARD = new WeakMap<Window, Heard>();

/** Hears `window` once, unless its page turns it off; the same each time it is asked. */
export function hear(window: Window & typeof globalThis): Heard {
  const known = HEARD.get(window);
  if (known !== undefined) {
    return known;
  }
  const diagnostics = new Diagnostics();
  let ownFetch = window.fetch.bind(window);
  if (meta(window.document, "console") !== "off") {
    hearConsole(diagnostics, window);
    ownFetch = hearRequests(diagnostics, window);
  }
  const heard = { diagnostics, fetch: ownFetch };
  HEARD.set(window, heard);
  return heard;
}
