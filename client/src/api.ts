// The annotation service's API (ADR-0001), on the app's own host under `/api/v1/annotations` unless the app names
// another path; where nothing answers there with JSON, the mode says no service is there.

import { isStatus, type Annotation, type NewAnnotation } from "./model";
import { isRecord } from "./text";

/**
 * How long a request for annotations may take before it stops and counts as failed for now, as a service that takes
 * it and never answers would otherwise keep the mode waiting.
 */
const READ_TIMEOUT_MS = 10_000;

/**
 * How long an annotation, with its pictures of up to some megabytes, may take to go; stopped then, it waits in the
 * outbox and goes again.
 */
const SEND_TIMEOUT_MS = 60_000;

/** The HTTP statuses the client tells apart. */
const OK = 200;
const CREATED = 201;
const NOT_FOUND = 404;
/** The statuses of a request the service, or its proxy, would refuse again: unreadable, without a valid login, not
 * allowed, too large, or breaking a limit. */
const REFUSED = [400, 401, 403, 413, 422];

/** Why a request came to nothing. */
export type Failure =
  /** No annotation service answers here, as on a host without one. */
  | { failure: "no-service" }
  /** The service or the way to it failed for now, so the request may go again. */
  | { failure: "for-now"; reason: string }
  /** The service refused it, for the reason given, so the same request fails again. */
  | { failure: "refused"; reason: string };

/** What a request gives: its value or why it failed. */
export type Outcome<T> = { ok: true; value: T } | ({ ok: false } & Failure);

/** The status and text of an answer, as the API reads it. */
interface Answer {
  status: number;
  text: string;
}

/** A function that fetches as the browser's `fetch` does. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** The detail of the problem in `text`, else the status. */
function detail(text: string, status: number): string {
  try {
    const problem: unknown = JSON.parse(text);
    if (isRecord(problem) && typeof problem["detail"] === "string") {
      return problem["detail"];
    }
  } catch {
    // An answer that is no problem in JSON, such as a proxy's page, is named by its status.
  }
  return `HTTP ${status}`;
}

/**
 * What the answer `status` with `text` means, given that `expected` is its status of success: a request the service
 * could not read, would not keep, or that its proxy turns away is refused; whatever else fails, such as a service
 * starting or full, fails for now. The app's static server answers `/api/` with 404 where no service routes before it.
 */
export function outcome(
  status: number,
  text: string,
  expected: number,
): Outcome<undefined> {
  if (status === expected) {
    return { ok: true, value: undefined };
  }
  if (status === NOT_FOUND) {
    return { ok: false, failure: "no-service" };
  }
  if (REFUSED.includes(status)) {
    return { ok: false, failure: "refused", reason: detail(text, status) };
  }
  return { ok: false, failure: "for-now", reason: detail(text, status) };
}

/** Whether `value` reads as an annotation the service kept: its own fields and a target. */
function isAnnotation(value: unknown): value is Annotation {
  if (
    !isRecord(value) ||
    !isRecord(value["target"]) ||
    !isStatus(value["status"])
  ) {
    return false;
  }
  const texts = [
    "id",
    "created",
    "author",
    "app",
    "comment",
    "path",
    "version",
  ];
  return texts.every((field) => typeof value[field] === "string");
}

/** The annotations in the JSON `text`, those it can read; no service where it is no list, as the app's own page. */
export function annotationsIn(text: string): Outcome<Annotation[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, failure: "no-service" };
  }
  return Array.isArray(parsed)
    ? { ok: true, value: parsed.filter(isAnnotation) }
    : { ok: false, failure: "no-service" };
}

/** The service at `endpoint`, reached through `fetch`. */
export class Api {
  constructor(
    private readonly endpoint: string,
    private readonly fetch: Fetch,
  ) {}

  /** Sends `method` with the JSON `body`, if any, and stops it after `timeoutMs`, which fails for now. */
  private async send(
    method: string,
    url: string,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<Outcome<Answer>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    try {
      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
        credentials: "same-origin",
      };
      const response = await this.fetch(
        url,
        body === undefined ? init : { ...init, body },
      );
      return {
        ok: true,
        value: { status: response.status, text: await response.text() },
      };
    } catch (error) {
      return { ok: false, failure: "for-now", reason: String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** The annotations of `app` on the page at `path`, the newest first. */
  async page(app: string, path: string): Promise<Outcome<Annotation[]>> {
    const query = new URLSearchParams({ app, path });
    const answer = await this.send(
      "GET",
      `${this.endpoint}?${query.toString()}`,
      undefined,
      READ_TIMEOUT_MS,
    );
    if (!answer.ok) {
      return answer;
    }
    const read = outcome(answer.value.status, answer.value.text, OK);
    return read.ok ? annotationsIn(answer.value.text) : read;
  }

  /** Gives `annotation` to the service, which keeps it. */
  async create(annotation: NewAnnotation): Promise<Outcome<undefined>> {
    const answer = await this.send(
      "POST",
      this.endpoint,
      JSON.stringify(annotation),
      SEND_TIMEOUT_MS,
    );
    return answer.ok
      ? outcome(answer.value.status, answer.value.text, CREATED)
      : answer;
  }
}
