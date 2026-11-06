// Texts as the record keeps them, and the guards that make a host's answers, which may come from any language
// through JSON, into the record's types.

import { MAX_ITEMS, MAX_TEXT, type Entry, type Hit } from "./model";

/** The mark that ends a text cut short. */
const ELLIPSIS = "…";

/** `text` cut to at most `max` characters, its last one the mark of the cut where it was longer. */
export function capped(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length > max
    ? `${characters.slice(0, max - 1).join("")}${ELLIPSIS}`
    : text;
}

/** `text` with its runs of white space made one space and cut to at most `max` characters. */
export function squeezed(text: string, max: number): string {
  return capped(
    text
      .split(/\s+/)
      .filter((word) => word !== "")
      .join(" "),
    max,
  );
}

/** `value` as a text of the record: a string, number or boolean in words, cut to {@link MAX_TEXT}; else none. */
export function asText(value: unknown): string | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return squeezed(String(value), MAX_TEXT);
  }
  return undefined;
}

/** Whether `value` is an object, such as JSON's, rather than a list or a value. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` as texts: each text of a list, at most {@link MAX_ITEMS}. */
export function asTexts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(asText)
    .filter((text): text is string => text !== undefined && text !== "")
    .slice(0, MAX_ITEMS);
}

/**
 * `value` as entries: a list of `{name, value}` or an object of names and values, at most {@link MAX_ITEMS}; what is
 * neither gives none.
 */
export function asEntries(value: unknown): Entry[] {
  const pairs: [unknown, unknown][] = Array.isArray(value)
    ? value.filter(isRecord).map((entry) => [entry["name"], entry["value"]])
    : isRecord(value)
      ? Object.entries(value)
      : [];
  const entries: Entry[] = [];
  for (const [name, text] of pairs) {
    const entry = { name: asText(name), value: asText(text) };
    if (
      entry.name !== undefined &&
      entry.name !== "" &&
      entry.value !== undefined
    ) {
      entries.push({ name: entry.name, value: entry.value });
    }
  }
  return entries.slice(0, MAX_ITEMS);
}

/** `value` as the hits of a canvas: those with a kind and words, at most {@link MAX_ITEMS}. */
export function asHits(value: unknown): Hit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const hits: Hit[] = [];
  for (const item of value.filter(isRecord)) {
    const kind = asText(item["kind"]);
    const words = asText(item["words"]);
    if (kind !== undefined && kind !== "" && words !== undefined) {
      hits.push({ kind, words, details: asEntries(item["details"]) });
    }
  }
  return hits.slice(0, MAX_ITEMS);
}
