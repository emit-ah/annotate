// The record the client sends, built from a comment and its draft, with where it was made: the page's address, the
// window, the browser and the build.

import { browserInBrief, queryKept } from "./address";
import type { ConsoleEntry, Json, NewAnnotation } from "./model";
import type { Draft } from "./state";

/** The app and build annotated, and the query parameters whose values an annotation keeps. */
export interface Build {
  app: string;
  version: string;
  query: readonly string[];
}

/** The page's path and its query as an annotation keeps it: its parameters' names, and the values of `allowed`. */
export function address(
  location: Location,
  allowed: readonly string[],
): { path: string; query: string } {
  return {
    path: location.pathname === "" ? "/" : location.pathname,
    query: queryKept(location.search, allowed),
  };
}

/** What an annotation carries beside its target: the app's context and the console's latest entries. */
export interface Carried {
  context: Json | undefined;
  console: ConsoleEntry[];
}

/** The annotation with `comment` that `draft` makes in `window`, carrying `carried`. */
export function annotation(
  draft: Draft,
  comment: string,
  build: Build,
  window: Window,
  carried: Carried,
): NewAnnotation {
  const { path, query } = address(window.location, build.query);
  const { crop, frame } = draft.pictures;
  return {
    app: build.app,
    comment: comment.trim(),
    path,
    query,
    version: build.version,
    viewport: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      pixel_ratio: window.devicePixelRatio,
    },
    browser: browserInBrief(window.navigator.userAgent),
    target: draft.target,
    state: draft.state,
    ...(crop === undefined ? {} : { crop }),
    ...(frame === undefined ? {} : { frame }),
    ...(carried.context === undefined ? {} : { context: carried.context }),
    ...(carried.console.length === 0 ? {} : { console: carried.console }),
  };
}
