// Full-screen photo viewer decisions (Nov 15 2026, "full-size photo black"):
// which copies a page loads, how long to wait before retrying, and what it
// shows once a copy has loaded or failed. Pure — no React Native imports.

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

// Waits before the automatic retries of one copy (2 retries = 3 attempts),
// then it counts as failed. An immediate retry against a throttled photo host
// (HTTP 429) just fails again.
const RETRY_DELAYS_MS = [800, 2500];

/** Delay before automatic retry `failures` (1-based), or null once they are used up. */
export function viewerRetryDelayMs(failures: number): number | null {
  if (!Number.isInteger(failures) || failures < 1) return null;
  return RETRY_DELAYS_MS[failures - 1] ?? null;
}

export interface SlideSources {
  /** The full-size photo: loaded on the page being viewed only. */
  full: string | null;
  /** The smaller copy: shown while `full` loads, and in its place if it fails. */
  preview: string | null;
}

/**
 * What one page loads. The page on screen loads the full-size photo (with the
 * smaller copy under it); its neighbours, rendered ahead for swiping, load
 * one image each — the smaller copy, or the photo itself when there is none —
 * so a long set never has more than a handful of downloads going at once.
 */
export function slideSources(
  image: { url: string; previewUrl?: string | null },
  active: boolean,
): SlideSources {
  const url = image.url?.trim() ? image.url : null;
  const previewRaw = image.previewUrl?.trim() ? image.previewUrl : null;
  const preview = previewRaw && previewRaw !== url ? previewRaw : null;
  if (active) return { full: url, preview };
  return preview ? { full: null, preview } : { full: url, preview: null };
}

export type SlideNotice =
  /** Nothing to say: a copy is showing, or still loading. */
  | 'none'
  /** The full-size photo failed; the smaller copy is shown with "Retry full size". */
  | 'smaller-copy'
  /** No copy could be loaded: an error panel with Retry (never a bare black page). */
  | 'failed';

export interface SlideView {
  /** Render the smaller copy (under the full photo, or in its place). */
  showPreview: boolean;
  /** Render the full-size photo element. */
  showFull: boolean;
  spinner: boolean;
  notice: SlideNotice;
}

/**
 * What a page shows given the state of its two copies. The smaller copy stays
 * on screen until the full photo has loaded and keeps showing if the full one
 * fails; the error panel appears only when every copy the page has failed.
 */
export function slideView(
  sources: SlideSources,
  full: LoadStatus,
  preview: LoadStatus,
): SlideView {
  const hasFull = !!sources.full;
  const hasPreview = !!sources.preview;
  const fullFailed = !hasFull || full === 'error';
  const previewFailed = !hasPreview || preview === 'error';

  if (hasFull && full === 'loaded') {
    return { showPreview: false, showFull: true, spinner: false, notice: 'none' };
  }
  if (fullFailed && previewFailed) {
    return { showPreview: false, showFull: false, spinner: false, notice: 'failed' };
  }
  const showPreview = hasPreview && preview !== 'error';
  const showFull = hasFull && full !== 'error';
  const previewOnScreen = showPreview && preview === 'loaded';
  return {
    showPreview,
    showFull,
    // Nothing on screen yet
    spinner: !previewOnScreen,
    // The full photo was wanted (page on screen) and failed while the smaller copy works
    notice: hasFull && full === 'error' && previewOnScreen ? 'smaller-copy' : 'none',
  };
}
