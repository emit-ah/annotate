import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/api';
import type { NewAnnotation } from '../src/model';
import { Outbox } from '../src/outbox';

const annotation = (comment: string, path = '/'): NewAnnotation =>
  ({ app: 'demo', comment, path, target: { kind: 'region' } }) as unknown as NewAnnotation;

/** An API whose posts end as `outcomes` say, in turn. */
function api(...outcomes: ('ok' | 'refused' | 'for-now')[]): Api & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    create: (record: NewAnnotation) => {
      sent.push(record.comment);
      const next = outcomes.shift() ?? 'ok';
      return Promise.resolve(
        next === 'ok' ? { ok: true, value: undefined } : { ok: false, failure: next, reason: next },
      );
    },
  } as unknown as Api & { sent: string[] };
}

describe('the outbox', () => {
  it('keeps annotations until the service has them, the oldest first', async () => {
    const outbox = new Outbox(new IDBFactory());
    await outbox.keep(annotation('first'));
    await outbox.keep(annotation('second', '/other'));
    expect((await outbox.waitingOn('demo', '/')).map((each) => each.comment)).toEqual(['first']);
    expect(await outbox.waitingOn('mappa', '/')).toEqual([]);
    const service = api();
    expect(await outbox.send(service)).toBe(2);
    expect(service.sent).toEqual(['first', 'second']);
    expect(await outbox.waiting()).toEqual([]);
  });

  it('forgets what the service refuses and stops at what fails for now', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outbox = new Outbox(new IDBFactory());
    for (const comment of ['refused', 'later', 'after']) {
      await outbox.keep(annotation(comment));
    }
    expect(await outbox.send(api('refused', 'for-now'))).toBe(0);
    expect((await outbox.waiting()).map((each) => each.annotation.comment)).toEqual(['later', 'after']);
  });

  it('keeps nothing where the browser has no IndexedDB', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outbox = new Outbox(undefined);
    await expect(outbox.keep(annotation('x'))).rejects.toThrow(/no IndexedDB/);
    expect(await outbox.waiting()).toEqual([]);
  });
});
