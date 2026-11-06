import { beforeEach, describe, expect, it, vi } from "vitest";
import { Config } from "../src/config";
import { ENGLISH } from "../src/messages";
import { COVER_MARGIN, pinned, redactedRects } from "../src/targets";

/** Gives `element` the box at `x`, `y` of `width` by `height`, as jsdom lays nothing out. */
function box(
  element: Element | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (element === null || element === undefined) {
    throw new Error("no element");
  }
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x,
    y,
    width,
    height,
  } as DOMRect);
}

beforeEach(() => {
  document.body.innerHTML = `
    <canvas id="map" data-annotate-canvas="map"></canvas>
    <section data-annotate-redact><canvas id="vault" data-annotate-canvas="vault"></canvas></section>
    <div id="widget"></div>`;
});

describe("what a pin is about", () => {
  it("is what the app names on a canvas, in the app's words", async () => {
    const config = new Config();
    config.register("canvas", () => [
      { kind: "card", words: "note card “Rent”", details: { id: "c1" } },
    ]);
    const canvas = document.getElementById("map");
    box(canvas, 10, 10, 100, 100);
    const aimed = await pinned(config, ENGLISH, canvas as Element, [30, 40]);
    expect(aimed.target).toMatchObject({
      kind: "canvas",
      canvas: "map",
      rect: { x: 20, y: 30, width: 0, height: 0 },
      hits: [
        {
          kind: "card",
          words: "note card “Rent”",
          details: [{ name: "id", value: "c1" }],
        },
      ],
    });
  });

  it("is only the kind of what a redacted canvas shows", async () => {
    const config = new Config();
    config.register("canvas", () => [
      { kind: "card", words: "note card “Rent”", details: { id: "c1" } },
    ]);
    const canvas = document.getElementById("vault");
    box(canvas, 0, 0, 100, 100);
    const aimed = await pinned(config, ENGLISH, canvas as Element, [5, 5]);
    expect(aimed.target).toMatchObject({
      kind: "canvas",
      hits: [{ kind: "card", words: "card", details: [] }],
    });
    expect(JSON.stringify(aimed)).not.toContain("Rent");
  });
});

describe("what pictures paint over", () => {
  it("is every redacted element, in open shadow roots too, with a margin", () => {
    const section = document.querySelector("section");
    box(section, 10, 20, 30, 40);
    const root = document
      .getElementById("widget")
      ?.attachShadow({ mode: "open" });
    root
      ?.appendChild(document.createElement("p"))
      .setAttribute("data-annotate-private", "");
    box(root?.querySelector("p"), 100, 100, 10, 10);
    expect(redactedRects(document)).toEqual([
      {
        x: 10 - COVER_MARGIN,
        y: 20 - COVER_MARGIN,
        width: 30 + 2 * COVER_MARGIN,
        height: 40 + 2 * COVER_MARGIN,
      },
      {
        x: 100 - COVER_MARGIN,
        y: 100 - COVER_MARGIN,
        width: 10 + 2 * COVER_MARGIN,
        height: 10 + 2 * COVER_MARGIN,
      },
    ]);
  });
});
