import { describe, expect, it } from 'vitest';
import { asksForMode, browserInBrief, minuteOf, onMac, queryWithoutMode, shortVersion } from '../src/address';

describe('where an annotation was made', () => {
  it('the mode is asked for by its parameter and leaves the query', () => {
    expect(asksForMode('?annotate')).toBe(true);
    expect(asksForMode('?step=2&annotate=1')).toBe(true);
    expect(asksForMode('?annotated')).toBe(false);
    expect(asksForMode('')).toBe(false);
    expect(queryWithoutMode('?step=2&annotate&view=page')).toBe('step=2&view=page');
    expect(queryWithoutMode('?annotate')).toBe('');
  });

  it('the browser is named in brief', () => {
    const chrome =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36';
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57';
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    expect(browserInBrief(chrome)).toBe('Chrome 141');
    expect(browserInBrief(edge)).toBe('Edge 141');
    expect(browserInBrief(firefox)).toBe('Firefox 143');
    expect(browserInBrief(safari)).toBe('Safari 26');
    expect(browserInBrief('curl/8')).toBe('curl/8');
    expect(onMac(safari)).toBe(true);
    expect(onMac(chrome)).toBe(false);
  });

  it('a commit in brief keeps its mark of changes, and a version stays as it is', () => {
    expect(shortVersion('47d97f7c0ffee')).toBe('47d97f7');
    expect(shortVersion('47d97f7c0ffee+dirty')).toBe('47d97f7+dirty');
    expect(shortVersion('1.4.0')).toBe('1.4.0');
    expect(shortVersion('abc')).toBe('abc');
  });

  it('a time is shown to its minute', () => {
    expect(minuteOf('2026-10-09T18:42:07.123Z')).toBe('2026-10-09 18:42');
    expect(minuteOf('yesterday')).toBe('yesterday');
  });
});
