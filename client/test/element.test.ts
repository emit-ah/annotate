import { describe, expect, it, vi } from 'vitest';
import { api, install, mount } from '../src/index';

describe('the page’s API and element', () => {
  it('offers window.annotate to any script, and says when it is ready', () => {
    const ready = vi.fn();
    document.addEventListener('annotate:ready', ready);
    install();
    const global: unknown = Reflect.get(window, 'annotate');
    expect(global).toEqual(api);
    expect(Object.isFrozen(global)).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
    expect(() => api.register('nothing' as 'state', () => [])).toThrow(/has no hook nothing/);
  });

  it('mounts one element, which its shortcut switches on and Escape off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    document.head.innerHTML = '<meta name="annotate-app" content="demo"><meta name="annotate-version" content="1.0.0">';
    const element = mount();
    expect(mount()).toBe(element);
    expect(document.querySelectorAll('annotate-mode')).toHaveLength(1);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', altKey: true, shiftKey: true, bubbles: true }),
    );
    await vi.waitFor(() => expect(element.mode?.state).toMatchObject({ stage: 'unable', unable: 'no-service' }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(element.mode?.state.stage).toBe('off');
    element.remove();
    expect(element.mode).toBeUndefined();
  });
});
