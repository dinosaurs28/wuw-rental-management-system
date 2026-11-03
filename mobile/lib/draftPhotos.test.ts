// Paused pickup / drop photos (Nov 3 2026): restore / merge logic and the
// on-phone record of shots not in the server draft yet.
//
//   cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/draftPhotos.test.ts
// (no test runner in the app itself; the backend's tsx runs it under node)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeKeepPhotos,
  mergeRestoredPhotos,
  parseShots,
  photoRefs,
  serializeShots,
  shotRecordKey,
  shotRecordPrefix,
  unuploadedShots,
  uploadedShotPhotos,
  withoutFileIds,
  SHOT_RECORD_MAX_AGE_MS,
  type StoredShot,
} from './draftPhotos';
import {
  __setFileSystemForTests,
  clearShotRecords,
  dropShot,
  forgetFileIds,
  keepShot,
  loadShots,
  markShotUploaded,
  shotRecordAvailable,
  shotUploading,
  uploadShot,
} from './pendingShotStore';

const p = (fileId: string, extra: { label?: string; capturedAt?: number } = {}) => ({
  fileId,
  url: `https://photos.test/pickup/${fileId}.jpg`,
  ...extra,
});
const ids = (list: Array<{ fileId: string }>) => list.map((x) => x.fileId);

// ── mergeRestoredPhotos ─────────────────────────────────────────────────────

test('restore keeps the saved list, order and labels exactly when the screen is empty', () => {
  const saved = [p('a', { label: 'Front' }), p('b'), p('c', { label: 'Rear' }), p('d')];
  const out = mergeRestoredPhotos(saved, []);
  assert.deepEqual(out, saved);
  assert.deepEqual(photoRefs(out), [
    { fileId: 'a', label: 'Front' },
    { fileId: 'b', label: null },
    { fileId: 'c', label: 'Rear' },
    { fileId: 'd', label: null },
  ]);
});

test('restore no longer wipes photos taken while the draft was loading (old: setPhotos(saved))', () => {
  const saved = [p('a'), p('b')];
  const current = [p('new1', { capturedAt: 1000 }), p('new2', { capturedAt: 2000 })];
  assert.deepEqual(ids(mergeRestoredPhotos(saved, current)), ['a', 'b', 'new1', 'new2']);
});

test('restore dedupes a photo that is both saved and on screen', () => {
  const saved = [p('a'), p('b')];
  const current = [p('b', { capturedAt: 5 }), p('c', { capturedAt: 6 })];
  assert.deepEqual(ids(mergeRestoredPhotos(saved, current)), ['a', 'b', 'c']);
});

test('restore: a labelled slot retaken on this phone replaces the saved one in place', () => {
  const saved = [p('a', { label: 'Front' }), p('b', { label: 'Rear' }), p('c')];
  const current = [p('front2', { label: 'Front', capturedAt: 9 })];
  const out = mergeRestoredPhotos(saved, current);
  assert.deepEqual(ids(out), ['front2', 'b', 'c']);
  assert.equal(out[0]!.label, 'Front');
});

test('restore: a labelled slot without a capture time (older copy) keeps the saved photo', () => {
  const saved = [p('a', { label: 'Front' })];
  const out = mergeRestoredPhotos(saved, [p('x', { label: 'Front' })]);
  assert.deepEqual(ids(out), ['a']);
});

test('restore keeps phone shots in capture order among themselves', () => {
  const saved = [p('s1'), p('s2')];
  const current = [p('late', { capturedAt: 30 }), p('early', { capturedAt: 10 }), p('mid', { capturedAt: 20 })];
  assert.deepEqual(ids(mergeRestoredPhotos(saved, current)), ['s1', 's2', 'early', 'mid', 'late']);
});

test('restore drops duplicate ids inside the saved list', () => {
  assert.deepEqual(ids(mergeRestoredPhotos([p('a'), p('a'), p('b')], [])), ['a', 'b']);
});

// ── mergeKeepPhotos ("Keep mine" after a conflict) ──────────────────────────

test('keep mine adds the other phone photos instead of dropping them', () => {
  const mine = [p('m1', { label: 'Front' }), p('m2')];
  const other = [p('o1', { label: 'Front' }), p('m2'), p('o2'), p('o3', { label: 'Rear' })];
  const out = mergeKeepPhotos(mine, other);
  assert.deepEqual(ids(out), ['m1', 'm2', 'o2', 'o3']);
});

// ── shot records (pure) ─────────────────────────────────────────────────────

test('record keys are per operation + vehicle and folder-safe', () => {
  const key = shotRecordKey('pickup', 'bk_ab/c', 'KA 20 E 1');
  assert.ok(key.startsWith(shotRecordPrefix('pickup', 'bk_ab/c')));
  assert.match(key, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(shotRecordKey('pickup', 'b1', 'v1'), shotRecordKey('return', 'b1', 'v1'));
  assert.notEqual(shotRecordKey('pickup', 'b1', 'v1'), shotRecordKey('pickup', 'b1', 'v2'));
  assert.ok(!shotRecordKey('pickup', 'b10', 'v').startsWith(shotRecordPrefix('pickup', 'b1')));
});

test('serialize → parse round-trips every field; damaged / old input is tolerated', () => {
  const now = 1_800_000_000_000;
  const shots: StoredShot[] = [
    { key: 'k1', uri: 'file:///doc/a.jpg', width: 3000, capturedAt: now - 5, label: 'Front' },
    { key: 'k2', uri: 'file:///doc/b.jpg', width: 3000, capturedAt: now - 4, fileId: 'f2', url: 'https://x/f2' },
  ];
  assert.deepEqual(parseShots(serializeShots(shots, now), now), shots);
  assert.deepEqual(parseShots('not json', now), []);
  assert.deepEqual(parseShots(null, now), []);
  assert.deepEqual(parseShots(JSON.stringify({ shots: 'x' }), now), []);
  const mixed = JSON.stringify({
    v: 1,
    shots: [
      { key: 'ok', uri: 'file:///a', width: 1, capturedAt: now },
      { key: 'ok', uri: 'file:///dup', width: 1, capturedAt: now },
      { key: 'old', uri: 'file:///b', width: 1, capturedAt: now - SHOT_RECORD_MAX_AGE_MS - 1 },
      { key: 'nouri', width: 1, capturedAt: now },
      null,
      { key: 'halfupload', uri: 'file:///c', width: 1, capturedAt: now, fileId: 'f' },
    ],
  });
  const parsed = parseShots(mixed, now);
  assert.deepEqual(parsed.map((s) => s.key), ['ok', 'halfupload']);
  assert.equal(parsed[1]!.fileId, undefined, 'a fileId without its url is not an uploaded shot');
});

test('uploaded / unuploaded split and forgetting saved ids', () => {
  const shots: StoredShot[] = [
    { key: 'b', uri: 'u2', width: 1, capturedAt: 20, fileId: 'f2', url: 'x2', label: 'Rear' },
    { key: 'a', uri: 'u1', width: 1, capturedAt: 10, fileId: 'f1', url: 'x1' },
    { key: 'c', uri: 'u3', width: 1, capturedAt: 30 },
  ];
  assert.deepEqual(uploadedShotPhotos(shots), [
    { fileId: 'f1', url: 'x1', capturedAt: 10 },
    { fileId: 'f2', url: 'x2', capturedAt: 20, label: 'Rear' },
  ]);
  assert.deepEqual(unuploadedShots(shots).map((s) => s.key), ['c']);
  assert.deepEqual(withoutFileIds(shots, ['f1']).map((s) => s.key), ['b', 'c']);
});

// ── the on-phone store against an in-memory file system ─────────────────────

function fakeFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const join = (parts: unknown[]) =>
    parts.map((x) => (typeof x === 'string' ? x : (x as { uri: string }).uri).replace(/\/+$/, '')).join('/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return dirs.has(this.uri); }
    get name() { return this.uri.split('/').pop()!; }
    create() { dirs.add(this.uri); }
    delete() {
      for (const d of [...dirs]) if (d === this.uri || d.startsWith(`${this.uri}/`)) dirs.delete(d);
      for (const f of [...files.keys()]) if (f.startsWith(`${this.uri}/`)) files.delete(f);
    }
    list() {
      const kids = new Set<string>();
      for (const d of dirs) if (d.startsWith(`${this.uri}/`) && !d.slice(this.uri.length + 1).includes('/')) kids.add(d);
      return [...kids].map((d) => new Directory(d));
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return files.has(this.uri); }
    create() { files.set(this.uri, ''); }
    write(c: string) { files.set(this.uri, c); }
    textSync() { return files.get(this.uri) ?? ''; }
    delete() { files.delete(this.uri); }
    copy(dest: File) { files.set(dest.uri, files.get(this.uri) ?? ''); }
    move(dest: File) { this.copy(dest); files.delete(this.uri); this.uri = dest.uri; }
  }
  return { files, dirs, mod: { File, Directory, Paths: { document: new Directory('file:///doc') } } };
}

test('store: a shot is moved out of the camera cache, survives a restart, and goes once the draft has it', () => {
  const fs = fakeFs();
  __setFileSystemForTests(fs.mod);
  assert.equal(shotRecordAvailable(), true);
  const rec = shotRecordKey('pickup', 'bk1', 'KA20');
  fs.files.set('file:///cache/Camera/one.jpg', 'JPEG1');
  fs.files.set('file:///cache/Camera/two.jpg', 'JPEG2');
  const u1 = keepShot(rec, { key: 's1', uri: 'file:///cache/Camera/one.jpg', width: 4000, capturedAt: Date.now(), label: 'Front' });
  const u2 = keepShot(rec, { key: 's2', uri: 'file:///cache/Camera/two.jpg', width: 4000, capturedAt: Date.now() + 1 });
  assert.ok(u1.startsWith('file:///doc/pending-photos/'), 'moved into the documents folder');
  assert.equal(fs.files.has('file:///cache/Camera/one.jpg'), false, 'no longer in the purgeable cache');
  assert.equal(fs.files.get(u1), 'JPEG1');

  markShotUploaded(rec, 's1', 'file_1', 'https://x/file_1');

  // App killed and started again: memory gone, disk read back.
  __setFileSystemForTests(fs.mod);
  const back = loadShots(rec);
  assert.deepEqual(back.map((s) => [s.key, s.fileId ?? null, s.label ?? null]), [
    ['s1', 'file_1', 'Front'],
    ['s2', null, null],
  ]);
  assert.equal(back[1]!.uri, u2);

  // The server draft now holds file_1: its copy goes, the unuploaded shot stays.
  forgetFileIds(rec, ['file_1']);
  assert.deepEqual(loadShots(rec).map((s) => s.key), ['s2']);
  assert.equal(fs.files.has(u1), false);

  // Staff removed the failed shot.
  dropShot(rec, 's2');
  assert.deepEqual(loadShots(rec), []);
  assert.equal(fs.files.has(u2), false);
});

test('store: a shot whose file vanished is not brought back for upload', () => {
  const fs = fakeFs();
  __setFileSystemForTests(fs.mod);
  const rec = shotRecordKey('return', 'bk2', 'v|0');
  fs.files.set('file:///cache/a.jpg', 'A');
  const uri = keepShot(rec, { key: 'k', uri: 'file:///cache/a.jpg', width: 10, capturedAt: Date.now() });
  fs.files.delete(uri);
  __setFileSystemForTests(fs.mod);
  assert.deepEqual(loadShots(rec), []);
});

test('store: completing / discarding clears every record of that operation only', () => {
  const fs = fakeFs();
  __setFileSystemForTests(fs.mod);
  for (const [kind, bk, v] of [['pickup', 'bk1', 'A'], ['pickup', 'bk1', 'B'], ['pickup', 'bk12', 'A'], ['return', 'bk1', 'A']]) {
    const src = `file:///cache/${kind}${bk}${v}.jpg`;
    fs.files.set(src, 'x');
    keepShot(shotRecordKey(kind!, bk!, v), { key: `${kind}${bk}${v}`, uri: src, width: 1, capturedAt: Date.now() });
  }
  clearShotRecords(shotRecordPrefix('pickup', 'bk1'));
  __setFileSystemForTests(fs.mod);
  assert.equal(loadShots(shotRecordKey('pickup', 'bk1', 'A')).length, 0);
  assert.equal(loadShots(shotRecordKey('pickup', 'bk1', 'B')).length, 0);
  assert.equal(loadShots(shotRecordKey('pickup', 'bk12', 'A')).length, 1);
  assert.equal(loadShots(shotRecordKey('return', 'bk1', 'A')).length, 1);
});

test('store: an upload started before the screen closed is joined, not repeated, and recorded', async () => {
  const fs = fakeFs();
  __setFileSystemForTests(fs.mod);
  const rec = shotRecordKey('pickup', 'bk3', 'V');
  fs.files.set('file:///cache/z.jpg', 'Z');
  keepShot(rec, { key: 'z', uri: 'file:///cache/z.jpg', width: 1, capturedAt: Date.now() });
  let calls = 0;
  let release!: () => void;
  const start = () => {
    calls++;
    return new Promise<{ fileId: string; url: string }>((resolve) => {
      release = () => resolve({ fileId: 'fz', url: 'https://x/fz' });
    });
  };
  const first = uploadShot(rec, 'z', start); // the screen that was left
  assert.equal(shotUploading('z'), true);
  const second = uploadShot(rec, 'z', start); // the screen opened again
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  assert.equal(shotUploading('z'), false);
  assert.equal(loadShots(rec)[0]!.fileId, 'fz', 'recorded although nobody was there to commit it');
});

test('store: a failed upload can be retried', async () => {
  const fs = fakeFs();
  __setFileSystemForTests(fs.mod);
  const rec = shotRecordKey('pickup', 'bk4', 'V');
  await assert.rejects(uploadShot(rec, 'f', () => Promise.reject(new Error('offline'))));
  assert.equal(shotUploading('f'), false);
  const ok = await uploadShot(rec, 'f', () => Promise.resolve({ fileId: 'ff', url: 'u' }));
  assert.equal(ok.fileId, 'ff');
});

test('store: without expo-file-system everything is a no-op', () => {
  __setFileSystemForTests(null);
  assert.equal(shotRecordAvailable(), false);
  const rec = shotRecordKey('pickup', 'bk5', 'V');
  assert.equal(keepShot(rec, { key: 'n', uri: 'file:///cache/n.jpg', width: 1, capturedAt: Date.now() }), 'file:///cache/n.jpg');
  assert.equal(loadShots(rec).length, 1, 'still listed in memory for this app run');
  clearShotRecords(shotRecordPrefix('pickup', 'bk5'));
});

// ── the full pause → resume photo path (pure simulation of the screen) ──────

test('pause with 2 uploaded, 1 uploading, 1 failed → resume shows all 4 in the order taken', async () => {
  const fs = fakeFs();
  __setFileSystemForTests(fs.mod);
  const rec = shotRecordKey('pickup', 'bk6', 'KA20');
  const t0 = Date.now();
  const shot = (k: string, i: number, label?: string) => {
    fs.files.set(`file:///cache/${k}.jpg`, k);
    keepShot(rec, { key: k, uri: `file:///cache/${k}.jpg`, width: 1, capturedAt: t0 + i, ...(label ? { label } : {}) });
  };
  shot('s1', 1, 'Front'); shot('s2', 2); shot('s3', 3); shot('s4', 4);
  // s1, s2 uploaded and saved in the server draft (autosave)
  markShotUploaded(rec, 's1', 'f1', 'u1');
  markShotUploaded(rec, 's2', 'f2', 'u2');
  const serverDraft = [p('f1', { label: 'Front' }), p('f2')];
  forgetFileIds(rec, ['f1', 'f2']);
  // s3 still uploading when Continue later is tapped: it finishes after the screen closed
  await uploadShot(rec, 's3', async () => ({ fileId: 'f3', url: 'u3' }));
  // s4 failed: nothing recorded beyond the shot itself
  await assert.rejects(uploadShot(rec, 's4', async () => { throw new Error('timeout'); }));

  // App restarted, pickup reopened: PhotoCaptureSection reads the record…
  __setFileSystemForTests(fs.mod);
  const kept = loadShots(rec);
  let screen = mergeRestoredPhotos([] as ReturnType<typeof p>[], uploadedShotPhotos(kept) as ReturnType<typeof p>[]);
  const toUpload = unuploadedShots(kept).map((s) => s.key);
  assert.deepEqual(ids(screen), ['f3']);
  assert.deepEqual(toUpload, ['s4']);
  // …the server draft arrives and is merged, not replacing
  screen = mergeRestoredPhotos(serverDraft, screen);
  // …s4 re-uploads from its durable copy
  const r4 = await uploadShot(rec, 's4', async () => ({ fileId: 'f4', url: 'u4' }));
  screen = [...screen, { fileId: r4.fileId, url: r4.url, capturedAt: t0 + 4 }];
  assert.deepEqual(ids(screen), ['f1', 'f2', 'f3', 'f4']);
  assert.deepEqual(photoRefs(screen).map((x) => x.label), ['Front', null, null, null]);
  // The autosave lands: nothing is left on the phone
  forgetFileIds(rec, ids(screen));
  assert.deepEqual(loadShots(rec), []);
});
