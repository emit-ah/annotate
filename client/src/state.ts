// Where the mode stands, which its controller changes and its view shows.

import type { Capture, Pictures } from "./capture";
import type { Annotation, Entry, NewAnnotation, Rect, Target } from "./model";
import type { Point } from "./place";

/** How far, in CSS pixels, a pointer goes while pressed before it drags a region rather than clicks. */
const DRAG_FROM = 6;

/** Where the mode stands: off, looking for the service, unable to keep anything, asking to share the tab, or on. */
export type Stage = "off" | "looking" | "unable" | "asking" | "on";

/** Why the mode keeps nothing. */
export type Unable =
  "no-service" | "not-now" | "no-version" | "no-app" | "foreign-endpoint";

/** The corners of a region made by two clicks, for those who cannot drag (WCAG 2.5.7): off, the first, or set. */
export type Corners = "off" | "first" | Point;

/** How a target was pinned: by a pointer at a point of the window, or by the keyboard. */
export type PinnedBy = { by: "pointer"; at: Point } | { by: "keyboard" };

/** What a click or Enter would pin: the element under the pointer, or the one the keyboard picked. */
export interface Hover {
  element: Element;
  words: string;
  byKeyboard: boolean;
}

/** A pointer pressed on the page, from where to where. */
export interface Drag {
  from: Point;
  to: Point;
}

/** Whether `drag` went far enough to drag a region rather than click. */
export function dragging(drag: Drag): boolean {
  return (
    Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) >=
    DRAG_FROM
  );
}

/** A comment being written about a target. */
export interface Draft {
  target: Target;
  /** The target in a few words, such as "button · Repeat", the popover's heading. */
  heading: string;
  /** The elements of a region, by name. */
  detail: string;
  /** The label of the target's frame, as a region's count of elements. */
  label?: string;
  anchor: Rect;
  state: Entry[];
  pictures: Pictures;
  /** Where the focus goes back to once the comment is saved or dropped. */
  backTo?: Element;
  /** Why it was not saved, if it was not. */
  problem?: string;
}

/** An annotation of this page: kept by the service, or still waiting for it. */
export type Shown = { kept: Annotation } | { waiting: NewAnnotation };

/** Where the focus goes after the next render. */
export type Focus = { ours: string } | { item: number } | { page: Element };

/** Everything the view shows. */
export interface State {
  stage: Stage;
  unable: Unable | undefined;
  capture: Capture | undefined;
  hover: Hover | undefined;
  drag: Drag | undefined;
  corners: Corners;
  draft: Draft | undefined;
  shown: Shown[];
  panel: boolean;
  /** Whether the mode's parts are hidden, while a still of the tab is taken. */
  hidden: boolean;
  /** What the mode last said, for screen readers too. */
  said: string;
  focus: Focus | undefined;
  /** The app and version annotated, once the mode found them. */
  app: string;
  version: string;
}

/** The mode switched off. */
export function initialState(): State {
  return {
    stage: "off",
    unable: undefined,
    capture: undefined,
    hover: undefined,
    drag: undefined,
    corners: "off",
    draft: undefined,
    shown: [],
    panel: false,
    hidden: false,
    said: "",
    focus: undefined,
    app: "",
    version: "",
  };
}

/** What an annotation shown says of itself, whether kept or waiting. */
export function bodyOf(shown: Shown): NewAnnotation {
  return "kept" in shown ? shown.kept : shown.waiting;
}
