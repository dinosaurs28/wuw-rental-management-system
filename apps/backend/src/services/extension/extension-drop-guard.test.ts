/**
 * Pure checks of the drop-recorded extension guard (extension-drop-guard.ts):
 * a PICKED_UP rental whose legacy "send to manager" drop is recorded has
 * released its car, so evaluate / commit (and the commit's re-check under the
 * booking lock) refuse it with MANAGER_CONFIRMATION_PENDING.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertExtendableDrop,
  ExtensionDropRecordedError,
  MANAGER_CONFIRMATION_PENDING,
} from "./extension-drop-guard.js";

const returnedAt = new Date("2026-10-19T10:00:00Z");

test("a drop recorded and awaiting the manager → refused with MANAGER_CONFIRMATION_PENDING (409)", () => {
  assert.throws(
    () => assertExtendableDrop({ status: "PICKED_UP", requiresManagerConfirmation: true, returnedAt }),
    (err: unknown) =>
      err instanceof ExtensionDropRecordedError &&
      err.status === 409 &&
      err.toJSON().code === MANAGER_CONFIRMATION_PENDING &&
      /can't be extended/.test(err.message),
  );
});

test("a rental still out, or a flag left on without a recorded drop → extendable", () => {
  assert.doesNotThrow(() => assertExtendableDrop({ status: "PICKED_UP", requiresManagerConfirmation: false, returnedAt: null }));
  assert.doesNotThrow(() => assertExtendableDrop({ status: "PICKED_UP", requiresManagerConfirmation: true, returnedAt: null }));
  assert.doesNotThrow(() => assertExtendableDrop({ status: "PICKED_UP", requiresManagerConfirmation: false, returnedAt }));
});

test("a booking not picked up yet is never caught by the drop guard", () => {
  assert.doesNotThrow(() => assertExtendableDrop({ status: "CONFIRMED", requiresManagerConfirmation: true, returnedAt }));
});
