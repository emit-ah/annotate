// Where an annotation was made, beside its target: the page's address without the mode's parameter, the browser in
// brief, and short forms of a version and a time for the list.

import { squeezed } from "./text";

/** The query parameter that switches the mode on with the page. */
const PARAMETER = "annotate";

/** The most characters of a user agent the record keeps where it names no known browser. */
const MAX_AGENT = 60;

/** The characters of a commit in brief, as git abbreviates it. */
const SHORT_COMMIT = 7;

/** The pairs of the query `search`, with or without its `?`, without the empty ones. */
function pairs(search: string): string[] {
  return search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "");
}

/** Whether the pair `pair` of a query is the mode's parameter, with a value or without. */
function isParameter(pair: string): boolean {
  return pair.split("=")[0] === PARAMETER;
}

/** Whether the query `search` asks for the mode. */
export function asksForMode(search: string): boolean {
  return pairs(search).some(isParameter);
}

/**
 * The query `search` as an annotation keeps it, without its `?` and the mode's parameter: the names of its
 * parameters, and the values only of those in `allowed`, as a value may hold a token or a person's data.
 */
export function queryKept(search: string, allowed: readonly string[]): string {
  return pairs(search)
    .filter((pair) => !isParameter(pair))
    .map((pair) => {
      const name = pair.split("=")[0] ?? "";
      return allowed.includes(name) ? pair : name;
    })
    .join("&");
}

/** The browser and its version in brief, such as "Chrome 141", from its user agent `agent`. */
export function browserInBrief(agent: string): string {
  const versionAfter = (marker: string): string | undefined => {
    const rest = agent.split(marker)[1];
    return rest === undefined ? undefined : (rest.match(/^\d*/)?.[0] ?? "");
  };
  const named: [string, string][] = [
    ["Firefox/", "Firefox"],
    ["Edg/", "Edge"],
    ["OPR/", "Opera"],
    ["Chrome/", "Chrome"],
  ];
  for (const [marker, name] of named) {
    const version = versionAfter(marker);
    if (version !== undefined) {
      return `${name} ${version}`;
    }
  }
  const safari = agent.includes("Safari/")
    ? versionAfter("Version/")
    : undefined;
  return safari === undefined ? squeezed(agent, MAX_AGENT) : `Safari ${safari}`;
}

/** Whether the browser runs on a Mac, whose keys name the Command key rather than Ctrl. */
export function onMac(agent: string): boolean {
  return agent.includes("Mac OS X");
}

/** The version `version` in brief: a commit's first seven digits with its mark of changes; a version as it is. */
export function shortVersion(version: string): string {
  const dirty = version.endsWith("+dirty");
  const hash = dirty ? version.slice(0, -"+dirty".length) : version;
  if (!/^[0-9a-f]{8,40}$/.test(hash)) {
    return version;
  }
  return `${hash.slice(0, SHORT_COMMIT)}${dirty ? "+dirty" : ""}`;
}

/** The minute of the time `time`, in RFC 3339 as the service gives it, such as "2026-10-09 18:42". */
export function minuteOf(time: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time)
    ? `${time.slice(0, 10)} ${time.slice(11, 16)}`
    : time;
}
