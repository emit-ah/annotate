import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../src/api";
import type { NewAnnotation } from "../src/model";
import { OUTBOX_TTL_MS, Outbox } from "../src/outbox";

const annotation = (comment: string, path = "/", app = "demo"): NewAnnotation =>
  ({
    app,
    comment,
    path,
    target: { kind: "region" },
  }) as unknown as NewAnnotation;

/** An API whose posts end as `outcomes` say, in turn. */
function api(
  ...outcomes: ("ok" | "refused" | "for-now")[]
): Api & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    create: (record: NewAnnotation) => {
      sent.push(record.comment);
      const next = outcomes.shift() ?? "ok";
      return Promise.resolve(
        next === "ok"
          ? { ok: true, value: undefined }
          : { ok: false, failure: next, reason: `HTTP ${next}` },
      );
    },
  } as unknown as Api & { sent: string[] };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the outbox", () => {
  it("keeps annotations until the service has them, the oldest first, and sends only its app's", async () => {
    const outbox = new Outbox(new IDBFactory());
    await outbox.keep(annotation("first"));
    await outbox.keep(annotation("second", "/other"));
    await outbox.keep(annotation("of another app", "/", "tutti"));
    expect(
      (await outbox.waitingOn("demo", "/")).map((each) => each.comment),
    ).toEqual(["first"]);
    const service = api();
    expect(await outbox.send(service, "demo")).toEqual({
      sent: 2,
      refused: [],
    });
    expect(service.sent).toEqual(["first", "second"]);
    expect((await outbox.waiting()).map((each) => each.annotation.app)).toEqual(
      ["tutti"],
    );
  });

  it("drops what the service refuses, says why, and stops at what fails for now", async () => {
    const outbox = new Outbox(new IDBFactory());
    for (const comment of ["refused", "later", "after"]) {
      await outbox.keep(annotation(comment));
    }
    expect(await outbox.send(api("refused", "for-now"), "demo")).toEqual({
      sent: 0,
      refused: ["HTTP refused"],
    });
    expect(
      (await outbox.waiting()).map((each) => each.annotation.comment),
    ).toEqual(["later", "after"]);
  });

  it("forgets what waited longer than its time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const outbox = new Outbox(new IDBFactory());
    await outbox.keep(annotation("old"));
    vi.setSystemTime(Date.now() + OUTBOX_TTL_MS + 1);
    await outbox.keep(annotation("new"));
    expect(
      (await outbox.waiting()).map((each) => each.annotation.comment),
    ).toEqual(["new"]);
    const service = api();
    await outbox.send(service, "demo");
    expect(service.sent).toEqual(["new"]);
  });

  it("keeps nothing where the browser has no IndexedDB", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const outbox = new Outbox(undefined);
    await expect(outbox.keep(annotation("x"))).rejects.toThrow(/no IndexedDB/);
    expect(await outbox.waiting()).toEqual([]);
  });
});
