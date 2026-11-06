// The annotations saved but not yet with the service, in IndexedDB, so a lost connection or a closed tab loses none:
// each waits there until the service has it, and goes again whenever the mode finds the service of its app. What the
// service refuses, as after a login that ran out, goes with a notice, and what waited longer than OUTBOX_TTL_MS goes
// unsent, so an annotation does not linger in a browser.

import type { Api } from "./api";
import type { NewAnnotation } from "./model";
import { isRecord } from "./text";

const DATABASE = "annotate";
const STORE = "outbox";
const VERSION = 1;

/** How long an annotation waits at most: a week. */
export const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What the store keeps of an annotation: when it was kept, and the annotation. */
interface Kept {
  kept: number;
  annotation: NewAnnotation;
}

/** What a send did: how many went, and why the service refused the others. */
export interface Sent {
  sent: number;
  refused: string[];
}

/** An annotation that waits, with its key in the store. */
export interface Waiting {
  key: IDBValidKey;
  annotation: NewAnnotation;
}

/** The request `request` as a promise of its result. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB failed"));
  });
}

/** `value` as what the store keeps: the JSON of a time and an annotation with an app, a path and a target. */
function asKept(value: unknown): Kept | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    const annotation = isRecord(parsed) ? parsed["annotation"] : undefined;
    const readable =
      isRecord(parsed) &&
      typeof parsed["kept"] === "number" &&
      isRecord(annotation) &&
      typeof annotation["app"] === "string" &&
      typeof annotation["path"] === "string" &&
      isRecord(annotation["target"]);
    // The service checks every field again when the annotation goes.
    return readable ? (parsed as unknown as Kept) : undefined;
  } catch {
    return undefined;
  }
}

/** The outbox in the browser's IndexedDB. */
export class Outbox {
  private opened: Promise<IDBDatabase> | undefined;

  constructor(private readonly indexedDb: IDBFactory | undefined) {}

  /** The database, opened once; a newer version in another tab closes it, and the next call opens it again. */
  private database(): Promise<IDBDatabase> {
    const factory = this.indexedDb;
    if (factory === undefined) {
      return Promise.reject(new Error("this browser has no IndexedDB"));
    }
    this.opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE, VERSION);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { autoIncrement: true });
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.opened = undefined;
        };
        resolve(database);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB did not open"));
    }).catch((error: unknown) => {
      this.opened = undefined;
      throw error;
    });
    return this.opened;
  }

  /** The store, in a transaction of `mode`. */
  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.database()).transaction(STORE, mode).objectStore(STORE);
  }

  /** Keeps `annotation` until the service has it; it throws where the browser keeps nothing, as some private windows. */
  async keep(annotation: NewAnnotation): Promise<void> {
    const kept: Kept = { kept: Date.now(), annotation };
    await done((await this.store("readwrite")).add(JSON.stringify(kept)));
  }

  /** The annotations that wait, the oldest first, past their time forgotten; none where the browser keeps nothing. */
  async waiting(): Promise<Waiting[]> {
    try {
      const store = await this.store("readonly");
      const [keys, values] = await Promise.all([
        done(store.getAllKeys()),
        done(store.getAll()),
      ]);
      const waiting: Waiting[] = [];
      const expired: IDBValidKey[] = [];
      keys.forEach((key, index) => {
        const kept = asKept(values[index]);
        if (kept === undefined || Date.now() - kept.kept > OUTBOX_TTL_MS) {
          expired.push(key);
        } else {
          waiting.push({ key, annotation: kept.annotation });
        }
      });
      await Promise.all(expired.map((key) => this.forget(key)));
      return waiting;
    } catch (error) {
      console.warn("annotate: the outbox cannot be read", error);
      return [];
    }
  }

  /** The annotations of `app` on the page at `path` that wait. */
  async waitingOn(app: string, path: string): Promise<NewAnnotation[]> {
    return (await this.waiting())
      .map(({ annotation }) => annotation)
      .filter(
        (annotation) => annotation.app === app && annotation.path === path,
      );
  }

  /** Forgets the waiting annotation of `key`. */
  private async forget(key: IDBValidKey): Promise<void> {
    await done((await this.store("readwrite")).delete(key));
  }

  /**
   * Gives `api` every annotation of `app` that waits, the oldest first, and forgets each it took, or refused, as it
   * would refuse it again; it stops at the first that fails for now, which waits with those after it.
   */
  async send(api: Api, app: string): Promise<Sent> {
    const result: Sent = { sent: 0, refused: [] };
    const waiting = (await this.waiting()).filter(
      ({ annotation }) => annotation.app === app,
    );
    for (const { key, annotation } of waiting) {
      const outcome = await api.create(annotation);
      if (!outcome.ok && outcome.failure !== "refused") {
        break;
      }
      if (outcome.ok) {
        result.sent += 1;
      } else {
        result.refused.push(outcome.reason);
      }
      await this.forget(key);
    }
    return result;
  }
}
