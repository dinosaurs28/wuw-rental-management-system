// Pickup other charges (Nov 15 2026): input checks, request body, draft round trip.
//
//   cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/pickupCharges.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chargeInputError,
  chargesBody,
  chargesFromSession,
  chargesTotal,
  cleanChargeAmount,
  draftCharges,
  sameCharges,
} from './pickupCharges';

test('amount typing keeps digits and 2 decimals', () => {
  assert.equal(cleanChargeAmount('12a3'), '123');
  assert.equal(cleanChargeAmount('99.567'), '99.56');
  assert.equal(cleanChargeAmount('1.2.3'), '1.23');
  assert.equal(cleanChargeAmount(''), '');
});

test('a charge needs a reason and an amount above ₹0', () => {
  assert.equal(chargeInputError('Child seat', '250', 0), null);
  assert.match(chargeInputError('', '250', 0)!, /what the charge is for/);
  assert.match(chargeInputError('Seat', '0', 0)!, /more than ₹0/);
  assert.match(chargeInputError('Seat', '', 0)!, /amount/);
  assert.match(chargeInputError('Seat', '10.123', 0)!, /2 decimals/);
  assert.match(chargeInputError('Seat', '600000', 0)!, /can't be more/);
  assert.match(chargeInputError('x'.repeat(121), '1', 0)!, /under 120/);
  assert.match(chargeInputError('Seat', '1', 20)!, /at most 20/);
});

test('body, session round trip, comparison and total', () => {
  const list = [{ label: ' Child  seat ', amount: '250' }, { label: 'Cleaning', amount: '99.5' }];
  assert.deepEqual(chargesBody(list), [{ label: 'Child seat', amount: 250 }, { label: 'Cleaning', amount: 99.5 }]);
  const fromServer = chargesFromSession([
    { publicId: 'a', label: 'Child seat', amount: '250.00' },
    { publicId: 'b', label: 'Cleaning', amount: '99.50' },
  ]);
  assert.deepEqual(fromServer, [{ label: 'Child seat', amount: '250' }, { label: 'Cleaning', amount: '99.5' }]);
  assert.equal(sameCharges(fromServer, [{ label: 'Child seat', amount: '250.00' }, { label: 'Cleaning', amount: '99.50' }]), true);
  assert.equal(sameCharges(fromServer, fromServer.slice(1)), false);
  assert.equal(chargesTotal(fromServer), 349.5);
  assert.deepEqual(chargesFromSession(undefined), []);
});

test('draft: kept charges come back, malformed / older drafts give none', () => {
  assert.deepEqual(draftCharges({ otherCharges: [{ label: 'Seat', amount: '250' }, { label: '', amount: '5' }, { label: 'X', amount: 0 }, 'junk'] }), [
    { label: 'Seat', amount: '250' },
  ]);
  assert.deepEqual(draftCharges({}), []);
  assert.deepEqual(draftCharges(null), []);
});
