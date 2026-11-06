import { describe, expect, it } from "vitest";
import { Api, annotationsIn, outcome, type Fetch } from "../src/api";
import type { NewAnnotation } from "../src/model";

/** A fetch that answers `status` with `body`, and remembers what it was asked. */
function answering(
  status: number,
  body: string,
  asked: [string, RequestInit][] = [],
): Fetch {
  return (input, init) => {
    asked.push([input, init]);
    return Promise.resolve(new Response(body, { status }));
  };
}

describe("the service as the client reads it", () => {
  it("an answer tells whether a service is there and whether to try again", () => {
    expect(outcome(201, "", 201)).toEqual({ ok: true, value: undefined });
    expect(outcome(404, "", 200)).toEqual({ ok: false, failure: "no-service" });
    expect(outcome(503, "", 201)).toEqual({
      ok: false,
      failure: "for-now",
      reason: "HTTP 503",
    });
    // A full service keeps what waits; a login that ran out, or a caller the proxy turns away, is refused.
    expect(outcome(507, '{"detail":"full"}', 201)).toEqual({
      ok: false,
      failure: "for-now",
      reason: "full",
    });
    expect(outcome(401, "", 201)).toEqual({
      ok: false,
      failure: "refused",
      reason: "HTTP 401",
    });
    expect(outcome(403, "", 201)).toMatchObject({ failure: "refused" });
    const problem =
      '{"type":"about:blank","title":"Unprocessable Entity","status":422,"detail":"comment is empty"}';
    expect(outcome(422, problem, 201)).toEqual({
      ok: false,
      failure: "refused",
      reason: "comment is empty",
    });
  });

  it("a list is read as far as it can be, and a page is no list", () => {
    expect(annotationsIn("<!DOCTYPE html><html></html>")).toEqual({
      ok: false,
      failure: "no-service",
    });
    expect(annotationsIn("{}")).toEqual({ ok: false, failure: "no-service" });
    expect(annotationsIn('[{"id": "not an annotation"}]')).toEqual({
      ok: true,
      value: [],
    });
  });

  it("asks for the annotations of its app and page, and sends a new one as JSON", async () => {
    const asked: [string, RequestInit][] = [];
    const api = new Api("/api/v1/annotations", answering(200, "[]", asked));
    expect(await api.page("demo", "/a b")).toEqual({ ok: true, value: [] });
    expect(asked[0]?.[0]).toBe("/api/v1/annotations?app=demo&path=%2Fa+b");
    const creating = new Api(
      "/api/v1/annotations",
      answering(201, "{}", asked),
    );
    expect(await creating.create({ app: "demo" } as NewAnnotation)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(asked[1]?.[1]).toMatchObject({
      method: "POST",
      body: '{"app":"demo"}',
      credentials: "same-origin",
    });
  });

  it("a request that cannot go fails for now", async () => {
    const api = new Api("/api", () => Promise.reject(new TypeError("offline")));
    expect(await api.page("demo", "/")).toEqual({
      ok: false,
      failure: "for-now",
      reason: "TypeError: offline",
    });
  });
});
