// The annotation mode's controller (ADR-0001): it starts by finding the service and the
// app's version, asks to share the tab, pins comments to what the user picks, saves them to the service or into the
// outbox, and shows the page's annotations. What an action finds after it waited applies only while the mode is still
// in the same start.

import { Api, type Fetch } from "./api";
import { Capture, type Pictures, type Unshared } from "./capture";
import type { Config } from "./config";
import { isPrivate } from "./describe";
import {
  messagesWith,
  say,
  type MessageKey,
  type Messages,
  type Values,
} from "./messages";
import {
  isAppName,
  isVersion,
  type ConsoleEntry,
  type NewAnnotation,
  type Rect,
} from "./model";
import type { Outbox } from "./outbox";
import { isPageRoot } from "./page";
import type { Size } from "./place";
import { address, annotation } from "./record";
import {
  initialState,
  type Draft,
  type Focus,
  type PinnedBy,
  type State,
  type Unable,
} from "./state";
import { pinned, redactedRects, regionOf, type Aimed } from "./targets";

/** The milliseconds the mode's parts stay hidden before a still, so the shared tab shows the page without them. */
const HIDDEN_FOR_STILL_MS = 150;

/** The milliseconds between clearing what the mode says and saying it, so a screen reader says it again. */
const SAY_AGAIN_MS = 60;

/** How often the mode looks whether the page's address changed, as an app's router changes it without a reload. */
const ADDRESS_CHECK_MS = 500;

/** The ID of the button that opens the list, where the focus goes when nothing else should have it. */
export const LIST_BUTTON = "annotate-list-button";

/** The ID of the list's heading. */
export const LIST_HEADING = "annotate-list-heading";

/** What the mode needs of the browser and the app. */
export interface Environment {
  config: Config;
  fetch: Fetch;
  outbox: Outbox;
  window: Window;
  startCapture: (ended: () => void) => Promise<Capture | Unshared>;
  diagnostics: { recent(): ConsoleEntry[] };
}

/** The app's build and service, once the mode found them. */
interface Found {
  api: Api;
  app: string;
  version: string;
}

/** The mode's controller; its view subscribes to its state. */
export class Mode {
  readonly state: State = initialState();
  private session = 0;
  private queue: Promise<void> = Promise.resolve();
  private found: Found | undefined;
  private returnFocus: Element | undefined;
  private addressTimer: ReturnType<typeof setInterval> | undefined;
  private lastAddress = "";
  private readonly listeners = new Set<() => void>();

  constructor(private readonly environment: Environment) {}

  /** Calls `listener` after each change; it gives the way to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes the state by `patch` and tells the view. */
  set(patch: Partial<State>): void {
    Object.assign(this.state, patch);
    this.listeners.forEach((listener) => listener());
  }

  /** The texts of the mode, the app's own over the English ones. */
  messages(): Messages {
    return messagesWith(this.environment.config.messages());
  }

  /** The text `key` with `values`. */
  text(key: MessageKey, values?: Values): string {
    return say(this.messages(), key, values);
  }

  private get document(): Document {
    return this.environment.window.document;
  }

  /** Says `text`, also when it said it just before. */
  say(text: string): void {
    this.set({ said: "" });
    setTimeout(() => this.set({ said: text }), SAY_AGAIN_MS);
  }

  /** Whether the mode picks targets: it is on, past its question, and no comment is being written. */
  picking(): boolean {
    return this.state.stage === "on" && this.state.draft === undefined;
  }

  /** Whether `session` is still the mode's, which a start or an end ends. */
  private still(session: number): boolean {
    return this.session === session;
  }

  /** Runs `action` after those before it. */
  private enqueue(action: () => Promise<void>): Promise<void> {
    this.queue = this.queue
      .then(action)
      .catch((error: unknown) =>
        console.warn("annotate: an action failed", error),
      );
    return this.queue;
  }

  /** Tells the page that something happened, as `annotate:<name>` on its document. */
  private dispatch(name: string, detail: Record<string, unknown> = {}): void {
    this.document.dispatchEvent(
      new CustomEvent(`annotate:${name}`, { detail }),
    );
  }

  /** Switches the mode on: finds the app, its version and the service, then asks to share the tab. */
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.stage !== "off") {
        return;
      }
      this.session += 1;
      const session = this.session;
      const active = this.document.activeElement;
      this.returnFocus =
        active !== null && !isPageRoot(active) ? active : undefined;
      this.set({ stage: "looking" });
      this.say(this.text("started"));
      this.dispatch("start");
      const found = await this.find();
      if (!this.still(session)) {
        return;
      }
      if ("unable" in found) {
        this.set({ stage: "unable", unable: found.unable });
        return;
      }
      this.found = found;
      this.set({ app: found.app, version: found.version });
      if (await this.environment.config.pictures()) {
        this.set({ stage: "asking" });
      } else {
        this.say(this.text("withoutPictures"));
        await this.begin(session);
      }
    });
  }

  /** The app, its version and the service, or why the mode keeps nothing. */
  private async find(): Promise<Found | { unable: Unable }> {
    const { config, fetch } = this.environment;
    const app = config.app(this.document);
    if (app === undefined || !isAppName(app)) {
      return { unable: "no-app" };
    }
    const version = await config.version(this.document);
    if (version === undefined || !isVersion(version)) {
      return { unable: "no-version" };
    }
    const endpoint = config.endpoint(this.document);
    if (endpoint === undefined) {
      return { unable: "foreign-endpoint" };
    }
    const api = new Api(endpoint, fetch);
    const answer = await api.page(app, this.address().path);
    if (answer.ok) {
      return { api, app, version };
    }
    if (answer.failure === "for-now") {
      console.warn(
        `annotate: the annotation service does not answer: ${answer.reason}`,
      );
    }
    return {
      unable: answer.failure === "no-service" ? "no-service" : "not-now",
    };
  }

  /** Picks targets from now on, sends what waits and shows the page's annotations. */
  private async begin(session: number): Promise<void> {
    this.set({ stage: "on" });
    if (this.returnFocus !== undefined) {
      this.set({ focus: { page: this.returnFocus } });
    }
    this.watchAddress();
    if (this.found !== undefined) {
      await this.sendWaiting(this.found);
    }
    if (this.still(session)) {
      await this.refresh();
    }
  }

  /** Gives the service what waits in the outbox for this app, and says so where it refused some. */
  private async sendWaiting(found: Found): Promise<void> {
    const { refused } = await this.environment.outbox.send(
      found.api,
      found.app,
    );
    if (refused.length > 0) {
      this.say(
        this.text("outboxRefused", {
          count: refused.length,
          reason: refused.join("; "),
        }),
      );
    }
  }

  /** Shares the tab, as the question asked. */
  share(): Promise<void> {
    return this.answer(async (session) => {
      const shared = await this.environment.startCapture(() => this.lost());
      if (this.still(session)) {
        this.shared(shared);
      } else if (shared instanceof Capture) {
        shared.stop();
      }
    });
  }

  /** Goes on without pictures, as the question offered. */
  withoutPictures(): Promise<void> {
    return this.answer(async () => this.say(this.text("withoutPictures")));
  }

  /** Answers the question with `answering`, then picks targets, while the mode is still in the same start. */
  private answer(answering: (session: number) => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.stage !== "asking") {
        return;
      }
      const session = this.session;
      await answering(session);
      if (this.still(session)) {
        await this.begin(session);
      }
    });
  }

  /** Says whether the tab is shared now. */
  private shared(shared: Capture | Unshared): void {
    if (shared instanceof Capture) {
      this.set({ capture: shared });
      this.say(this.text("sharing"));
    } else if (shared.unshared === "not-the-tab") {
      this.say(this.text("notTheTab"));
    } else {
      console.warn("annotate: the tab is not shared", shared.error);
      this.say(this.text("notShared"));
    }
  }

  /** The user stopped sharing in the browser's own bar. */
  private lost(): void {
    if (this.state.capture !== undefined) {
      this.state.capture.stop();
      this.set({ capture: undefined });
      this.say(this.text("unsharedNow"));
    }
  }

  /** Opens a comment on `element`, which a pointer pinned or the keyboard picked. */
  pin(element: Element, pinnedBy: PinnedBy): Promise<void> {
    return this.enqueue(async () => {
      if (!this.picking()) {
        return;
      }
      if (isPrivate(element)) {
        this.say(this.text("private"));
        return;
      }
      const backTo =
        pinnedBy.by === "keyboard"
          ? element
          : (this.document.activeElement ?? undefined);
      const at = pinnedBy.by === "pointer" ? pinnedBy.at : undefined;
      this.set({ hover: undefined, corners: "off", panel: false });
      await this.open(
        await pinned(this.environment.config, this.messages(), element, at),
        backTo,
      );
    });
  }

  /** Opens a comment on the region `rect`. */
  region(rect: Rect): Promise<void> {
    return this.enqueue(async () => {
      if (!this.picking()) {
        return;
      }
      const backTo = this.document.activeElement ?? undefined;
      this.set({ hover: undefined, corners: "off", panel: false });
      await this.open(
        await regionOf(
          this.environment.config,
          this.messages(),
          this.document,
          rect,
        ),
        backTo,
      );
    });
  }

  /** Opens the comment's popover on `aimed`, with the view's state and the pictures of the shared tab. */
  private async open(aimed: Aimed, backTo: Element | undefined): Promise<void> {
    const session = this.session;
    const pictures = await this.pictures(aimed.anchor);
    const state = await this.environment.config.state(this.document);
    if (!this.still(session) || !this.picking()) {
      return;
    }
    const keeps = backTo !== undefined && !isPageRoot(backTo);
    this.set({
      draft: {
        ...aimed,
        state,
        pictures,
        ...(keeps ? { backTo } : {}),
      },
    });
  }

  /** The pictures of a target at `rect` from a still taken with the mode's parts hidden; none without a shared tab. */
  private async pictures(rect: Rect): Promise<Pictures> {
    const { capture } = this.state;
    if (capture === undefined || !(await this.environment.config.pictures())) {
      return {};
    }
    this.set({ hidden: true });
    await new Promise((resolve) => setTimeout(resolve, HIDDEN_FOR_STILL_MS));
    try {
      return await capture.still().pictures(rect, redactedRects(this.document));
    } catch (error) {
      console.warn("annotate: no still of the tab", error);
      return {};
    } finally {
      this.set({ hidden: false });
    }
  }

  /** Saves the comment being written: to the service, else into the outbox; else it stays open and says why. */
  save(comment: string): Promise<void> {
    return this.enqueue(async () => {
      const { draft } = this.state;
      if (draft === undefined || this.found === undefined) {
        return;
      }
      if (comment.trim() === "") {
        this.problem(this.text("empty"));
        return;
      }
      const session = this.session;
      const { found } = this;
      const record = await this.record(draft, comment, found);
      if (record === null) {
        this.problem(this.text("denied"));
        return;
      }
      const said = await this.keep(found.api, record);
      if (!this.still(session) || said === undefined) {
        return;
      }
      this.say(this.text(said));
      this.dispatch("saved", { waiting: said === "waits" });
      this.closeDraft();
      if (said === "saved") {
        await this.sendWaiting(found);
      }
      if (this.still(session)) {
        await this.refresh();
      }
    });
  }

  /** The record of `comment` on `draft`, with what it carries, as the app redacts it; none where the app denies it. */
  private async record(
    draft: Draft,
    comment: string,
    found: Found,
  ): Promise<NewAnnotation | null> {
    const { config, diagnostics, window } = this.environment;
    const carried = {
      context: await config.context(),
      console: config.console(this.document) ? diagnostics.recent() : [],
    };
    const query = config.queryKept(this.document);
    return config.redact(
      annotation(draft, comment, { ...found, query }, window, carried),
    );
  }

  /** Gives `record` to the service, else to the outbox; what to say, or none where neither kept it. */
  private async keep(
    api: Api,
    record: NewAnnotation,
  ): Promise<"saved" | "waits" | undefined> {
    const created = await api.create(record);
    if (created.ok) {
      return "saved";
    }
    if (created.failure === "refused") {
      this.problem(this.text("refused", { reason: created.reason }));
      return undefined;
    }
    try {
      await this.environment.outbox.keep(record);
      return "waits";
    } catch (error) {
      console.warn("annotate: the outbox keeps nothing", error);
      this.problem(this.text("notKept"));
      return undefined;
    }
  }

  /** Shows why the comment was not saved. */
  private problem(text: string): void {
    const { draft } = this.state;
    if (draft !== undefined) {
      this.set({ draft: { ...draft, problem: text } });
    }
  }

  /** Fetches this page's annotations, the oldest first, and those that wait after them. */
  async refresh(): Promise<void> {
    const { found } = this;
    if (found === undefined || this.state.stage !== "on") {
      return;
    }
    const session = this.session;
    const { path } = this.address();
    const waiting = await this.environment.outbox.waitingOn(found.app, path);
    const kept = await found.api.page(found.app, path);
    if (!this.still(session)) {
      return;
    }
    const list = kept.ok ? [...kept.value].reverse() : [];
    this.set({
      shown: [
        ...list.map((each) => ({ kept: each })),
        ...waiting.map((each) => ({ waiting: each })),
      ],
    });
  }

  /** Looks whether the page's address changed, and shows the new page's annotations. */
  private watchAddress(): void {
    const { location } = this.environment.window;
    this.lastAddress = `${location.pathname}${location.search}`;
    this.addressTimer = setInterval(() => {
      const now = `${location.pathname}${location.search}`;
      if (now !== this.lastAddress) {
        this.lastAddress = now;
        this.dropDraft();
        this.set({ corners: "off", panel: false });
        void this.enqueue(() => this.refresh());
      }
    }, ADDRESS_CHECK_MS);
  }

  /** Drops the comment being written, and gives the focus back to where it was. */
  closeDraft(): void {
    const backTo = this.state.draft?.backTo;
    this.dropDraft();
    this.set({
      focus: backTo === undefined ? { ours: LIST_BUTTON } : { page: backTo },
    });
  }

  /** Drops the comment being written, and lets go of its crop's picture. */
  private dropDraft(): void {
    const cropUrl = this.state.draft?.pictures.cropUrl;
    if (cropUrl !== undefined) {
      URL.revokeObjectURL(cropUrl);
    }
    this.set({ draft: undefined });
  }

  /** Escape: drops the comment, else the region's corner, else closes the list, else leaves. */
  back(): void {
    if (this.state.draft !== undefined) {
      this.closeDraft();
    } else if (this.state.corners !== "off") {
      this.set({ corners: "off" });
    } else if (this.state.panel) {
      this.set({ panel: false, focus: { ours: LIST_BUTTON } });
    } else {
      this.leave();
    }
  }

  /** Switches the mode off: stops sharing the tab, forgets what it showed, and gives the focus back. */
  leave(): void {
    if (this.state.stage === "off") {
      return;
    }
    this.session += 1;
    this.state.capture?.stop();
    this.dropDraft();
    clearInterval(this.addressTimer);
    const focus: Focus | undefined =
      this.returnFocus === undefined ? undefined : { page: this.returnFocus };
    this.returnFocus = undefined;
    this.found = undefined;
    this.set({ ...initialState(), focus });
    this.say(this.text("ended"));
    this.dispatch("end");
  }

  /** The window's size, for the view's places. */
  windowSize(): Size {
    const { innerWidth, innerHeight } = this.environment.window;
    return [innerWidth, innerHeight];
  }

  /** The page's path and the query an annotation keeps of it. */
  private address(): { path: string; query: string } {
    return address(
      this.environment.window.location,
      this.environment.config.queryKept(this.document),
    );
  }
}
