import { describe, expect, it, vi } from 'vitest';
import { Diagnostics, hear, pathOf } from '../src/diagnostics';
import { MAX_CONSOLE, MAX_STACK, MAX_TEXT } from '../src/model';

describe('what went wrong before an annotation', () => {
  it('keeps the latest entries in a ring', () => {
    const diagnostics = new Diagnostics();
    for (let index = 0; index < MAX_CONSOLE + 5; index += 1) {
      diagnostics.recordValues('warn', [`warning ${index}`]);
    }
    const recent = diagnostics.recent();
    expect(recent).toHaveLength(MAX_CONSOLE);
    expect(recent[0]?.message).toBe('warning 5');
    expect(recent[0]?.time).toMatch(/Z$/);
  });

  it('keeps an error with its stack, both capped', () => {
    const diagnostics = new Diagnostics();
    const error = new TypeError('x'.repeat(MAX_TEXT + 10));
    error.stack = 's'.repeat(MAX_STACK + 10);
    diagnostics.recordValues('error', ['failed:', error, { id: 1 }]);
    const [entry] = diagnostics.recent();
    expect(entry?.message.startsWith('failed: TypeError: xxx')).toBe(true);
    expect(Array.from(entry?.message ?? '')).toHaveLength(MAX_TEXT + 1);
    expect(Array.from(entry?.stack ?? '')).toHaveLength(MAX_STACK + 1);
  });

  it('names a failed request by its path, never its query', () => {
    expect(pathOf('/api/cards?token=secret#x')).toBe('/api/cards');
    expect(pathOf('https://example.org/a/b?c=d')).toBe('https://example.org/a/b');
    const diagnostics = new Diagnostics();
    diagnostics.recordRequest('POST', '/save?key=1', 500);
    expect(diagnostics.recent()[0]).toMatchObject({
      kind: 'network',
      method: 'POST',
      url: '/save',
      status: 500,
      message: 'POST /save 500',
    });
  });

  it("hears the window's console and fetches once, and leaves its own fetch unheard", async () => {
    const fetches: string[] = [];
    const window = {
      console: { error: vi.fn(), warn: vi.fn() },
      document,
      addEventListener: vi.fn(),
      fetch: (input: string) => {
        fetches.push(input);
        return Promise.resolve(new Response('', { status: input === '/bad' ? 500 : 200 }));
      },
      XMLHttpRequest: class {
        open(): void {}
      },
    } as unknown as Window & typeof globalThis;
    const heard = hear(window);
    expect(hear(window)).toBe(heard);
    window.console.error('boom');
    await window.fetch('/bad');
    await window.fetch('/good');
    await heard.fetch('/own');
    expect(heard.diagnostics.recent().map((entry) => entry.message)).toEqual(['boom', 'GET /bad 500']);
    expect(fetches).toEqual(['/bad', '/good', '/own']);
  });

  it('hears nothing where the page turns it off', () => {
    document.head.innerHTML = '<meta name="annotate-console" content="off">';
    const error = vi.fn();
    const window = { console: { error, warn: vi.fn() }, document, fetch: vi.fn() } as unknown as Window &
      typeof globalThis;
    hear(window).diagnostics.recordValues('error', ['direct']);
    window.console.error('not heard');
    expect(window.console.error).toBe(error);
    document.head.innerHTML = '';
  });
});
