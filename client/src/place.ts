// Where the mode's parts go on the window: the rectangle a drag spans, what lies wholly in it, the popover beside its
// target, the pins beside each other and the pixels a crop takes, all in the window's CSS pixels.

import type { Rect } from './model';

/** The space between a target and its popover, and between the popover and the window's edges. */
export const GAP = 12;

/** How much a frame's shape may differ from the window's and still show it, as after a resize the stream lags. */
const SAME_SHAPE = 0.02;

/** A point in the window's CSS pixels. */
export type Point = readonly [x: number, y: number];

/** A size or a frame's pixels: width and height. */
export type Size = readonly [width: number, height: number];

/** The rectangle between the points `from` and `to`, whichever way the drag went. */
export function between(from: Point, to: Point): Rect {
  return {
    x: Math.min(from[0], to[0]),
    y: Math.min(from[1], to[1]),
    width: Math.abs(from[0] - to[0]),
    height: Math.abs(from[1] - to[1]),
  };
}

/** Whether `inner` lies wholly in `outer`, and has a size, as a hidden element has none. */
export function holds(outer: Rect, inner: Rect): boolean {
  return (
    inner.width > 0 &&
    inner.height > 0 &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The part of `a` that `b` covers too; none where they do not meet. */
export function overlap(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

/** `rect`, given in the CSS pixels of something at `origin`, in the window's. */
export function offsetBy(rect: Rect, origin: Rect): Rect {
  return { ...rect, x: origin.x + rect.x, y: origin.y + rect.y };
}

/** `rect`, given in the window's CSS pixels, in those of something at `origin`. */
export function relativeTo(rect: Rect, origin: Rect): Rect {
  return { ...rect, x: rect.x - origin.x, y: rect.y - origin.y };
}

/** The edge a popover is placed by, as its height is not known before it shows. */
export type Edge = { top: number } | { bottom: number };

/** Where a popover goes: its left edge, its top or bottom edge, and the most it may be high. */
export interface Popover {
  left: number;
  edge: Edge;
  maxHeight: number;
}

/**
 * Where a popover `width` wide goes for the target `anchor` in a window of `window`, whose bottom `kept` pixels it
 * leaves free for the bar: on the target's right where it fits, else on its left, else under it; from there down
 * where `room` is left under it, else from the free space's bottom up; always in the window.
 */
export function popoverAt(anchor: Rect, width: number, room: number, window: Size, kept: number): Popover {
  const right = anchor.x + anchor.width + GAP;
  const left = anchor.x - GAP - width;
  const [x, wantedTop] =
    right + width + GAP <= window[0]
      ? [right, anchor.y]
      : left >= GAP
        ? [left, anchor.y]
        : [anchor.x, anchor.y + anchor.height + GAP];
  const bottom = window[1] - kept;
  const top = Math.max(wantedTop, GAP);
  const down = bottom - top - GAP >= room;
  return {
    left: Math.max(Math.min(x, window[0] - width - GAP), GAP),
    edge: down ? { top } : { bottom: kept + GAP },
    maxHeight: Math.max(down ? bottom - top - GAP : bottom - 2 * GAP, 0),
  };
}

/**
 * The places of pins `size` wide and high that want to be at `wanted`, each between 0 and `maxX`, moved past those
 * before it that it would cover, right first, then left, so no pin hides another (WCAG 2.5.8). Where a row has no
 * room left, a pin stays where it wanted.
 */
export function spread(wanted: readonly Point[], size: number, maxX: number): Point[] {
  const limit = Math.max(maxX, 0);
  const steps = Math.ceil(limit / size) + 1;
  const placed: Point[] = [];
  for (const [wantedX, y] of wanted) {
    const x = Math.min(Math.max(wantedX, 0), limit);
    let found: number | undefined;
    for (let step = 0; step <= steps && found === undefined; step += 1) {
      for (const candidate of [x + step * size, x - step * size]) {
        const free = !placed.some(([left, top]) => Math.abs(left - candidate) < size && Math.abs(top - y) < size);
        if (found === undefined && candidate >= 0 && candidate <= limit && free) {
          found = candidate;
        }
      }
    }
    placed.push([found ?? x, y]);
  }
  return placed;
}

/** An area of a frame's pixels: left, top, width and height. */
export type Area = readonly [left: number, top: number, width: number, height: number];

/**
 * The pixels of a crop around `target` with `margin` on each side, in a frame of `frame` pixels that shows a window of
 * `window` CSS pixels, within the frame; none where nothing of the target lies in the window, or the frame shows more
 * than the window.
 */
export function cropPixels(target: Rect, margin: number, window: Size, frame: Size): Area | undefined {
  if (!showsWindow(frame, window)) {
    return undefined;
  }
  const scaleX = frame[0] / window[0];
  const scaleY = frame[1] / window[1];
  const left = Math.max((target.x - margin) * scaleX, 0);
  const top = Math.max((target.y - margin) * scaleY, 0);
  const right = Math.min((target.x + target.width + margin) * scaleX, frame[0]);
  const bottom = Math.min((target.y + target.height + margin) * scaleY, frame[1]);
  if (right - left < 1 || bottom - top < 1) {
    return undefined;
  }
  return [Math.floor(left), Math.floor(top), Math.ceil(right - left), Math.ceil(bottom - top)];
}

/**
 * Whether a frame of `frame` pixels shows a window of `window` CSS pixels: it has the window's shape, as a shared tab
 * has, where a shared screen or browser window has a toolbar or more around it.
 */
export function showsWindow(frame: Size, window: Size): boolean {
  if (window[0] <= 0 || window[1] <= 0 || frame[0] === 0 || frame[1] === 0) {
    return false;
  }
  return Math.abs(frame[0] / frame[1] / (window[0] / window[1]) - 1) <= SAME_SHAPE;
}

/** The scale at which a picture of `width` by `height` pixels has at most `pixels`, and never more than `scale`. */
export function scaleFor(width: number, height: number, pixels: number, scale: number): number {
  const area = width * height * scale * scale;
  return area <= pixels || area <= 0 ? scale : scale * Math.sqrt(pixels / area);
}
