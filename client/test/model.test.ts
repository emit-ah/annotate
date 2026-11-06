// @vitest-environment node
// The client's types and the service's OpenAPI document describe the same JSON: each sample below has every field
// of its type (TypeScript checks that through `Required`), and the test compares those fields with the document's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONSOLE_KINDS,
  MAX_APP,
  MAX_COMMENT,
  MAX_CONSOLE,
  MAX_ITEMS,
  MAX_STACK,
  MAX_TEXT,
  MAX_VERSION,
  MAX_WORD,
  STATUSES,
  isAppName,
  isVersion,
  type Annotation,
  type AnnotationBody,
  type CanvasItems,
  type ConsoleEntry,
  type Element,
  type Entry,
  type Hit,
  type NewAnnotation,
  type Rect,
  type Region,
  type Viewport,
} from "../src/model";

type Schema = {
  properties?: Record<string, unknown>;
  allOf?: Schema[];
  enum?: string[];
  $ref?: string;
};
const document = JSON.parse(
  readFileSync(
    new URL("../../crates/annotations-server/openapi.json", import.meta.url),
    "utf8",
  ),
) as { components: { schemas: Record<string, Schema> } };

/** The fields of the schema `name`, those of the schemas it is made of included. */
function fieldsOf(name: string): string[] {
  const of = (schema: Schema): string[] => [
    ...Object.keys(schema.properties ?? {}),
    ...(schema.allOf ?? []).flatMap((part) =>
      part.$ref === undefined
        ? of(part)
        : fieldsOf(part.$ref.split("/").at(-1) ?? ""),
    ),
  ];
  const schema = document.components.schemas[name];
  if (schema === undefined) {
    throw new Error(`openapi.json has no schema ${name}`);
  }
  return of(schema).sort();
}

/** The `keyword` of the field `field` of the schema `name`, or of its items. */
function limitOf(name: string, field: string, keyword: string): unknown {
  const schema = document.components.schemas[name];
  const properties =
    schema?.properties ??
    schema?.allOf?.find((part) => part.properties !== undefined)?.properties;
  const property = properties?.[field] as Record<string, unknown> | undefined;
  const items = property?.["items"] as Record<string, unknown> | undefined;
  return property?.[keyword] ?? items?.[keyword];
}

const rect: Required<Rect> = { x: 0, y: 0, width: 1, height: 1 };
const viewport: Required<Viewport> = { width: 1, height: 1, pixel_ratio: 1 };
const entry: Required<Entry> = { name: "n", value: "v" };
const hit: Required<Hit> = { kind: "card", words: "w", details: [entry] };
const canvas: Required<CanvasItems> = { canvas: "map", rect, hits: [hit] };
const element: Required<Element> = {
  role: "button",
  name: "Save",
  tag: "button",
  text_ids: [],
  text: "",
  components: [],
  dom_path: "body",
  rect,
  redacted: false,
};
const region: Required<Region> = { rect, elements: [element], items: [canvas] };
const body: Required<AnnotationBody> = {
  app: "demo",
  comment: "c",
  path: "/",
  query: "",
  version: "1",
  viewport,
  browser: "b",
  target: { kind: "region", ...region },
  state: [entry],
};
const consoleEntry: Required<ConsoleEntry> = {
  kind: "network",
  time: "t",
  message: "m",
  stack: "s",
  method: "GET",
  url: "/",
  status: 500,
};
const created: Required<NewAnnotation> = {
  ...body,
  crop: "",
  frame: "",
  context: null,
  console: [consoleEntry],
};
const kept: Required<Annotation> = {
  ...body,
  id: "i",
  created: "t",
  updated: "t",
  author: "a",
  status: "open",
  answer: "a",
  resolved_in: "c",
  has_crop: false,
  has_frame: false,
  has_context: false,
  has_console: false,
};

describe("the client's types are the service's", () => {
  it.each([
    ["Rect", rect],
    ["Viewport", viewport],
    ["Entry", entry],
    ["Hit", hit],
    ["CanvasItems", canvas],
    ["Element", element],
    ["Region", region],
    ["AnnotationBody", body],
    ["ConsoleEntry", consoleEntry],
    ["NewAnnotation", created],
    ["Annotation", kept],
  ])("%s has the same fields", (name, sample) => {
    expect(Object.keys(sample).sort()).toEqual(fieldsOf(name));
  });

  it("a status and a console entry’s kind have the same names", () => {
    expect(document.components.schemas["Status"]?.enum).toEqual([...STATUSES]);
    expect(document.components.schemas["ConsoleKind"]?.enum).toEqual([
      ...CONSOLE_KINDS,
    ]);
  });

  it.each([
    ["AnnotationBody", "app", "maxLength", MAX_APP],
    ["AnnotationBody", "comment", "maxLength", MAX_COMMENT],
    ["AnnotationBody", "version", "maxLength", MAX_VERSION],
    ["AnnotationBody", "path", "maxLength", MAX_TEXT],
    ["AnnotationBody", "state", "maxItems", MAX_ITEMS],
    ["NewAnnotation", "console", "maxItems", MAX_CONSOLE],
    ["ConsoleEntry", "stack", "maxLength", MAX_STACK],
    ["ConsoleEntry", "method", "maxLength", MAX_WORD],
    ["Element", "dom_path", "maxLength", MAX_TEXT],
  ])("%s.%s has the service’s %s", (name, field, keyword, most) => {
    expect(limitOf(name, field, keyword)).toBe(most);
  });

  it("an app and a version are named as the service takes them", () => {
    expect(isAppName("mappa")).toBe(true);
    expect(isAppName("Mappa")).toBe(false);
    expect(isVersion("47d97f7+dirty")).toBe(true);
    expect(isVersion("main branch")).toBe(false);
  });
});
