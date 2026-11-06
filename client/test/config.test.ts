import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Config,
  DEFAULT_ENDPOINT,
  HOOK_TIMEOUT_MS,
  asContext,
} from "../src/config";
import { MAX_CONTEXT_BYTES, MAX_ITEMS, type NewAnnotation } from "../src/model";

const record = {
  app: "demo",
  comment: "x",
  path: "/",
  version: "1",
  target: { kind: "region" },
} as unknown as NewAnnotation;

beforeEach(() => {
  document.head.innerHTML = `
    <meta name="annotate-app" content="mappa">
    <meta name="annotate-version" content="47d97f7">`;
  document.body.innerHTML = `<main data-annotate-state="vault=demo; zoom=180 %">
    <section data-annotate-redact data-annotate-state="balance=4200"></section>
    <section data-annotate-private><p data-annotate-state="code=alpha"></p></section>
  </main>`;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the app's settings and hooks", () => {
  it("come from meta tags without JavaScript, and configure overrides them", async () => {
    const config = new Config();
    expect(config.app(document)).toBe("mappa");
    expect(await config.version(document)).toBe("47d97f7");
    expect(await config.state(document)).toEqual([
      { name: "vault", value: "demo" },
      { name: "zoom", value: "180 %" },
    ]);
    config.configure({
      app: "tutti",
      version: () => "abc1234",
      endpoint: "/annotate/api",
      state: () => ({ piece: "Ode" }),
    });
    expect(config.app(document)).toBe("tutti");
    expect(await config.version(document)).toBe("abc1234");
    expect((await config.state(document)).at(-1)).toEqual({
      name: "piece",
      value: "Ode",
    });
  });

  it("keep the state of what the app redacts out, and at most the service's count of entries", async () => {
    const config = new Config();
    expect((await config.state(document)).map((entry) => entry.name)).toEqual([
      "vault",
      "zoom",
    ]);
    config.register("state", () =>
      Object.fromEntries(
        Array.from({ length: MAX_ITEMS }, (_, i) => [`n${i}`, i]),
      ),
    );
    expect(await config.state(document)).toHaveLength(MAX_ITEMS);
  });

  it("take the service on the page's own host only", () => {
    const config = new Config();
    expect(config.endpoint(document)).toBe(DEFAULT_ENDPOINT);
    config.configure({ endpoint: "/annotate/api" });
    expect(config.endpoint(document)).toBe("/annotate/api");
    config.configure({
      endpoint: `${window.location.origin}/api/v1/annotations`,
    });
    expect(config.endpoint(document)).toBe("/api/v1/annotations");
    for (const foreign of [
      "https://annotations.example/api",
      "//annotations.example/api",
    ]) {
      config.configure({ endpoint: foreign });
      expect(config.endpoint(document)).toBeUndefined();
    }
  });

  it("keep the names of the page's query parameters, and the values of those the app allows", () => {
    const config = new Config();
    expect(config.queryKept(document)).toEqual([]);
    document.head.insertAdjacentHTML(
      "beforeend",
      '<meta name="annotate-query" content="tab, view">',
    );
    expect(config.queryKept(document)).toEqual(["tab", "view"]);
    config.configure({ query: ["zoom"] });
    expect(config.queryKept(document)).toEqual(["zoom"]);
  });

  it("take hooks by name and refuse unknown names", async () => {
    const config = new Config();
    config.register("textIds", (texts: string[]) =>
      texts.map((text) => `id-${text}`),
    );
    expect(await config.textIds(["Save"])).toEqual(["id-Save"]);
    config.register("canvas", () => ({
      hits: [{ kind: "card", words: "note card c1" }],
    }));
    expect(
      await config.canvas({
        canvas: "map",
        kind: "point",
        rect: { x: 0, y: 0, width: 0, height: 0 },
      }),
    ).toHaveLength(1);
    expect(() => config.register("describe", () => [])).toThrow(
      /has no hook describe/,
    );
    expect(() =>
      config.register("state", "state" as unknown as () => unknown),
    ).toThrow(/no function/);
  });

  it("count a hook that throws or takes too long as absent", async () => {
    vi.useFakeTimers();
    const config = new Config();
    config.register("textIds", () => {
      throw new Error("broken");
    });
    expect(await config.textIds(["Save"])).toEqual([]);
    config.register("canvas", () => new Promise(() => undefined));
    const late = config.canvas({
      canvas: "map",
      kind: "point",
      rect: { x: 0, y: 0, width: 0, height: 0 },
    });
    await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT_MS + 1);
    expect(await late).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("fail closed where they guard privacy", async () => {
    const config = new Config();
    expect(await config.redact(record)).toBe(record);
    expect(await config.pictures()).toBe(true);
    config.register("redact", () => {
      throw new Error("broken");
    });
    config.register("pictures", () => {
      throw new Error("broken");
    });
    expect(await config.redact(record)).toBeNull();
    expect(await config.pictures()).toBe(false);
    config.register("redact", (given: NewAnnotation) => ({
      ...given,
      comment: "redacted",
    }));
    expect((await config.redact(record))?.comment).toBe("redacted");
    config.register("redact", () => null);
    expect(await config.redact(record)).toBeNull();
    config.register("redact", () => "yes");
    expect(await config.redact(record)).toBeNull();
    config.register("pictures", () => "yes");
    expect(await config.pictures()).toBe(false);
  });

  it("carry a context as JSON within its limit, and say so where it is larger", async () => {
    const config = new Config();
    expect(await config.context()).toBeUndefined();
    config.register("context", () => ({ turns: [{ tool: "search", ms: 12 }] }));
    expect(await config.context()).toEqual({
      turns: [{ tool: "search", ms: 12 }],
    });
    expect(asContext({ trace: "x".repeat(MAX_CONTEXT_BYTES) })).toEqual({
      omitted: `the context has ${MAX_CONTEXT_BYTES + 12} bytes, more than ${MAX_CONTEXT_BYTES}`,
    });
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    config.register("context", () => cycle);
    expect(await config.context()).toBeUndefined();
  });

  it("carry the console unless the page or the app turns it off", () => {
    const config = new Config();
    expect(config.console(document)).toBe(true);
    config.configure({ console: false });
    expect(config.console(document)).toBe(false);
    document.head.innerHTML = '<meta name="annotate-console" content="off">';
    expect(new Config().console(document)).toBe(false);
  });
});
