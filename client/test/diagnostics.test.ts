import { describe, expect, it, vi } from "vitest";
import { Diagnostics, hear, pathOf, scrubbed } from "../src/diagnostics";
import { MAX_CONSOLE, MAX_STACK, MAX_TEXT, MAX_WORD } from "../src/model";

describe("what went wrong before an annotation", () => {
  it("keeps the latest entries in a ring", () => {
    const diagnostics = new Diagnostics();
    for (let index = 0; index < MAX_CONSOLE + 5; index += 1) {
      diagnostics.recordValues("warn", [`warning ${index}`]);
    }
    const recent = diagnostics.recent();
    expect(recent).toHaveLength(MAX_CONSOLE);
    expect(recent[0]?.message).toBe("warning 5");
    expect(recent[0]?.time).toMatch(/Z$/);
  });

  it("keeps an error with its stack, both within the service's limits", () => {
    const diagnostics = new Diagnostics();
    const error = new TypeError("x".repeat(MAX_TEXT + 10));
    error.stack = "s".repeat(MAX_STACK + 10);
    diagnostics.recordValues("error", ["failed:", error]);
    const [entry] = diagnostics.recent();
    expect(entry?.message.startsWith("failed: TypeError: xxx")).toBe(true);
    expect(Array.from(entry?.message ?? "").length).toBeLessThanOrEqual(
      MAX_TEXT,
    );
    expect(Array.from(entry?.stack ?? "").length).toBeLessThanOrEqual(
      MAX_STACK,
    );
  });

  it("names objects by their keys or kind, never by their values", () => {
    const diagnostics = new Diagnostics();
    class Card {
      title = "Tax return 2026";
    }
    diagnostics.recordValues("warn", [
      "saving",
      { title: "Rent", amount: 1200 },
      new Card(),
      [1, 2, 3],
      null,
      7,
    ]);
    expect(diagnostics.recent()[0]?.message).toBe(
      "saving {title, amount} Card Array(3) null 7",
    );
  });

  it("scrubs queries, tokens and secrets from what the console says", () => {
    expect(
      scrubbed("GET https://api.example/cards?id=4&token=abc failed"),
    ).toBe("GET https://api.example/cards failed");
    expect(scrubbed("sent Authorization: Bearer eyJhbGciOi.x.y now")).toBe(
      "sent Authorization: Bearer [redacted] now",
    );
    expect(scrubbed("basic dXNlcjpwYXNz")).toBe("basic [redacted]");
    expect(
      scrubbed("password=hunter2, api_key: 'k-123' authToken=xyz code=7"),
    ).toBe(
      "password=[redacted], api_key: [redacted] authToken=[redacted] code=[redacted]",
    );
    expect(scrubbed("Why? The keyboard=US layout")).toBe(
      "Why? The keyboard=US layout",
    );
    const diagnostics = new Diagnostics();
    diagnostics.recordValues("error", [
      new Error("fetch /x?session=1 failed with token=abc"),
    ]);
    expect(diagnostics.recent()[0]?.message).toBe(
      "Error: fetch /x failed with token=[redacted]",
    );
  });

  it("names a failed request by its path, never its query, a token in it or a data URL's content", () => {
    expect(pathOf("/api/cards?token=secret#x")).toBe("/api/cards");
    expect(pathOf("https://example.org/a/b?c=d")).toBe(
      "https://example.org/a/b",
    );
    expect(pathOf("/reset/4f9c2a7e1b8d4c6fa0e3b5d7c9e1f2a3/confirm")).toBe(
      "/reset/:token/confirm",
    );
    expect(pathOf("/cards/42")).toBe("/cards/42");
    expect(pathOf("data:text/plain;base64,c2VjcmV0")).toBe("data:");
    expect(pathOf("blob:https://example.org/5b0e")).toBe("blob:");
    const diagnostics = new Diagnostics();
    diagnostics.recordRequest("POST", "/save?key=1", 500);
    diagnostics.recordRequest(
      "x".repeat(MAX_WORD + 5),
      `/${"a".repeat(MAX_TEXT)}`,
      0,
    );
    const [saved, long] = diagnostics.recent();
    expect(saved).toMatchObject({
      kind: "network",
      method: "POST",
      url: "/save",
      status: 500,
      message: "POST /save 500",
    });
    expect(Array.from(long?.method ?? "").length).toBeLessThanOrEqual(MAX_WORD);
    expect(Array.from(long?.url ?? "").length).toBeLessThanOrEqual(MAX_TEXT);
  });

  it("hears the window's console and fetches once, and leaves its own fetch unheard", async () => {
    const fetches: string[] = [];
    const window = {
      console: { error: vi.fn(), warn: vi.fn() },
      document,
      addEventListener: vi.fn(),
      fetch: (input: string) => {
        fetches.push(input);
        return Promise.resolve(
          new Response("", { status: input === "/bad" ? 500 : 200 }),
        );
      },
      XMLHttpRequest: class {
        open(): void {}
      },
    } as unknown as Window & typeof globalThis;
    const heard = hear(window);
    expect(hear(window)).toBe(heard);
    window.console.error("boom");
    await window.fetch("/bad");
    await window.fetch("/good");
    await heard.fetch("/own");
    expect(heard.diagnostics.recent().map((entry) => entry.message)).toEqual([
      "boom",
      "GET /bad 500",
    ]);
    expect(fetches).toEqual(["/bad", "/good", "/own"]);
  });

  it("hears nothing where the page turns it off", () => {
    document.head.innerHTML = '<meta name="annotate-console" content="off">';
    const error = vi.fn();
    const window = {
      console: { error, warn: vi.fn() },
      document,
      fetch: vi.fn(),
    } as unknown as Window & typeof globalThis;
    hear(window);
    expect(window.console.error).toBe(error);
    document.head.innerHTML = "";
  });
});
