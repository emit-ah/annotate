// What went wrong in the app before an annotation was saved, heard without the app doing anything (ADR-0001): the
// latest console errors and warnings, uncaught errors, unhandled rejections and failed requests, each with its stack
// where it has one, in a ring of MAX_CONSOLE entries. `<meta name="annotate-console" content="off">` turns it off.

import { MAX_CONSOLE, MAX_STACK, MAX_TEXT, type ConsoleEntry, type ConsoleKind } from './model';

/** The HTTP status from which an answer counts as failed. */
const FAILED_STATUS = 400;

/** The ring of the latest entries, newest last. */
export class Diagnostics {
  private readonly entries: ConsoleEntry[] = [];

  /** The entries heard so far, the oldest first. */
  recent(): ConsoleEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  /** Keeps `entry`, and drops the oldest past MAX_CONSOLE. */
  record(entry: Omit<ConsoleEntry, 'time'>): void {
    this.entries.push({ ...entry, time: new Date().toISOString() });
    this.entries.splice(0, Math.max(this.entries.length - MAX_CONSOLE, 0));
  }

  /** Keeps what `values` say, as the console would print them. */
  recordValues(kind: ConsoleKind, values: readonly unknown[]): void {
    const error = values.find((value): value is Error => value instanceof Error);
    const stack = error?.stack === undefined ? undefined : capped(error.stack, MAX_STACK);
    this.record({
      kind,
      message: capped(values.map(inWords).join(' '), MAX_TEXT),
      ...(stack === undefined ? {} : { stack }),
    });
  }

  /** Keeps a request of `method` to `url` that failed with `status`, 0 where no answer came. */
  recordRequest(method: string, url: string, status: number): void {
    const path = pathOf(url);
    this.record({
      kind: 'network',
      message: capped(`${method} ${path} ${status}`, MAX_TEXT),
      method,
      url: path,
      status,
    });
  }
}

/** `text` cut after `max` characters. */
function capped(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max).join('')}…` : text;
}

/** `value` as the console would print it. */
function inWords(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The path of `url` without its query or fragment, which may hold secrets. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url, 'http://local.invalid');
    return parsed.origin === 'http://local.invalid' ? parsed.pathname : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return capped(url.split(/[?#]/)[0] ?? '', MAX_TEXT);
  }
}

/** The URL and method of a fetch's arguments. */
function request(input: RequestInfo | URL, init: RequestInit | undefined): [method: string, url: string] {
  if (input instanceof Request) {
    return [init?.method ?? input.method, input.url];
  }
  return [init?.method ?? 'GET', String(input)];
}

/** Whether `window` says the console is not to be heard. */
export function consoleOff(document: Document): boolean {
  return document.querySelector('meta[name="annotate-console"]')?.getAttribute('content')?.trim() === 'off';
}

/** Hears the console of `window`. */
function hearConsole(diagnostics: Diagnostics, window: Window & typeof globalThis): void {
  const { console } = window;
  for (const kind of ['error', 'warn'] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...values: unknown[]) => {
      diagnostics.recordValues(kind, values);
      original(...values);
    };
  }
  window.addEventListener('error', (event) => diagnostics.recordValues('uncaught', [event.error ?? event.message]));
  window.addEventListener('unhandledrejection', (event) => diagnostics.recordValues('rejection', [event.reason]));
}

/** Hears the requests of `window` that fail, through `fetch` and `XMLHttpRequest`; it gives the fetch it wrapped. */
function hearRequests(diagnostics: Diagnostics, window: Window & typeof globalThis): typeof fetch {
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
    this.addEventListener('loadend', () => {
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
  if (!consoleOff(window.document)) {
    hearConsole(diagnostics, window);
    ownFetch = hearRequests(diagnostics, window);
  }
  const heard = { diagnostics, fetch: ownFetch };
  HEARD.set(window, heard);
  return heard;
}
