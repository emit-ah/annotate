import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetch } from '../src/api';
import { Config } from '../src/config';
import { Diagnostics } from '../src/diagnostics';
import { Mode } from '../src/mode';
import { Outbox } from '../src/outbox';

/** A stand-in service: what it was sent, and how it answers posts for now. */
interface Service {
  posted: Record<string, unknown>[];
  listStatus: number;
  postStatus: number;
}

function fetchOf(service: Service): Fetch {
  return (_url, init) => {
    if (init.method === 'POST') {
      if (service.postStatus === 201) {
        service.posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      }
      const body = service.postStatus === 422 ? '{"detail":"comment is empty"}' : '{}';
      return Promise.resolve(new Response(body, { status: service.postStatus }));
    }
    const list = service.posted.map((each, index) => ({
      ...each,
      id: `${index}`,
      created: 't',
      author: 'a',
      status: 'open',
    }));
    return Promise.resolve(new Response(JSON.stringify(list), { status: service.listStatus }));
  };
}

function setUp(configure: (config: Config) => void = () => undefined) {
  const service: Service = { posted: [], listStatus: 200, postStatus: 201 };
  const config = new Config();
  configure(config);
  const diagnostics = new Diagnostics();
  const outbox = new Outbox(new IDBFactory());
  const mode = new Mode({
    config,
    fetch: fetchOf(service),
    outbox,
    window,
    startCapture: () => Promise.resolve({ unshared: 'declined', error: new Error('no') }),
    diagnostics,
  });
  return { service, config, mode, outbox, diagnostics };
}

const said = async (mode: Mode, text: string | RegExp) => vi.waitFor(() => expect(mode.state.said).toMatch(text));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  document.head.innerHTML =
    '<title>Settings</title><meta name="annotate-app" content="demo"><meta name="annotate-version" content="1.4.0">';
  document.body.innerHTML = '<button type="button">Save</button><p data-annotate-private>secret</p>';
});

describe('the mode', () => {
  it.each([
    ['no-app', () => document.head.querySelector('[name="annotate-app"]')?.remove(), 200],
    ['no-version', () => document.head.querySelector('[name="annotate-version"]')?.remove(), 200],
    ['no-service', () => undefined, 404],
    ['not-now', () => undefined, 503],
  ])('keeps nothing and says why: %s', async (unable, change, listStatus) => {
    change();
    const { mode, service } = setUp();
    service.listStatus = listStatus;
    await mode.start();
    expect(mode.state).toMatchObject({ stage: 'unable', unable });
  });

  it('asks to share the tab, then pins a comment with the state, console and context to the service', async () => {
    const { mode, service, diagnostics } = setUp((config) => {
      config.register('context', () => ({ turn: 1 }));
      config.register('state', () => ({ zoom: '1.8' }));
    });
    const events: string[] = [];
    for (const name of ['start', 'saved', 'end']) {
      document.addEventListener(`annotate:${name}`, () => events.push(name));
    }
    diagnostics.recordValues('error', ['boom']);
    await mode.start();
    expect(mode.state.stage).toBe('asking');
    await mode.answer(true);
    expect(mode.state.stage).toBe('on');
    await said(mode, 'The tab is not shared, so your annotations go without pictures.');
    await mode.pin(document.querySelector('button') as Element, undefined, true);
    expect(mode.state.draft?.heading).toBe('button · Save');
    await mode.save('  ');
    expect(mode.state.draft?.problem).toBe('Write a comment first.');
    await mode.save('Make it bigger.');
    expect(mode.state.draft).toBeUndefined();
    expect(service.posted[0]).toMatchObject({
      app: 'demo',
      version: '1.4.0',
      comment: 'Make it bigger.',
      state: [{ name: 'zoom', value: '1.8' }],
      context: { turn: 1 },
      console: [{ kind: 'error', message: 'boom' }],
    });
    expect(mode.state.shown).toHaveLength(1);
    mode.leave();
    expect(mode.state.stage).toBe('off');
    expect(events).toEqual(['start', 'saved', 'end']);
  });

  it('goes without the question where the app takes no pictures, and leaves the console out where it is off', async () => {
    const { mode, service } = setUp((config) => {
      config.register('pictures', () => false);
      config.configure({ console: false });
    });
    await mode.start();
    expect(mode.state.stage).toBe('on');
    await mode.pin(document.querySelector('button') as Element, undefined, true);
    await mode.save('x');
    expect(service.posted[0]).not.toHaveProperty('console');
  });

  it('keeps nothing the app denies, and nothing of a private part', async () => {
    const { mode, service } = setUp((config) => config.register('redact', () => null));
    await mode.start();
    await mode.answer(false);
    await mode.pin(document.querySelector('p') as Element, undefined, true);
    expect(mode.state.draft).toBeUndefined();
    await said(mode, 'This part of the app is not annotated.');
    await mode.pin(document.querySelector('button') as Element, undefined, true);
    await mode.save('x');
    expect(mode.state.draft?.problem).toBe('Not saved: the app keeps no annotation of this.');
    expect(service.posted).toEqual([]);
  });

  it('keeps an annotation in the outbox while the service is down, and shows why it refuses one', async () => {
    const { mode, service, outbox } = setUp();
    await mode.start();
    await mode.answer(false);
    service.postStatus = 422;
    await mode.pin(document.querySelector('button') as Element, undefined, true);
    await mode.save('x');
    expect(mode.state.draft?.problem).toBe('Not saved: comment is empty');
    service.postStatus = 503;
    await mode.save('Later.');
    await said(mode, /Kept in this browser/);
    expect((await outbox.waiting()).map((each) => each.annotation.comment)).toEqual(['Later.']);
    expect(mode.state.shown).toEqual([{ waiting: expect.objectContaining({ comment: 'Later.' }) }]);
  });

  it('goes back step by step with Escape: the comment, the corner, the list, then the mode', async () => {
    const { mode } = setUp();
    await mode.start();
    await mode.answer(false);
    await mode.pin(document.querySelector('button') as Element, undefined, true);
    mode.set({ corners: 'first', panel: true });
    mode.back();
    expect(mode.state.draft).toBeUndefined();
    mode.back();
    expect(mode.state.corners).toBe('off');
    mode.back();
    expect(mode.state.panel).toBe(false);
    mode.back();
    expect(mode.state.stage).toBe('off');
  });
});
