// The annotations saved but not yet with the service, in IndexedDB, so a lost connection or a closed tab loses none:
// each waits there until the service has it, and goes again whenever the mode finds the service.

import type { Api } from './api';
import type { NewAnnotation } from './model';
import { isRecord } from './text';

const DATABASE = 'annotate';
const STORE = 'outbox';
const VERSION = 1;

/** An annotation that waits, with its key in the store. */
export interface Waiting {
  key: IDBValidKey;
  annotation: NewAnnotation;
}

/** The request `request` as a promise of its result. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
  });
}

/** `value` as a waiting annotation's record: the JSON of an object with an app, a path and a target. */
function asAnnotation(value: unknown): NewAnnotation | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    const readable =
      isRecord(parsed) &&
      typeof parsed['app'] === 'string' &&
      typeof parsed['path'] === 'string' &&
      isRecord(parsed['target']);
    // The service checks every field again when the annotation goes.
    return readable ? (parsed as unknown as NewAnnotation) : undefined;
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
      return Promise.reject(new Error('this browser has no IndexedDB'));
    }
    this.opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE, VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { autoIncrement: true });
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.opened = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB did not open'));
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
    await done((await this.store('readwrite')).add(JSON.stringify(annotation)));
  }

  /** The annotations that wait, the oldest first; none where the browser keeps nothing. */
  async waiting(): Promise<Waiting[]> {
    try {
      const store = await this.store('readonly');
      const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
      const waiting: Waiting[] = [];
      keys.forEach((key, index) => {
        const annotation = asAnnotation(values[index]);
        if (annotation !== undefined) {
          waiting.push({ key, annotation });
        }
      });
      return waiting;
    } catch (error) {
      console.warn('annotate: the outbox cannot be read', error);
      return [];
    }
  }

  /** The annotations of `app` on the page at `path` that wait. */
  async waitingOn(app: string, path: string): Promise<NewAnnotation[]> {
    return (await this.waiting())
      .map(({ annotation }) => annotation)
      .filter((annotation) => annotation.app === app && annotation.path === path);
  }

  /** Forgets the waiting annotation of `key`. */
  private async forget(key: IDBValidKey): Promise<void> {
    await done((await this.store('readwrite')).delete(key));
  }

  /**
   * Gives `api` every annotation that waits, the oldest first, and forgets each it took, or refused, as it would
   * refuse it again; it stops at the first that fails for now, which waits with those after it. It gives how many went.
   */
  async send(api: Api): Promise<number> {
    let sent = 0;
    for (const { key, annotation } of await this.waiting()) {
      const outcome = await api.create(annotation);
      if (!outcome.ok && outcome.failure !== 'refused') {
        break;
      }
      if (!outcome.ok) {
        console.warn(`annotate: the service refused a waiting annotation: ${outcome.reason}`);
      }
      sent += outcome.ok ? 1 : 0;
      await this.forget(key);
    }
    return sent;
  }
}
