---
goal: Unified Deferred Payment — Redesign Staff Pickup Flow (v2)
version: 2.0
date_created: 2026-03-27
last_updated: 2026-03-27
owner: Backend + Frontend
status: 'Completed'
tags: [feature, payment, refactor, pickup, session, revenue-integrity]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

This plan supersedes `plan/feature-unified-deferred-payment-session-1.md` (v1). It incorporates all completed v1 backend work and adds corrections and missing pieces discovered during a full code review of `StaffPickupsPage.tsx`, `pickupSession.controller.ts`, and `paymentSession.controller.ts`.

**Core problem**: Revenue leaks because the staff pickup page collects payment in up to four separate interactions — extension payment (ExtendBookingModal Step 3), remaining balance (`RemainingBalancePanel`), safety deposit (standalone), and discount causing a manual cash refund. The session ledger infrastructure already exists; it is not consistently used.

**Target**: A single linear step flow (Steps 1–8) where Steps 1–7 perform business logic only, and Step 8 is the sole payment interaction. The `RecordPaymentPanel` presents the consolidated ledger and the employee asks the customer for their preferred method (cash → sent to Branch Manager, online → confirmed immediately). The booking is marked `PICKED_UP` only when this unified payment completes.

---

## 1. Requirements & Constraints

- **REQ-001**: No payment must be collected in any step except Step 8 (Collect Payment). All prior steps write ledger entries to the active `PaymentSession` or accumulate local state for session initiation.
- **REQ-002**: The session flow (`usePaymentSessions = true`) must activate for ALL bookings at a session-enabled branch — not only advance-payment bookings. An extension-only or deposit-only pickup must also use the session.
- **REQ-003**: `RemainingBalancePanel` must be removed from `StaffPickupsPage.tsx`. Its functionality (show remaining balance) is already visible in the session ledger.
- **REQ-004**: `DiscountPanel` must be removed from `StaffPickupsPage.tsx` as a standalone component. Discount application must write a `DISCOUNT` ledger entry to the active pickup session, reducing `netPayable`. No manual cash refund.
- **REQ-005**: Photos must appear in exactly one place — Step 5. The duplicate photo UI currently inside Step 4 (Vehicle Inspection card) must be removed.
- **REQ-006**: Safety deposit must be adjustable AFTER session initiation via dedicated `add-deposit` / `remove-deposit` endpoints (not only at initiation time).
- **REQ-007**: The backend `runPostCompletionHooks` for `PICKUP` sessions must apply any `DISCOUNT` ledger entry to the booking record (`booking.discountAmount`, `booking.discountCode`) atomically on payment completion.
- **REQ-008**: The backend must recompute `netPayable` from all non-voided ledger entries on every mutation — no client-supplied totals are trusted.
- **REQ-009**: All new pickup-session mutation endpoints must return the full updated session (with recalculated totals) in a single response.
- **REQ-010**: An active session must survive page reloads — the frontend must refetch via `GET /pickup-session` on mount when `usePaymentSessions = true`.

- **SEC-001**: Every pickup-session endpoint must verify the booking belongs to the authenticated employee's branch before mutating.
- **SEC-002**: Discount amounts must be validated against the discount record in the database. The frontend cannot supply an arbitrary discount amount.
- **SEC-003**: Safety deposit amounts must be positive numbers. The backend rejects zero or negative values.

- **CON-001**: `PaymentSession.sessionType` enum stays `PICKUP` — no new type is introduced.
- **CON-002**: The legacy pickup flow (`booking.controller.ts` `approvePickup`) remains active when `usePaymentSessions = false`. No changes to the legacy path.
- **CON-003**: `ExtendBookingModal` already supports `mode="pickup-session"` and skips Step 3. This behaviour is unchanged.
- **CON-004**: `RecordPaymentPanel` and `LedgerSummaryCard` already exist and work with any `PaymentSession`. Minimal changes required.
- **CON-005**: The v1 backend endpoints (`initiate`, `GET`, `abandon`) are complete and must not be modified in a breaking way.

- **GUD-001**: New pickup-session endpoints follow the URL pattern `POST /employee/bookings/:bookingId/pickup-session/<action>`.
- **GUD-002**: All Decimal/money fields remain `string` in API responses; the frontend converts to `Number` only for display.
- **GUD-003**: All ledger entry mutations use the shared `recomputeSessionTotals(sessionId, tx)` utility to avoid drift.

- **PAT-001**: Follow the existing `ledgerService.addEntry(...)` pattern for all new entries.
- **PAT-002**: Follow the existing `paymentSessionService.updateStatus(...)` pattern — never write raw SQL to update session status.
- **PAT-003**: Frontend session state uses `useState<PaymentSession | null>` (already established). Do NOT migrate to React Query cache for the session object — the current pattern is simpler and sufficient.

---

## 2. Implementation Steps

### Implementation Phase 1 — Backend: Shared Session Totals Utility

- GOAL-001: Extract `recomputeSessionTotals` into a shared service so all Phase 2 endpoints can call it without duplicating GST calculation logic.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `apps/backend/src/services/payment/sessionTotals.service.ts`. Export `async function recomputeSessionTotals(sessionId: number, tx: PrismaTx): Promise<void>`. Implementation: (1) fetch all non-voided `LedgerEntry` rows for `sessionId` grouped by `classification`; (2) compute `taxableBase` = sum of TAXABLE entries, `nonTaxableBase` = sum of NON_TAXABLE entries, `discountTotal` = sum of DISCOUNT entries (negative), `gstRate` from `PaymentSession.metadata.gstRate` (fallback `frozenChargeConfig.gstRate ?? 0`); (3) compute `gstAmount = taxableBase * gstRate / 100`; (4) compute `netPayable = taxableBase + nonTaxableBase + gstAmount + discountTotal`; (5) update `PaymentSession` fields `taxableBase`, `nonTaxableBase`, `gstAmount`, `totalCharges`, `totalDiscounts`, `netPayable` via `tx.paymentSession.update`. | | |
| TASK-002 | Export `recomputeSessionTotals` from `apps/backend/src/services/payment/index.ts` (or whichever barrel export file exists for that directory). | | |

---

### Implementation Phase 2 — Backend: Pickup Session Mutation Endpoints

- GOAL-002: Add `apply-discount`, `remove-discount`, `add-deposit`, `remove-deposit` endpoints to `pickupSession.controller.ts` so the frontend can mutate a session after initiation. Each endpoint recomputes totals and returns the full updated session.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | In `apps/backend/src/controller/employee/pickupSession.controller.ts`, add `ApplyDiscountToPickupSession` handler. Schema: `{ discountCode: z.string().min(1) }`. Logic: (1) resolve actor + booking (branch guard); (2) fetch active PICKUP session (`OPEN` or `AWAITING_PAYMENT`); (3) query `Discount` record by `discountCode` — must exist, `isActive = true`, not expired; (4) compute discount amount from the discount record (fixed amount or percentage applied to session `taxableBase`); (5) delete any existing `LedgerEntry` of type `DISCOUNT` in this session (one discount per session); (6) insert new `DISCOUNT` ledger entry with negative amount; (7) call `recomputeSessionTotals`; (8) return full session via `serializePickupSession`. | | |
| TASK-004 | In `pickupSession.controller.ts`, add `RemoveDiscountFromPickupSession` handler. No request body. Logic: (1) resolve actor + booking; (2) fetch active session; (3) void (soft-delete or hard-delete) any `LedgerEntry` of type `DISCOUNT`; (4) call `recomputeSessionTotals`; (5) return full session. | | |
| TASK-005 | In `pickupSession.controller.ts`, add `AddDepositToPickupSession` handler. Schema: `{ amount: z.coerce.number().positive(), reason: z.string().min(1) }`. Logic: (1) resolve actor + booking; (2) fetch active session; (3) void any existing `DEPOSIT` entry (one deposit per session); (4) create new `DEPOSIT` ledger entry (`NON_TAXABLE`); (5) upsert `SafetyDepositRequest` (replace existing if present); (6) call `recomputeSessionTotals`; (7) return full session. | | |
| TASK-006 | In `pickupSession.controller.ts`, add `RemoveDepositFromPickupSession` handler. No body. Logic: (1) resolve actor + booking; (2) fetch active session; (3) void `DEPOSIT` ledger entry; (4) void or cancel the linked `SafetyDepositRequest`; (5) call `recomputeSessionTotals`; (6) return full session. Note: if the session has already been completed this must return 400. | | |

---

### Implementation Phase 3 — Backend: Complete Post-Completion Hook

- GOAL-003: Extend `runPostCompletionHooks` in `paymentSession.controller.ts` so the PICKUP branch also applies any `DISCOUNT` ledger entry to the booking record after payment.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | In `apps/backend/src/controller/employee/paymentSession.controller.ts`, inside `runPostCompletionHooks`, in the `PICKUP` branch (after extension confirmation logic): query session ledger entries for type `DISCOUNT`. If found, fetch the linked `Discount` record using `entry.referenceId` (the discount's `publicId`). Update `booking.discountAmount = entry.amount.abs()` and `booking.discountCode = discountCode`. Also increment `discount.usageCount` if `discount.maxUsage !== null`. Wrap in the same transaction (`tx`) already used for the PICKUP hook. | | |
| TASK-008 | Verify the existing `PICKUP` post-completion EXTENSION branch (`runPostCompletionHooks`) correctly sets `booking.endAt` to `extension.requestedEndAt` and `booking.extensionCount += 1`. If not, fix it now. (Read the code at `paymentSession.controller.ts:520-560` to confirm.) | | |

---

### Implementation Phase 4 — Backend: Route Registration

- GOAL-004: Register all new Phase 2 endpoints in the Express router.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | In `apps/backend/src/routes/employee/session.routes.ts` (or `pickupSession.routes.ts` — whichever file registers the existing `initiate` and `abandon` routes), add four new routes: `POST /:bookingId/pickup-session/apply-discount → ApplyDiscountToPickupSession`, `DELETE /:bookingId/pickup-session/remove-discount → RemoveDiscountFromPickupSession`, `POST /:bookingId/pickup-session/add-deposit → AddDepositToPickupSession`, `DELETE /:bookingId/pickup-session/remove-deposit → RemoveDepositFromPickupSession`. Apply the existing employee auth middleware to each route. | | |

---

### Implementation Phase 5 — Frontend: Service Layer

- GOAL-005: Add typed API call functions to the frontend service layer for the four new endpoints and the session fetch-on-mount pattern.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | In `apps/frontend/src/services/paymentSession.service.ts`, add `applyDiscountToPickupSession(bookingId: string, discountCode: string): Promise<PaymentSession>`. Calls `POST /employee/bookings/:bookingId/pickup-session/apply-discount` with body `{ discountCode }`. Returns `response.data.data`. | | |
| TASK-011 | In `paymentSession.service.ts`, add `removeDiscountFromPickupSession(bookingId: string): Promise<PaymentSession>`. Calls `DELETE /employee/bookings/:bookingId/pickup-session/remove-discount`. Returns `response.data.data`. | | |
| TASK-012 | In `paymentSession.service.ts`, add `addDepositToPickupSession(bookingId: string, payload: { amount: number; reason: string }): Promise<PaymentSession>`. Calls `POST /employee/bookings/:bookingId/pickup-session/add-deposit`. Returns `response.data.data`. | | |
| TASK-013 | In `paymentSession.service.ts`, add `removeDepositFromPickupSession(bookingId: string): Promise<PaymentSession>`. Calls `DELETE /employee/bookings/:bookingId/pickup-session/remove-deposit`. Returns `response.data.data`. | | |
| TASK-014 | In `paymentSession.service.ts`, add `getActivePickupSession(bookingId: string): Promise<PaymentSession | null>`. Calls `GET /employee/bookings/:bookingId/pickup-session`. Returns `response.data.data` on success; returns `null` on 404 (catch axios error, check `error.response?.status === 404`). | | |

---

### Implementation Phase 6 — Frontend: StaffPickupsPage Refactor

- GOAL-006: Restructure `StaffPickupsPage.tsx` to match the target 8-step linear flow. Remove `RemainingBalancePanel`, `DiscountPanel`, and duplicate photos. Broaden the session trigger. Add Steps 6 and 7.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-015 | **Broaden session trigger**: Replace `hasPendingPayment` derivation at line `508` with: `const useSessionFlow = booking?.usePaymentSessions === true;`. Remove the `isAdvancePayment` and `remainingPaidAt` guards entirely. This makes the session flow activate for all session-enabled branches regardless of payment type. Update all downstream references that used `hasPendingPayment` to use `useSessionFlow`. | | |
| TASK-016 | **Remove duplicate photos from Step 4**: Delete the photo upload block inside the Step 4 (Vehicle Inspection) `StepCard` at lines `1168–1270`. The Vehicle Inspection card should contain ONLY: odometer input, fuel level select, safety deposit checkbox/fields, and manager confirmation checkbox. | | |
| TASK-017 | **Remove first `RemainingBalancePanel` instance** at lines `944–956` (rendered between the extension step and the discount panel). Delete this block entirely. | | |
| TASK-018 | **Remove `DiscountPanel` import and instance** at lines `958–965`. Delete the import. Delete the JSX block. | | |
| TASK-019 | **Remove second `RemainingBalancePanel` instance** at lines `1469–1481` (rendered after Step 5 and before the payment section). Delete this block entirely. | | |
| TASK-020 | **Move Safety Deposit out of Step 4 into Step 6**: Remove the safety deposit checkbox/fields from inside Step 4's `<form>`. Create a new `StepCard stepNum={6}` titled "Safety Deposit" with `subtitle="Optional — applies a refundable deposit to this booking"`. Inside it, render the same `<YesNoToggle>` / amount+reason inputs. `isLocked` when `!canProceedFromStep2 || isPickedUp`. `isCompleted` when `requestSafetyDeposit === false || (requestSafetyDeposit && safetyDepositAmount && safetyDepositReason)`. | | |
| TASK-021 | **Add Step 7 — Discount**: Create a new `StepCard stepNum={7}` titled "Discount / Coupon Code" with `subtitle="Optional — apply a coupon to reduce the total"`. `isLocked` when the Step 6 gate is not cleared OR `isPickedUp`. Inside: a text input for coupon code + "Apply" button. The button is only active when `useSessionFlow && pickupSession !== null` (the coupon is applied directly to the open session). When `useSessionFlow && pickupSession === null` (pre-session), store the coupon code in local state `pendingDiscountCode` and apply it during session initiation via TASK-023. Display a success row when a discount is applied (read from `pickupSession.entries` of type `DISCOUNT`). | | |
| TASK-022 | **Restore session on page reload**: In `useEffect` that runs when `bookingId` and `useSessionFlow` are truthy, call `paymentSessionService.getActivePickupSession(bookingId!)`. If it returns a session, call `setPickupSession(session)`. This runs once on mount. Dependency array: `[bookingId, useSessionFlow]`. | | |
| TASK-023 | **Extend `initiatePickupSessionMutation` payload** to include `discountCode: pendingDiscountCode ?? undefined` if `pendingDiscountCode` is set. (The backend `initiate` endpoint already supports this field per v1 TASK-008 — confirm it is wired and if not, complete TASK-008 from v1 now.) | | |
| TASK-024 | **Update `onConfirmHandover`** (the handler at line `611`): Replace the `hasPendingPayment` guard with `useSessionFlow`. The legacy path (`setIsConfirmOpen(true)`) remains for `!useSessionFlow` branches. | | |
| TASK-025 | **Update Step 8 "Collect Payment" `StepCard`** to use `useSessionFlow` instead of `hasPendingPayment`. Update the `subtitle` to dynamically build from session entries (remaining balance + extension label + deposit label) when `useSessionFlow` is true. Ensure `isLocked` requires all mandatory prior steps: `canProceedFromStep2 && areAllDocsApproved && (watch("odo") ?? 0) > 0 && watch("fuelLevel") !== ""`. | | |
| TASK-026 | **Wire Apply/Remove Discount to open session** inside Step 7: Add `applyDiscountMutation = useMutation({ mutationFn: (code: string) => paymentSessionService.applyDiscountToPickupSession(bookingId!, code), onSuccess: (session) => setPickupSession(session) })`. Add `removeDiscountMutation` similarly calling `removeDiscountFromPickupSession`. Call these when the employee interacts with the coupon input while `pickupSession !== null`. | | |
| TASK-027 | **Wire Add/Remove Deposit to open session** inside Step 6: Add `addDepositMutation = useMutation({ mutationFn: (p) => paymentSessionService.addDepositToPickupSession(bookingId!, p), onSuccess: (session) => setPickupSession(session) })`. Show an "Update Deposit" button in Step 6 when `pickupSession !== null && requestSafetyDeposit`. Remove deposit via `removeDepositMutation` when employee unchecks the safety deposit toggle while session is open. | | |
| TASK-028 | **Update Step numbering**: After inserting Steps 6 and 7, confirm the existing KYC, Inspection, Photos cards are renumbered 3, 4, 5 respectively. Update the `stepNum` props and any hardcoded step references in comments. | | |

---

### Implementation Phase 7 — Frontend: LedgerSummaryCard Enhancement

- GOAL-007: Extend `LedgerSummaryCard` to inline-display the active discount (if any) and expose a "Remove discount" button, so the employee can see the discount effect on the total without leaving the payment section.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | In `apps/frontend/src/components/payment/LedgerSummaryCard.tsx`, read `session.entries` to check for a `DISCOUNT` entry. If one exists, render an extra row highlighted in green: label, discount amount (formatted as `−₹X`), and an `X` icon button that calls an `onRemoveDiscount?: () => void` prop. | | |
| TASK-030 | Add optional prop `onRemoveDiscount?: () => void` to `LedgerSummaryCard`. In `StaffPickupsPage.tsx`, pass `onRemoveDiscount={() => removeDiscountMutation.mutate()}` when rendering `LedgerSummaryCard` in Step 8. | | |

---

### Implementation Phase 8 — Cleanup

- GOAL-008: Remove orphaned code and components made redundant by this refactor.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-031 | Delete `apps/frontend/src/components/payment/RemainingBalancePanel.tsx` (the file, not just its usage). Confirm no other page imports it. If `ReturnProcessPage.tsx` or any other page imports it, keep the file but only remove the import from `StaffPickupsPage.tsx`. | | |
| TASK-032 | Remove `DiscountPanel` import from `StaffPickupsPage.tsx` (already done as part of TASK-018). If `DiscountPanel` is used on other pages (e.g., manager panel), keep the component file; only remove it from `StaffPickupsPage.tsx`. | | |
| TASK-033 | Remove `hasPendingPayment` variable entirely from `StaffPickupsPage.tsx` after all references are replaced with `useSessionFlow` (TASK-015). | | |
| TASK-034 | Remove the `Manager Confirmation` checkbox (`requireManagerConfirmation` field) from Step 4 if it was only relevant to the legacy flow. Check `approvePickup` in `booking.controller.ts` — if the field is only used for legacy, gate it with `!useSessionFlow`. | | |

---

## 3. Alternatives

- **ALT-001**: Keep `RemainingBalancePanel` and gate it with `!useSessionFlow`. Rejected — two parallel code paths for the same concept (collect remaining balance) make long-term maintenance harder. The session ledger already shows the remaining balance as a `BOOKING_BASE` entry.
- **ALT-002**: Integrate discount into the pre-session "estimated total" only, not into an open session. Rejected — the backend must validate and compute the discount; client-side estimation cannot be trusted (REQ-008). The `applyDiscountToSession` endpoint is required.
- **ALT-003**: Move photos into Step 6 (after safety deposit). Rejected — photo capture logically belongs to vehicle inspection, but kept separate in Step 5 to avoid the Step 4 card becoming too long. Moving it later would change the natural inspection-then-photo order.
- **ALT-004**: Use React Query `useQuery` for session state instead of `useState`. Rejected per PAT-003 — the mutation-on-success `setPickupSession` pattern is already established and the session is updated synchronously on every mutation response. React Query adds unnecessary complexity here.
- **ALT-005**: Allow multiple discounts per session. Rejected — the business rule is one discount code per booking. The ledger enforces this by deleting the previous `DISCOUNT` entry before inserting a new one.

---

## 4. Dependencies

- **DEP-001**: `recomputeSessionTotals` service (TASK-001, TASK-002) — must be created before Phase 2 endpoint handlers are implemented, as all four handlers call it.
- **DEP-002**: Phase 2 backend endpoints (TASK-003 – TASK-006) — must be registered (TASK-009) before Phase 5 frontend service functions can be called.
- **DEP-003**: Phase 5 service functions (TASK-010 – TASK-014) — must exist before Phase 6 frontend mutations reference them (TASK-026, TASK-027).
- **DEP-004**: `Discount` model — must have fields: `code (string, unique)`, `isActive (bool)`, `discountType (FIXED | PERCENTAGE)`, `discountValue (Decimal)`, `maxUsage (int?)`, `usageCount (int)`, `expiresAt (DateTime?)`. Confirm these exist in `packages/db/src/schema.prisma` before TASK-003.
- **DEP-005**: `booking.usePaymentSessions` field — the booking DTO returned by `bookingService.getPickupDetails` must include this field. Confirm `booking.controller.ts` serialises it; if not, add it.
- **DEP-006**: v1 backend endpoints (`initiate`, `GET`, `abandon`) — already completed; do not modify their contracts.

---

## 5. Files

- **FILE-001**: `apps/backend/src/services/payment/sessionTotals.service.ts` — NEW: shared `recomputeSessionTotals` utility (Phase 1).
- **FILE-002**: `apps/backend/src/controller/employee/pickupSession.controller.ts` — add 4 new handler exports: `ApplyDiscountToPickupSession`, `RemoveDiscountFromPickupSession`, `AddDepositToPickupSession`, `RemoveDepositFromPickupSession` (Phase 2).
- **FILE-003**: `apps/backend/src/controller/employee/paymentSession.controller.ts` — extend `runPostCompletionHooks` PICKUP branch to apply discount and verify extension update (Phase 3).
- **FILE-004**: `apps/backend/src/routes/employee/session.routes.ts` — register 4 new routes (Phase 4).
- **FILE-005**: `apps/frontend/src/services/paymentSession.service.ts` — add 5 new typed API functions (Phase 5).
- **FILE-006**: `apps/frontend/src/pages/employee/StaffPickupsPage.tsx` — major refactor: remove panels, fix photos, broaden session trigger, add Steps 6+7 (Phase 6).
- **FILE-007**: `apps/frontend/src/components/payment/LedgerSummaryCard.tsx` — add inline discount row + `onRemoveDiscount` prop (Phase 7).
- **FILE-008**: `apps/frontend/src/components/payment/RemainingBalancePanel.tsx` — DELETE if unused elsewhere; otherwise only remove import from `StaffPickupsPage.tsx` (Phase 8).

---

## 6. Testing

- **TEST-001**: `POST /pickup-session/apply-discount` with valid code reduces `netPayable` by the discount amount and returns the updated session with a `DISCOUNT` ledger entry.
- **TEST-002**: `POST /pickup-session/apply-discount` called twice replaces the first discount entry (only one `DISCOUNT` entry exists after the second call).
- **TEST-003**: `POST /pickup-session/apply-discount` with an expired or inactive discount code returns HTTP 400.
- **TEST-004**: `DELETE /pickup-session/remove-discount` removes the `DISCOUNT` entry and increases `netPayable` back to the pre-discount value.
- **TEST-005**: `POST /pickup-session/add-deposit` creates a `DEPOSIT` ledger entry and a `SafetyDepositRequest` record; `netPayable` increases by the deposit amount.
- **TEST-006**: `POST /pickup-session/add-deposit` called twice upserts (replaces) the deposit — only one `DEPOSIT` entry exists and `SafetyDepositRequest` is updated.
- **TEST-007**: `DELETE /pickup-session/remove-deposit` removes the `DEPOSIT` entry; `netPayable` decreases accordingly.
- **TEST-008**: `record-payment` on a PICKUP session with a `DISCOUNT` entry sets `booking.discountAmount` and increments `discount.usageCount` atomically.
- **TEST-009**: `StaffPickupsPage` does not render `RemainingBalancePanel` or `DiscountPanel` in any configuration.
- **TEST-010**: `StaffPickupsPage` with `usePaymentSessions = true` and NO remaining balance (extension-only booking) still shows Step 8 (Collect Payment) with the extension charge in the pre-session preview.
- **TEST-011**: After page reload, if an active `PICKUP` session exists, `getActivePickupSession` restores it and Step 8 renders `LedgerSummaryCard` immediately without requiring re-initiation.
- **TEST-012**: `LedgerSummaryCard` renders a green discount row when session has a `DISCOUNT` entry; clicking remove calls `onRemoveDiscount`.
- **TEST-013**: Photos appear exactly once (in Step 5). The Step 4 card contains no photo upload elements.

---

## 7. Risks & Assumptions

- **RISK-001**: `booking.usePaymentSessions` may not be serialised in the booking DTO. If it is absent, `useSessionFlow` will always be `false` and the entire session flow will be skipped silently. **Mitigation**: Confirm DEP-005 before starting Phase 6; add the field to the DTO serialiser if missing.
- **RISK-002**: The `Discount` model structure may differ from what TASK-003 assumes (`discountType`, `discountValue`, etc.). **Mitigation**: Read `packages/db/src/schema.prisma` before implementing TASK-003 and adjust the amount computation accordingly.
- **RISK-003**: `RemoveDepositFromPickupSession` called after payment is completed must fail gracefully. If `session.status === COMPLETED`, the handler returns HTTP 400. Failure to guard this could corrupt the booking's `safetyDeposit` field.
- **RISK-004**: Other pages (e.g., manager dashboard) may import `RemainingBalancePanel`. Deleting the file without checking all consumers will cause build failures. **Mitigation**: Run `grep -r "RemainingBalancePanel" apps/frontend/src` before deleting.
- **RISK-005**: Step numbering change (adding Steps 6 and 7) may confuse employees if they have the page open during a deploy. **Mitigation**: Acceptable UX risk for a staff-facing internal tool; document the change in release notes.

- **ASSUMPTION-001**: `booking.usePaymentSessions` is a boolean field already present on the booking DB record (sourced from `BranchChargeConfig.usePaymentSessions`) and merely needs to be added to the DTO serialiser if missing.
- **ASSUMPTION-002**: `Discount.referenceId` stored in the `LedgerEntry` is the discount's `publicId`, allowing `runPostCompletionHooks` to look up the full discount record for `usageCount` increment.
- **ASSUMPTION-003**: The existing `ledgerService.addEntry` function accepts an optional `idempotencyKey` and handles the upsert pattern. New deposit/discount endpoints will use `pickup:${booking.id}:deposit:${session.id}` and `pickup:${booking.id}:discount:${session.id}` as idempotency keys.
- **ASSUMPTION-004**: `DiscountPanel` is safe to keep as a component file (it may be used on other pages). Only its usage inside `StaffPickupsPage.tsx` is removed.

---

## 8. Related Specifications / Further Reading

- [v1 Plan (superseded)](./feature-unified-deferred-payment-session-1.md)
- [Discount System Feature Plan](./feature-discount-system-1.md)
- [Payment Cash Management Feature Plan](./feature-payment-cash-management-1.md)
- [Refactor Payment Ledger Session Plan](./refactor-payment-ledger-session-1.md)
- `apps/backend/src/controller/employee/pickupSession.controller.ts` — existing `initiate`, `GET`, `abandon` reference implementations
- `apps/backend/src/controller/employee/paymentSession.controller.ts` — `runPostCompletionHooks` reference
- `apps/frontend/src/pages/employee/StaffPickupsPage.tsx` — current (broken) implementation being refactored
