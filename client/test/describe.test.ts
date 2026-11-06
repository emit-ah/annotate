import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  anchor,
  brief,
  describe as describeElement,
  implicitRole,
  inRegion,
  isOurs,
  isPlainPath,
  isPrivate,
  locate,
  picked,
  stepped,
  textsToLookUp,
} from '../src/describe';

/** Gives `element` the box `rect`, as jsdom lays nothing out. */
function box(element: Element | null, x: number, y: number, width: number, height: number): void {
  if (element === null) {
    throw new Error('no element');
  }
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x, y, width, height } as DOMRect);
}

const role = (tag: string, attributes: Record<string, string> = {}) =>
  implicitRole(tag, (name) => attributes[name] ?? null);

beforeEach(() => {
  document.body.innerHTML = `
    <main data-annotate-component="Settings">
      <h1>Account</h1>
      <label for="nick">Nickname</label><input id="nick">
      <button type="button" data-annotate-id="settings-save" aria-label="Save changes"><span>Save</span></button>
      <section data-annotate-redact data-annotate-label="Balance card"><p>4,200.00 EUR</p></section>
      <section data-annotate-private><p id="code">alpha-bravo</p></section>
      <div><span>Hello <b>you</b></span></div>
    </main>`;
});

describe('what an element is', () => {
  it('elements without a role of their own have the browser’s', () => {
    expect(role('button')).toBe('button');
    expect(role('a', { href: '/learn' })).toBe('link');
    expect(role('a')).toBeUndefined();
    expect(role('input')).toBe('textbox');
    expect(role('input', { type: 'Search' })).toBe('searchbox');
    expect(role('input', { type: 'range' })).toBe('slider');
    expect(role('input', { type: 'hidden' })).toBeUndefined();
    expect(role('h2')).toBe('heading');
    expect(role('img', { alt: '' })).toBeUndefined();
    expect(role('summary')).toBe('button');
    expect(role('div')).toBeUndefined();
  });

  it('an element is named and identified as tests find it, with the app’s text IDs', () => {
    const button = document.querySelector('button');
    if (button === null) throw new Error('no button');
    const described = describeElement(button, ['common-save']);
    expect(described).toMatchObject({
      role: 'button',
      name: 'Save changes',
      tag: 'button',
      text: 'Save',
      text_ids: ['settings-save', 'common-save'],
      components: ['Settings'],
      dom_path: 'body > main:nth-of-type(1) > button:nth-of-type(1)',
      redacted: false,
    });
    expect(textsToLookUp(button)).toEqual(['Save changes', 'Save']);
  });

  it('a field is named by its label', () => {
    expect(describeElement(document.getElementById('nick') as Element, []).name).toBe('Nickname');
  });

  it('a redacted element keeps its role and the app’s label, and no text', () => {
    const amount = document.querySelector('section p');
    if (amount === null) throw new Error('no amount');
    const described = describeElement(amount, []);
    expect(described).toMatchObject({ tag: 'p', text: '', redacted: true });
    expect(described.name).toBeUndefined();
    expect(textsToLookUp(amount)).toEqual([]);
    const card = describeElement(amount.parentElement as Element, []);
    expect(card.name).toBe('Balance card');
    expect(JSON.stringify(describeElement(document.querySelector('main') as Element, []))).not.toContain('4,200');
  });

  it('a private element is no target', () => {
    expect(isPrivate(document.getElementById('code') as Element)).toBe(true);
    expect(isPrivate(document.querySelector('h1') as Element)).toBe(false);
  });

  it('a pointer picks the element that shows text of its own, else the nearest pickable', () => {
    const bold = document.querySelector('b') as Element;
    expect(picked(bold)).toBe(bold);
    expect(picked(document.querySelector('button span') as Element)).toBe(document.querySelector('button span'));
    const wrapper = document.querySelector('div') as Element;
    expect(picked(wrapper)).toBe(wrapper);
  });

  it('the arrows step out, in and along pickable elements', () => {
    const heading = document.querySelector('h1') as Element;
    expect(stepped(heading, 'on')).toBe(document.querySelector('label'));
    expect(stepped(document.querySelector('label') as Element, 'back')).toBe(heading);
    expect(stepped(heading, 'back')).toBeUndefined();
    expect(stepped(document.querySelector('button span') as Element, 'out')).toBe(document.querySelector('button'));
  });

  it('only paths as this module writes them are looked up', () => {
    expect(isPlainPath('#main > div:nth-of-type(2) > a:nth-of-type(1)')).toBe(true);
    expect(isPlainPath('div:has(*:has(*))')).toBe(false);
    expect(isPlainPath('a[href^=x]')).toBe(false);
    expect(isPlainPath('')).toBe(false);
  });

  it('a recorded element is found again while it has its tag, role and name, else pinned where it was', () => {
    const button = document.querySelector('button') as Element;
    box(button, 10, 20, 100, 30);
    const described = describeElement(button, []);
    expect(locate(document, described)).toBe(button);
    expect(locate(document, { ...described, name: 'Other' })).toBeUndefined();
    const moved = { kind: 'element' as const, ...described, rect: { x: 1, y: 1, width: 1, height: 1 } };
    expect(anchor(document, moved)).toEqual({ x: 10, y: 20, width: 100, height: 30 });
    expect(anchor(document, { ...moved, dom_path: 'a[x]' })).toEqual(moved.rect);
  });

  it('a region holds the outermost elements wholly in it, never private ones', () => {
    box(document.querySelector('h1'), 0, 0, 100, 20);
    box(document.querySelector('label'), 0, 30, 50, 20);
    box(document.querySelector('button'), 0, 60, 80, 20);
    box(document.querySelector('button span'), 5, 62, 40, 16);
    box(document.getElementById('code'), 0, 90, 80, 20);
    const found = inRegion(document, { x: 0, y: 0, width: 200, height: 200 });
    expect(found.map((element) => element.localName)).toEqual(['h1', 'label', 'button']);
  });

  it('the mode’s own parts are no target, also in its shadow root', () => {
    const host = document.createElement('annotate-mode');
    const inner = document.createElement('button');
    host.attachShadow({ mode: 'open' }).appendChild(inner);
    document.body.appendChild(host);
    expect(isOurs(inner)).toBe(true);
    expect(isOurs(host)).toBe(true);
    expect(isOurs(document.querySelector('h1') as Element)).toBe(false);
  });

  it('an element in brief is its role and name', () => {
    expect(brief(document.querySelector('button') as Element)).toEqual(['button', 'Save changes']);
    expect(brief(document.querySelector('section p') as Element)).toEqual(['paragraph', undefined]);
  });
});
