import { describe, expect, it } from 'vitest';
import { MAX_ITEMS, MAX_TEXT } from '../src/model';
import { asEntries, asHits, asText, asTexts, squeezed } from '../src/text';

describe("the host's answers, read as the record's types", () => {
  it('texts are squeezed and cut', () => {
    expect(squeezed('  Start \n  over ', 20)).toBe('Start over');
    expect(squeezed('Measure one of eight', 7)).toBe('Measure…');
    expect(squeezed('Ünïcödé', 3)).toBe('Ünï…');
  });

  it('a value is a text where it is a string, a number or a boolean, cut to its limit', () => {
    expect(asText(5)).toBe('5');
    expect(asText({})).toBeUndefined();
    expect(asText('x'.repeat(MAX_TEXT + 5))?.length).toBe(MAX_TEXT + 1);
    expect(asTexts(['a', 2, null, ''])).toEqual(['a', '2']);
    expect(asTexts('a')).toEqual([]);
  });

  it('entries come as a list of pairs or an object, at most the limit', () => {
    expect(asEntries([{ name: 'zoom', value: 1.8 }, { name: '', value: 'x' }, 'x'])).toEqual([
      { name: 'zoom', value: '1.8' },
    ]);
    expect(asEntries({ vault: 'demo', open: true })).toEqual([
      { name: 'vault', value: 'demo' },
      { name: 'open', value: 'true' },
    ]);
    expect(asEntries(Object.fromEntries(Array.from({ length: MAX_ITEMS + 5 }, (_, i) => [`n${i}`, i])))).toHaveLength(
      MAX_ITEMS,
    );
    expect(asEntries(null)).toEqual([]);
  });

  it('hits need a kind and words', () => {
    expect(asHits([{ kind: 'card', words: 'note card c1', details: { id: 'c1' } }, { kind: 'card' }, 7])).toEqual([
      { kind: 'card', words: 'note card c1', details: [{ name: 'id', value: 'c1' }] },
    ]);
  });
});
