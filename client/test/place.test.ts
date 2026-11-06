import { describe, expect, it } from 'vitest';
import {
  GAP,
  between,
  cropPixels,
  holds,
  offsetBy,
  overlap,
  popoverAt,
  relativeTo,
  scaleFor,
  showsWindow,
  spread,
} from '../src/place';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('places on the window', () => {
  it('a drag spans its points whichever way it went', () => {
    expect(between([50, 80], [10, 20])).toEqual(rect(10, 20, 40, 60));
    expect(between([10, 20], [50, 80])).toEqual(rect(10, 20, 40, 60));
  });

  it('a region holds what lies wholly in it and has a size', () => {
    const region = rect(10, 10, 100, 100);
    expect(holds(region, rect(20, 20, 30, 30))).toBe(true);
    expect(holds(region, region)).toBe(true);
    expect(holds(region, rect(90, 20, 30, 30))).toBe(false);
    expect(holds(region, rect(20, 20, 0, 0))).toBe(false);
  });

  it('a rect in a canvas moves by the canvas place, and back', () => {
    const canvas = rect(100, 200, 50, 50);
    expect(offsetBy(rect(5, 6, 2, 3), canvas)).toEqual(rect(105, 206, 2, 3));
    expect(relativeTo(rect(105, 206, 2, 3), canvas)).toEqual(rect(5, 6, 2, 3));
  });

  it('two rects overlap where both cover', () => {
    expect(overlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toEqual(rect(5, 5, 5, 5));
    expect(overlap(rect(0, 0, 10, 10), rect(20, 20, 5, 5))).toBeUndefined();
  });

  it('the popover goes right of its target, then left, then under', () => {
    const at = (anchor: ReturnType<typeof rect>) => popoverAt(anchor, 300, 200, [1000, 800], 80);
    expect(at(rect(100, 100, 50, 20)).left).toBe(162);
    expect(at(rect(800, 100, 50, 20)).left).toBe(488);
    const under = at(rect(100, 100, 800, 20));
    expect([under.left, under.edge]).toEqual([100, { top: 132 }]);
    expect(popoverAt(rect(10, 10, 5, 5), 300, 200, [200, 800], 80).left).toBe(GAP);
  });

  it('the popover grows up from the bar where too little room is left under its target', () => {
    const low = popoverAt(rect(100, 600, 50, 20), 300, 200, [1000, 800], 80);
    expect(low.edge).toEqual({ bottom: 92 });
    expect(low.maxHeight).toBe(696);
    const high = popoverAt(rect(100, 100, 50, 20), 300, 200, [1000, 800], 80);
    expect(high.edge).toEqual({ top: 100 });
    expect(high.maxHeight).toBe(608);
  });

  it('pins that would cover each other go side by side within the window', () => {
    expect(
      spread(
        [
          [10, 10],
          [10, 10],
          [20, 15],
          [300, 10],
        ],
        28,
        500,
      ),
    ).toEqual([
      [10, 10],
      [38, 10],
      [76, 15],
      [300, 10],
    ]);
    expect(
      spread(
        [
          [490, 10],
          [490, 10],
        ],
        28,
        476,
      ),
    ).toEqual([
      [476, 10],
      [448, 10],
    ]);
  });

  it("a crop takes the frame's pixels around its target within the frame", () => {
    const window = [800, 600] as const;
    const frame = [1600, 1200] as const;
    expect(cropPixels(rect(100, 100, 50, 20), 10, window, frame)).toEqual([180, 180, 140, 80]);
    expect(cropPixels(rect(0, 0, 20, 20), 10, window, frame)).toEqual([0, 0, 60, 60]);
    expect(cropPixels(rect(900, 0, 20, 20), 10, window, frame)).toBeUndefined();
    expect(cropPixels(rect(0, 0, 20, 20), 10, [0, 0], frame)).toBeUndefined();
  });

  it('a frame of another shape than the window shows more than the tab', () => {
    expect(showsWindow([1600, 1200], [800, 600])).toBe(true);
    expect(showsWindow([1600, 1210], [800, 600])).toBe(true);
    expect(showsWindow([1920, 1080], [800, 600])).toBe(false);
    expect(showsWindow([1600, 1300], [800, 600])).toBe(false);
  });

  it('a big picture is scaled to its budget of pixels', () => {
    expect(scaleFor(1000, 1000, 4_000_000, 1)).toBe(1);
    expect(scaleFor(4000, 2000, 2_000_000, 1)).toBeCloseTo(0.5);
    expect(scaleFor(4000, 2000, 2_000_000, 0.5)).toBeCloseTo(0.5);
  });
});
