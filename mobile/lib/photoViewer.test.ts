// Full-screen photo viewer decisions (Nov 15 2026, "full-size photo black").
//
//   cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/photoViewer.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { slideSources, slideView, viewerRetryDelayMs } from './photoViewer';

const FULL = 'https://cdn.example/pickup/a.jpg';
const MD = 'https://cdn.example/pickup/a.jpg__md.jpg';

test('retry delays back off, then stop', () => {
  assert.equal(viewerRetryDelayMs(1), 800);
  assert.equal(viewerRetryDelayMs(2), 2500);
  assert.equal(viewerRetryDelayMs(3), null);
  assert.equal(viewerRetryDelayMs(0), null);
  assert.equal(viewerRetryDelayMs(-1), null);
});

test('the page on screen loads the full photo and the smaller copy', () => {
  assert.deepEqual(slideSources({ url: FULL, previewUrl: MD }, true), { full: FULL, preview: MD });
});

test('neighbours load only the smaller copy (limits concurrent downloads)', () => {
  assert.deepEqual(slideSources({ url: FULL, previewUrl: MD }, false), { full: null, preview: MD });
});

test('without a smaller copy, a neighbour loads the photo itself (one image)', () => {
  assert.deepEqual(slideSources({ url: FULL }, false), { full: FULL, preview: null });
  assert.deepEqual(slideSources({ url: FULL, previewUrl: null }, true), { full: FULL, preview: null });
});

test('a preview equal to the photo, or blank, is ignored', () => {
  assert.deepEqual(slideSources({ url: FULL, previewUrl: FULL }, true), { full: FULL, preview: null });
  assert.deepEqual(slideSources({ url: FULL, previewUrl: '  ' }, true), { full: FULL, preview: null });
});

test('loading: smaller copy under a spinner until it shows', () => {
  const s = slideSources({ url: FULL, previewUrl: MD }, true);
  assert.deepEqual(slideView(s, 'loading', 'loading'), { showPreview: true, showFull: true, spinner: true, notice: 'none' });
  assert.deepEqual(slideView(s, 'loading', 'loaded'), { showPreview: true, showFull: true, spinner: false, notice: 'none' });
});

test('full photo loaded: only it is shown', () => {
  const s = slideSources({ url: FULL, previewUrl: MD }, true);
  assert.deepEqual(slideView(s, 'loaded', 'error'), { showPreview: false, showFull: true, spinner: false, notice: 'none' });
});

test('full photo failed, smaller copy works: the copy stays with "Retry full size"', () => {
  const s = slideSources({ url: FULL, previewUrl: MD }, true);
  assert.deepEqual(slideView(s, 'error', 'loaded'), { showPreview: true, showFull: false, spinner: false, notice: 'smaller-copy' });
  // Still waiting on the copy: spinner, no notice yet
  assert.deepEqual(slideView(s, 'error', 'loading'), { showPreview: true, showFull: false, spinner: true, notice: 'none' });
});

test('the client screenshot: both copies failed -> error panel, never a bare black page', () => {
  const s = slideSources({ url: FULL, previewUrl: MD }, true);
  assert.deepEqual(slideView(s, 'error', 'error'), { showPreview: false, showFull: false, spinner: false, notice: 'failed' });
  const single = slideSources({ url: FULL }, true);
  assert.equal(slideView(single, 'error', 'idle').notice, 'failed');
});

test('a neighbour showing only its smaller copy is not an error', () => {
  const s = slideSources({ url: FULL, previewUrl: MD }, false);
  assert.deepEqual(slideView(s, 'idle', 'loaded'), { showPreview: true, showFull: false, spinner: false, notice: 'none' });
  assert.equal(slideView(s, 'idle', 'error').notice, 'failed');
});

test('a photo with no url at all shows the error panel', () => {
  const s = slideSources({ url: '' }, true);
  assert.equal(slideView(s, 'idle', 'idle').notice, 'failed');
});
