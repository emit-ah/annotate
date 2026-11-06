// The shared tab (FR-ANN-003 of tutti): while the mode is on, the browser streams the tab, and each annotation takes a
// still of it without the mode's own parts, from which come the crop around the target and the window at half size,
// in PNG of at most MAX_PNG_BYTES. What the app redacts is painted over first. Only a tab is taken: a window or a
// screen would show more than the app, and its pixels would not match the page's.

import { MAX_PNG_BYTES, type Rect } from './model';
import { cropPixels, scaleFor, showsWindow, type Area, type Size } from './place';

/** The CSS pixels around a target that its crop takes too. */
const MARGIN = 24;

/** How much smaller a picture gets each time it is still too big. */
const SHRINK = 0.7;

/** The pixels a picture starts from at most, about what fits MAX_PNG_BYTES for a page. */
const MAX_PIXELS = 3_000_000;

/** The scale of the window's picture. */
const FRAME_SCALE = 0.5;

/** The colour that covers what the app redacts. */
const COVER = '#000000';

/** The bytes Base64 is made of at a time, below the arguments a call takes. */
const BASE64_CHUNK = 0x8000;

/** Why the tab is not shared. */
export type Unshared = { unshared: 'not-the-tab' } | { unshared: 'declined'; error: unknown };

/** The pictures of an annotation, in Base64, and the crop as a URL the popover shows. */
export interface Pictures {
  crop?: string;
  cropUrl?: string;
  frame?: string;
}

/** The window's size in CSS pixels. */
export function windowSize(): Size {
  return [window.innerWidth, window.innerHeight];
}

/** `bytes` in Base64. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** A canvas of `width` by `height` pixels and its context. */
function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (context === null) {
    throw new Error('the browser draws no 2D canvas');
  }
  return [element, context];
}

/** The PNG of `element`. */
function png(element: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    element.toBlob((blob) => (blob === null ? reject(new Error('no PNG')) : resolve(blob)), 'image/png'),
  );
}

/** A still of the tab and the window's size in CSS pixels it was taken at. */
export class Still {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly window: Size,
  ) {}

  /** The pictures of an annotation whose target is at `target`, with `covered` painted over. */
  async pictures(target: Rect, covered: readonly Rect[]): Promise<Pictures> {
    const frame: Size = [this.canvas.width, this.canvas.height];
    this.cover(covered, frame);
    const area = cropPixels(target, MARGIN, this.window, frame);
    const crop = area === undefined ? undefined : await this.png(area, 1).catch(() => undefined);
    const whole = await this.png([0, 0, frame[0], frame[1]], FRAME_SCALE).catch(() => undefined);
    return {
      ...(crop === undefined ? {} : { crop: crop.base64, cropUrl: URL.createObjectURL(crop.blob) }),
      ...(whole === undefined ? {} : { frame: whole.base64 }),
    };
  }

  /** Paints `covered`, in the window's CSS pixels, over in the still of `frame` pixels. */
  private cover(covered: readonly Rect[], frame: Size): void {
    const context = this.canvas.getContext('2d');
    if (context === null) {
      return;
    }
    const scaleX = frame[0] / this.window[0];
    const scaleY = frame[1] / this.window[1];
    context.fillStyle = COVER;
    for (const rect of covered) {
      context.fillRect(rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY);
    }
  }

  /** The pixels of `area` at `scale` at most, smaller until they fit MAX_PNG_BYTES. */
  private async png(area: Area, start: number): Promise<{ base64: string; blob: Blob }> {
    const [left, top, width, height] = area;
    for (let scale = scaleFor(width, height, MAX_PIXELS, start); ; scale *= SHRINK) {
      const outWidth = Math.max(Math.round(width * scale), 1);
      const outHeight = Math.max(Math.round(height * scale), 1);
      const [out, context] = canvas(outWidth, outHeight);
      context.drawImage(this.canvas, left, top, width, height, 0, 0, outWidth, outHeight);
      const blob = await png(out);
      if (blob.size <= MAX_PNG_BYTES) {
        return { base64: base64(new Uint8Array(await blob.arrayBuffer())), blob };
      }
      if (outWidth === 1 && outHeight === 1) {
        throw new Error('the picture does not fit');
      }
    }
  }
}

/** The tab as the browser streams it. */
export class Capture {
  private constructor(
    private readonly stream: MediaStream,
    private readonly video: HTMLVideoElement,
  ) {}

  /** Asks the browser to share this tab, which it asks the user; `ended` runs when the user stops sharing. */
  static async start(ended: () => void): Promise<Capture | Unshared> {
    // Newer than the DOM's types: offer this tab first, and no other tab to switch to.
    const options: DisplayMediaStreamOptions & Record<string, unknown> = {
      video: true,
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(options);
    } catch (error) {
      return { unshared: 'declined', error };
    }
    const [track] = stream.getVideoTracks();
    const settings: MediaTrackSettings & { displaySurface?: string } = track?.getSettings() ?? {};
    if (settings.displaySurface !== 'browser') {
      stream.getTracks().forEach((each) => each.stop());
      return { unshared: 'not-the-tab' };
    }
    stream.getTracks().forEach((each) => each.addEventListener('ended', ended));
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (error) {
      stream.getTracks().forEach((each) => each.stop());
      return { unshared: 'declined', error };
    }
    return new Capture(stream, video);
  }

  /** Takes a still of the tab now; it throws before the first frame, or where the frame does not show the window. */
  still(): Still {
    const frame: Size = [this.video.videoWidth, this.video.videoHeight];
    const window = windowSize();
    if (!showsWindow(frame, window)) {
      throw new Error('the frame does not show the window');
    }
    const [element, context] = canvas(frame[0], frame[1]);
    context.drawImage(this.video, 0, 0, frame[0], frame[1]);
    return new Still(element, window);
  }

  /** Stops the stream. */
  stop(): void {
    this.stream.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
  }
}
