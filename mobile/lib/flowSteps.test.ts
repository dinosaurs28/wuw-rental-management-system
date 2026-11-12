// Client TODO 11: step navigation and the merge / recompute decisions of the
// Pickup and Return flows.
//
//   cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/flowSteps.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billChangeNotice,
  bodySignature,
  clampStep,
  firstBlockedBefore,
  handoverChanges,
  mergePhotoLists,
  needsRecompute,
  nextStep,
  pickupSteps,
  prevStep,
  resolveJump,
  returnSteps,
  samePhotoList,
  stepStates,
  type HandoverSnapshot,
} from './flowSteps';

test('step lists: the bill is a step only with payment sessions', () => {
  assert.deepEqual(pickupSteps(true).map((s) => s.key), ['booking', 'readings', 'photos', 'licence', 'payment']);
  assert.deepEqual(pickupSteps(false).map((s) => s.key), ['booking', 'readings', 'photos', 'licence']);
  assert.equal(pickupSteps(false)[3]!.label, 'Confirm');
  assert.deepEqual(returnSteps(true).map((s) => s.key), ['booking', 'photos', 'readings', 'charges', 'bill']);
  assert.deepEqual(returnSteps(false).map((s) => s.key), ['booking', 'photos', 'readings', 'charges']);
});

test('prev / next: first step has no back (leaves the flow), last has no next', () => {
  const steps = pickupSteps(true);
  assert.equal(prevStep(steps, 'booking'), null);
  assert.equal(prevStep(steps, 'payment'), 'licence');
  assert.equal(nextStep(steps, 'licence'), 'payment');
  assert.equal(nextStep(steps, 'payment'), null);
});

test('going back is always allowed, all the way to the first step', () => {
  const steps = returnSteps(true);
  // even with everything blocked
  const blockers = { booking: 'x', photos: 'y', readings: 'z', charges: 'w' };
  for (const target of ['charges', 'readings', 'photos', 'booking'] as const) {
    assert.deepEqual(resolveJump(steps, blockers, 'bill', target), { to: target, blockedBy: null });
  }
});

test('going forward stops at the first incomplete step, with its message', () => {
  const steps = pickupSteps(true);
  const blockers = { readings: 'Enter the odometer reading.', photos: 'Take the required photo: Front.' };
  assert.deepEqual(resolveJump(steps, blockers, 'booking', 'payment'), {
    to: 'readings',
    blockedBy: 'Enter the odometer reading.',
  });
  assert.deepEqual(resolveJump(steps, { photos: 'p' }, 'readings', 'licence'), { to: 'photos', blockedBy: 'p' });
  // the target's own blocker doesn't stop entering it
  assert.deepEqual(resolveJump(steps, { licence: 'l' }, 'booking', 'licence'), { to: 'licence', blockedBy: null });
  assert.deepEqual(firstBlockedBefore(steps, {}, 'payment'), null);
});

test('stepper states: reached + complete = done, beyond a blocker = locked', () => {
  const steps = returnSteps(true);
  const states = stepStates(steps, { readings: 'odo' }, 'photos', 2);
  assert.deepEqual(states, ['done', 'current', 'open', 'locked', 'locked']);
  // back from the bill: everything reached stays tappable
  assert.deepEqual(stepStates(steps, {}, 'readings', 4), ['done', 'done', 'current', 'done', 'done']);
});

test('clampStep: a saved / stale step falls back safely', () => {
  const legacy = pickupSteps(false);
  assert.equal(clampStep(legacy, 'payment', 'licence'), 'licence');
  assert.equal(clampStep(legacy, 'photos'), 'photos');
  assert.equal(clampStep(legacy, 'nonsense'), 'booking');
  assert.equal(clampStep(legacy, undefined), 'booking');
});

const snap = (o: Partial<HandoverSnapshot> = {}): HandoverSnapshot => ({
  odo: '12500',
  fuelLevel: 7,
  fastagBalance: '480',
  photos: [{ fileId: 'a', label: 'Front' }, { fileId: 'b', label: null }],
  dlStatus: 'COLLECTED',
  note: '',
  ...o,
});

test('handoverChanges: only what changed since the bill saved it', () => {
  assert.deepEqual(handoverChanges(snap(), snap()), []);
  assert.deepEqual(handoverChanges(snap(), snap({ odo: '12600' })), ['odo']);
  assert.deepEqual(handoverChanges(snap(), snap({ fuelLevel: 0 })), ['fuelLevel']);
  // same money typed differently is no change
  assert.deepEqual(handoverChanges(snap(), snap({ fastagBalance: '480.00' })), []);
  assert.deepEqual(handoverChanges(snap(), snap({ fastagBalance: '450' })), ['fastagBalance']);
  // reorder / relabel / add / remove are photo changes
  assert.deepEqual(handoverChanges(snap(), snap({ photos: [{ fileId: 'b' }, { fileId: 'a', label: 'Front' }] })), ['photos']);
  assert.deepEqual(handoverChanges(snap(), snap({ photos: [{ fileId: 'a', label: 'Front' }] })), ['photos']);
  // a cleared licence choice isn't sent (it can't be cleared once recorded)
  assert.deepEqual(handoverChanges(snap(), snap({ dlStatus: null })), []);
  assert.deepEqual(handoverChanges(snap(), snap({ dlStatus: 'NOT_COLLECTED', note: 'scratch' })), ['dlStatus', 'note']);
  // nothing known on the server yet: send everything
  assert.equal(handoverChanges(null, snap()).length, 6);
});

test('samePhotoList / mergePhotoLists never duplicate a photo', () => {
  const a = [{ fileId: '1' }, { fileId: '2', label: 'Rear' }];
  assert.ok(samePhotoList(a, [{ fileId: '1', label: null }, { fileId: '2', label: 'Rear' }]));
  const merged = mergePhotoLists(a, [{ fileId: '2', label: 'Rear' }, { fileId: '3' }]);
  assert.deepEqual(merged.map((p) => p.fileId), ['1', '2', '3']);
  // removed on this screen stays removed
  assert.deepEqual(mergePhotoLists(a, [{ fileId: '3' }], new Set(['3'])).map((p) => p.fileId), ['1', '2']);
  assert.equal(mergePhotoLists(a, []), a);
});

test('bodySignature ignores key order and undefined', () => {
  assert.equal(bodySignature({ a: 1, b: [1, { y: 2, x: 1 }] }), bodySignature({ b: [1, { x: 1, y: 2 }], a: 1, c: undefined }));
  assert.notEqual(bodySignature({ endOdo: '100' }), bodySignature({ endOdo: '101' }));
});

test('needsRecompute: only when the bill is missing, stale or its inputs changed', () => {
  const sig = bodySignature({ endOdo: '100' });
  assert.equal(needsRecompute({ hasBill: false, billStale: false, computedSig: null, currentSig: sig }), true);
  assert.equal(needsRecompute({ hasBill: true, billStale: true, computedSig: sig, currentSig: sig }), true);
  assert.equal(needsRecompute({ hasBill: true, billStale: false, computedSig: sig, currentSig: sig }), false);
  assert.equal(
    needsRecompute({ hasBill: true, billStale: false, computedSig: sig, currentSig: bodySignature({ endOdo: '150' }) }),
    true,
  );
  // a bill restored from the server with no baseline yet is kept
  assert.equal(needsRecompute({ hasBill: true, billStale: false, computedSig: null, currentSig: sig }), false);
});

test('billChangeNotice says how the balance moved', () => {
  assert.equal(billChangeNotice(null, 500), null);
  assert.equal(billChangeNotice(500, 500), null);
  assert.equal(billChangeNotice(300, 800), 'Bill updated after your changes: was ₹300 to collect, now ₹800 to collect.');
  assert.equal(billChangeNotice(300, -200), 'Bill updated after your changes: was ₹300 to collect, now ₹200 to refund.');
  assert.equal(billChangeNotice(-200, 0), 'Bill updated after your changes: was ₹200 to refund, now nothing due.');
});
