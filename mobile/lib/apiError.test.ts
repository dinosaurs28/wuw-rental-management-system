// cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/apiError.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeApiError, firstFormattedError } from './apiError';

const FALLBACK = "Couldn't save the changes. Please try again.";
const http = (status: number, data: unknown) => ({ isAxiosError: true, response: { status, data } });

test("the server's own message is shown", () => {
  assert.equal(
    describeApiError(http(400, { code: 'VALIDATION_FAILED', field: 'photos', message: 'Keep at most 200 pickup photos' }), FALLBACK),
    'Keep at most 200 pickup photos',
  );
});

test("a bare 'Validation failed' (older servers) shows the first field error instead", () => {
  const photos = http(400, {
    message: 'Validation failed',
    errors: { _errors: [], photos: { _errors: [], 0: { _errors: [], label: { _errors: ['Too big: expected string to have <=80 characters'] } } } },
  });
  assert.equal(describeApiError(photos, FALLBACK), 'Photos (item 1): Too big: expected string to have <=80 characters');
  const count = http(400, { message: 'Validation failed', errors: { _errors: [], photos: { _errors: ['Too big: expected array to have <=60 items'] } } });
  assert.equal(describeApiError(count, FALLBACK), 'Photos: Too big: expected array to have <=60 items');
  const odo = http(400, { message: 'Validation failed', errors: { _errors: [], odo: { _errors: ['Enter the odometer reading'] } } });
  assert.equal(describeApiError(odo, FALLBACK), 'Odometer: Enter the odometer reading');
  // Nothing listed: the server's words are still better than nothing
  assert.equal(describeApiError(http(400, { message: 'Validation failed' }), FALLBACK), 'Validation failed');
});

test('no answer: says the server could not be reached / took too long', () => {
  assert.match(describeApiError({ isAxiosError: true, request: {}, message: 'Network Error' }, FALLBACK), /couldn't be reached/);
  assert.match(describeApiError({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }, FALLBACK), /took too long/);
  assert.ok(describeApiError({ isAxiosError: true, request: {} }, FALLBACK).startsWith(FALLBACK));
});

test('an answer without a message (gateway page): the fallback with the status', () => {
  assert.equal(describeApiError(http(502, '<html>Bad Gateway</html>'), FALLBACK), `${FALLBACK} (server error 502)`);
  assert.equal(describeApiError(http(500, null), FALLBACK), `${FALLBACK} (server error 500)`);
});

test('not an API error at all: the fallback', () => {
  assert.equal(describeApiError(new Error('boom'), FALLBACK), FALLBACK);
  assert.equal(describeApiError(undefined, FALLBACK), FALLBACK);
});

test('firstFormattedError walks the zod format() tree', () => {
  assert.equal(firstFormattedError(null), null);
  assert.equal(firstFormattedError({ _errors: [] }), null);
  assert.deepEqual(firstFormattedError({ _errors: [], a: { _errors: [], b: { _errors: ['x'] } } }), { field: 'a', path: 'a.b', message: 'x' });
});
