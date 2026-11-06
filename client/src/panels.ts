// The comment's popover beside its target and the list of the page's annotations at the side (boards B and D of
// tutti, 2026-10-10).

import { minuteOf, onMac, shortVersion } from "./address";
import { briefOf } from "./describe";
import { button, h, place } from "./dom";
import { MAX_COMMENT, type Rect } from "./model";
import { LIST_BUTTON, LIST_HEADING, type Mode } from "./mode";
import { popoverAt } from "./place";
import { bodyOf, type Draft, type Shown } from "./state";
import { wordsOf } from "./targets";

/** The ID of the comment's field. */
export const COMMENT = "annotate-comment";
const DRAFT_HEADING = "annotate-draft-heading";
const LIST_CAPTION = "annotate-list-caption";

/** The bar's height with its margin, which the popover keeps clear of, in CSS pixels. */
const BAR_BAND = 88;

/** The popover's width in CSS pixels, as its class sets it, and the room it wants under its target. */
const POPOVER_WIDTH = 384;
const POPOVER_ROOM = 280;

/** The ID of the list's item `number`. */
export function itemId(number: number): string {
  return `annotate-item-${number}`;
}

/** The comment's field and its buttons, which save it or drop it. */
function commentField(
  mode: Mode,
  document: Document,
): [HTMLTextAreaElement, HTMLElement] {
  const mac = onMac(document.defaultView?.navigator.userAgent ?? "");
  const field = h(document, "textarea", {
    id: COMMENT,
    maxlength: MAX_COMMENT,
  });
  const saveKey = {
    cap: mode.text(mac ? "keySaveMac" : "keySave"),
    shortcut: mac ? "Meta+Enter" : "Control+Enter",
  };
  const save = button(
    document,
    {
      label: mode.text("save"),
      key: saveKey,
      primary: true,
      attributes: { "aria-disabled": "true" },
    },
    () => void mode.save(field.value),
  );
  field.addEventListener("input", () =>
    save.setAttribute("aria-disabled", String(field.value.trim() === "")),
  );
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void mode.save(field.value);
    }
  });
  const cancel = button(
    document,
    { label: mode.text("cancel"), key: escapeKey(mode) },
    () => mode.closeDraft(),
  );
  return [field, h(document, "div", { class: "actions" }, cancel, save)];
}

/** The Escape key's cap and shortcut. */
export function escapeKey(mode: Mode): { cap: string; shortcut: string } {
  return { cap: mode.text("keyEscape"), shortcut: "Escape" };
}

/** The popover of the comment `draft` in `mode`. */
export function popover(
  mode: Mode,
  draft: Draft,
  document: Document,
): HTMLElement {
  const [field, actions] = commentField(mode, document);
  const context = [
    ...draft.state.map((entry) => entry.value),
    mode.text("version", {
      app: mode.state.app,
      version: shortVersion(mode.state.version),
    }),
  ];
  const { cropUrl } = draft.pictures;
  const surface = h(
    document,
    "div",
    {
      role: "dialog",
      "aria-labelledby": DRAFT_HEADING,
      class: "popover interactive",
    },
    h(document, "h2", { id: DRAFT_HEADING }, draft.heading),
    draft.detail !== "" && h(document, "p", {}, draft.detail),
    h(document, "p", { class: "small muted" }, context.join(" · ")),
    h(
      document,
      "label",
      { for: COMMENT, class: "sr-only" },
      mode.text("comment"),
    ),
    field,
    cropUrl !== undefined &&
      h(
        document,
        "div",
        { class: "crop" },
        h(document, "img", { src: cropUrl, alt: mode.text("crop") }),
        h(
          document,
          "p",
          { class: "small muted", "aria-hidden": "true" },
          mode.text("crop"),
        ),
      ),
    h(document, "p", { role: "alert", class: "problem" }),
    actions,
  );
  placeBeside(surface, draft.anchor, mode);
  return surface;
}

/** Places the popover `surface` beside its target at `anchor`, clear of the bar. */
function placeBeside(surface: HTMLElement, anchor: Rect, mode: Mode): void {
  const placed = popoverAt(
    anchor,
    POPOVER_WIDTH,
    POPOVER_ROOM,
    mode.windowSize(),
    BAR_BAND,
  );
  place(surface, {
    left: placed.left,
    top: "top" in placed.edge ? placed.edge.top : "auto",
    bottom: "bottom" in placed.edge ? placed.edge.bottom : "auto",
    "max-height": placed.maxHeight,
  });
}

/** What the list says of an annotation's status. */
function statusOf(mode: Mode, item: Shown): string {
  if ("waiting" in item) {
    return mode.text("statusWaiting");
  }
  const { status, resolved_in: resolvedIn } = item.kept;
  switch (status) {
    case "done":
      return resolvedIn === undefined
        ? mode.text("statusDone")
        : mode.text("statusDoneIn", { version: shortVersion(resolvedIn) });
    case "open":
      return mode.text("statusOpen");
    case "in_progress":
      return mode.text("statusInProgress");
    case "wont_do":
      return mode.text("statusWontDo");
  }
}

/** What the list says an annotation is about. */
function aboutOf(mode: Mode, item: Shown): string {
  const body = bodyOf(item);
  const { target } = body;
  const what =
    target.kind === "element"
      ? wordsOf(mode.messages(), briefOf(target))
      : target.kind === "region"
        ? mode.text("region", { count: target.elements.length })
        : (target.hits[0]?.words ?? target.canvas);
  const about = [
    what,
    mode.text("version", {
      app: body.app,
      version: shortVersion(body.version),
    }),
  ];
  if ("kept" in item) {
    about.push(
      mode.text("by", {
        author: item.kept.author,
        time: minuteOf(item.kept.created),
      }),
    );
  }
  return about.join(" · ");
}

/** An annotation in the list. */
function listItem(
  mode: Mode,
  document: Document,
  item: Shown,
  number: number,
): HTMLElement {
  const answer = "kept" in item ? item.kept.answer : undefined;
  return h(
    document,
    "li",
    { id: itemId(number), tabindex: -1, class: "item" },
    h(
      document,
      "p",
      {},
      h(document, "span", { class: "number" }, String(number)),
      h(document, "span", { class: "caption" }, statusOf(mode, item)),
    ),
    h(document, "p", {}, bodyOf(item).comment),
    h(document, "p", { class: "small muted" }, aboutOf(mode, item)),
    answer !== undefined &&
      h(
        document,
        "p",
        { class: "answer small" },
        mode.text("answer", { answer }),
      ),
  );
}

/** The page's annotations at the side, each with its status, comment, target, version and Claude's answer. */
export function list(mode: Mode, document: Document): HTMLElement {
  const { shown, capture } = mode.state;
  const done = button(
    document,
    { label: mode.text("done"), key: escapeKey(mode) },
    () => mode.set({ panel: false, focus: { ours: LIST_BUTTON } }),
  );
  return h(
    document,
    "aside",
    {
      class: "panel interactive",
      "aria-labelledby": `${LIST_CAPTION} ${LIST_HEADING}`,
    },
    h(
      document,
      "div",
      { class: "panel-head" },
      h(
        document,
        "div",
        {},
        h(
          document,
          "p",
          { id: LIST_CAPTION, class: "caption" },
          mode.text("list"),
        ),
        h(
          document,
          "h2",
          { id: LIST_HEADING, tabindex: -1 },
          mode.text("listTitle", { count: shown.length }),
        ),
      ),
      done,
    ),
    shown.length === 0
      ? h(document, "p", { class: "muted" }, mode.text("listEmpty"))
      : h(
          document,
          "ol",
          {},
          ...shown.map((item, index) =>
            listItem(mode, document, item, index + 1),
          ),
        ),
    h(
      document,
      "p",
      { class: "panel-foot small muted" },
      mode.text(capture === undefined ? "unshared" : "shared"),
      " · ",
      mode.text("hint"),
    ),
  );
}
