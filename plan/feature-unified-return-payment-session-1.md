---
goal: Unified Deferred Payment — Redesign Staff Return Flow (v1)
version: 1.0
date_created: 2026-03-27
last_updated: 2026-03-27
owner: Engineering
status: 'Planned'
tags: [feature, payment, return-flow, ledger, session]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

The vehicle return flow currently collects charges in a fragmented, partially-broken way. Charge computation is done but the safety deposit credit/use logic is automatic and invisible to the employee, the grace period toggle is absent from the UI, damage gating happens AFTER payment instead of before, and the "Complete Return" button fires without confirming payment is settled. This plan redesigns `ReturnProcessPage.tsx` into a strict linear step flow — mirroring the pickup session redesign — where all charges are consolidated into one `PaymentSession` ledger before the vehicle can be marked returned.

## 1. Requirements & Constraints

- **REQ-001**: All monetary settlement (additional charges + safety deposit offset) MUST happen in a single `PaymentSession` of type `RETURN` before the booking can be marked `RETURNED`.
- **REQ-002**: The UI step flow MUST be gated by `booking.usePaymentSessions === true` (same flag used in pickup flow). Legacy path (no sessions) is preserved for branches with the flag off.
- **REQ-003**: UI sections shown/hidden MUST be driven by `booking.frozenChargeConfig` fields: `extraKmEnabled`, `extraTimeEnabled`, `fuelModuleEnabled`, `fastagModuleEnabled`, `gracePolicyEnabled`, `safetyDepositEnabled`, `damageModuleEnabled`.
- **REQ-004**: Safety deposit section MUST only appear when `booking.safetyDeposit > 0`. Employee chooses whether to apply it against charges OR return it in full as cash/online refund.
- **REQ-005**: Damage reporting MUST be gated AFTER payment is settled (session `COMPLETED`). Employee cannot report damage before payment.
- **REQ-006**: Once session is `COMPLETED`, booking transitions to `RETURNED` via the existing `runPostCompletionHooks(RETURN)` in `paymentSession.controller.ts`. No separate "Complete Return" button fires the transition.
- **REQ-007**: Grace period toggle MUST appear when `frozenChargeConfig.gracePolicyEnabled === true` and `graceType === "MANUAL"`. When toggled on, `applyGrace: true` is passed to `computeReturnSession`.
- **REQ-008**: Fastag field MUST only appear when `frozenChargeConfig.fastagModuleEnabled === true` AND `booking.items[0].vehicle.hasFastag === true`.
- **REQ-009**: The `computeReturnSession` endpoint resets and recomputes on every call (existing behaviour — void previous entries, add new). Allow recompute until payment is initiated.
- **REQ-010**: The `{ timeout: 30000 }` pattern established for the pickup session transaction MUST be applied to the return session compute transaction for the same reason (chained `addEntry` → `recomputeTotals` calls).
- **PAT-001**: Follow the `StepCard` / linear step pattern used in `StaffPickupsPage.tsx`: each step has `stepNum`, `title`, `isCompleted`, `isLocked`.
- **PAT-002**: Re-use `LedgerSummaryCard` and `RecordPaymentPanel` components unchanged.
- **PAT-003**: Re-use `paymentSessionService.computeReturnSession` and `paymentSessionService.recordPayment` / `recordRefund`.
- **CON-001**: Do NOT break the legacy return path (`booking.usePaymentSessions === false`). When flag is off, show the existing form with the "Complete Return" and "Report Damage" buttons.
- **CON-002**: The existing `ComputeReturnSession` backend endpoint is already correct and handles safety deposit credit automatically. No backend endpoint changes required.
- **CON-003**: Do not restructure `returnSession.controller.ts` — it already applies safety deposit as a `PAYMENT`-classified negative `DEPOSIT` ledger entry.
- **GUD-001**: `booking.frozenChargeConfig` is the source of truth for which charge modules are enabled — not the live `BranchChargeConfig`. Always use `frozenChargeConfig`.

## 2. Implementation Steps

### Implementation Phase 1 — Backend: Transaction timeout fix

- GOAL-001: Add `{ timeout: 30000 }` to `prisma.$transaction` inside `ComputeReturnSession` to prevent the same timeout issue fixed in pickup session initiation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `apps/backend/src/controller/employee/returnSession.controller.ts`, locate the implicit sequential calls to `ledgerService.addEntriesFromChargeBreakdown` and `ledgerService.addEntry` (deposit credit). These are currently NOT wrapped in a single `$transaction`. Wrap both calls in `prisma.$transaction(async (tx) => { ... }, { timeout: 30000 })` and pass `tx` to each `ledgerService` call to ensure atomicity and prevent partial writes. | | |
| TASK-002 | In the same transaction, move `paymentSessionService.updateStatus(session.id, PaymentSessionStatus.AWAITING_PAYMENT)` inside the transaction block so status flip is atomic with ledger writes. | | |
| TASK-003 | Verify the return session route is registered: `GET /employee/bookings/:bookingId/return/session` in `apps/backend/src/routes/employee/session.routes.ts`. This already exists — confirm and leave unchanged. | | |

### Implementation Phase 2 — Frontend: Step flow redesign of `ReturnProcessPage.tsx`

- GOAL-002: Completely replace the flat card layout with a locked linear step flow. Reuse the `StepCard` component pattern from `StaffPickupsPage.tsx`. The new flow has 6 steps, each gated on the previous.

**Target step sequence:**

```
Step 1: Pickup Reference Photos           (always shown, read-only gallery — no gate)
Step 2: Return Photos                     (upload zone — must have ≥1 photo to proceed)
Step 3: Charge Details                    (config-driven inputs + grace toggle + "Compute Charges" button)
         ├── End Odometer (always required)
         ├── Fuel Level (always shown; deficit charge shown when fuelModuleEnabled + below FULL)
         ├── Grace Period toggle (shown when gracePolicyEnabled + graceType=MANUAL)
         ├── Fastag (shown when fastagModuleEnabled + vehicle.hasFastag)
         └── [Compute Charges → POST return/session/compute → session state set]
Step 4: Safety Deposit                    (ONLY shown when booking.safetyDeposit > 0)
         ├── Shows: "Customer paid ₹X safety deposit at pickup"
         ├── Auto-applied as credit in the ledger (shown in LedgerSummaryCard)
         └── No employee action needed — informational only
Step 5: Collect Payment / Refund          (shown after charges computed; uses LedgerSummaryCard + RecordPaymentPanel)
         ├── If netPayable > 0  → employee collects additional charges (Cash or Online)
         ├── If netPayable == 0 → no payment needed; show "Proceed to Return" button
         └── If netPayable < 0  → employee issues refund (deposit > charges); RecordPaymentPanel in refund mode
Step 6: Vehicle Condition                 (ONLY unlocked after session COMPLETED)
         ├── "No Damage" → marks booking RETURNED (already done by runPostCompletionHooks)
         └── "Damage Found" → opens damage form → submits to reportDamage endpoint
```

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Copy the `StepCard` component definition from `StaffPickupsPage.tsx` into `ReturnProcessPage.tsx` (or extract it to `apps/frontend/src/components/employee/StepCard.tsx` and import it in both files — prefer extraction to avoid duplication). | | |
| TASK-005 | Add state variables: `applyGrace: boolean` (default `false`), `returnSession: ReturnSessionResponse \| null` (already exists), `paymentSettled: boolean` (derived: `returnSession?.session.status === "COMPLETED"`). Remove state that the step flow makes obsolete: `showCompleteDialog`, `showReportDialog`, `requireManagerConfirmation`. | | |
| TASK-006 | Replace `chargeModulesActive` boolean with a computed `frozenConfig` local variable: `const frozenConfig = booking?.frozenChargeConfig`. Derive per-module booleans: `showFuelModule`, `showFastagModule`, `showGraceToggle`, `showSafetyDepositInfo`. | | |
| TASK-007 | Build **Step 1** (Pickup Reference Photos): render `pickupCaptures` grid exactly as it exists today but wrapped in a `StepCard stepNum={1}` with `isCompleted={true}` always (it's informational). | | |
| TASK-008 | Build **Step 2** (Return Photos): wrap existing dropzone + photo grid in `StepCard stepNum={2} isCompleted={returnPhotos.length > 0}`. No lock — always accessible. | | |
| TASK-009 | Build **Step 3** (Charge Details): wrap odometer input, fuel level select, fuel deficit sub-panel, grace toggle (Checkbox, only when `showGraceToggle`), and fastag sub-panel (only when `showFastagModule && vehicle.hasFastag`) in `StepCard stepNum={3} isLocked={returnPhotos.length === 0}`. Compute button calls `computeChargesMutation.mutate()`. `isCompleted={!!returnSession && returnSession.session.status !== "OPEN"}`. | | |
| TASK-010 | In `buildComputePayload()`, add `applyGrace` field: `if (frozenConfig?.gracePolicyEnabled) payload.applyGrace = applyGrace;`. | | |
| TASK-011 | Build **Step 4** (Safety Deposit Info): `StepCard stepNum={4} isLocked={!returnSession}`. Only render when `booking.safetyDeposit > 0`. Show: "₹{safetyDeposit} safety deposit collected at pickup has been automatically applied as a credit toward your charges." Also show the `LedgerSummaryCard` here for the first time so employee can see the net payable before proceeding to payment. | | |
| TASK-012 | Build **Step 5** (Collect Payment / Refund): `StepCard stepNum={5} isLocked={!returnSession} isCompleted={paymentSettled}`. Show `LedgerSummaryCard` (if not shown in Step 4) + `RecordPaymentPanel`. When `session.netPayable == "0.00"` show a "No Payment Required — Proceed" button that calls a new `markReturnComplete` mutation (see TASK-013). When `session.isRefund === true`, `RecordPaymentPanel` renders in refund mode (it already supports this via the `recordRefund` endpoint). On `onSuccess` when `updatedSession.status === "COMPLETED"`, set `paymentSettled = true` and invalidate booking query. | | |
| TASK-013 | Add a `markReturnComplete` mutation for the zero-balance case: calls `POST /employee/sessions/:sessionPublicId/record-payment` with `amount: 0, method: "CASH", idempotencyKey: \`zero-balance:${session.publicId}\``. The existing `runPostCompletionHooks(RETURN)` fires on completion regardless of amount. | | |
| TASK-014 | Build **Step 6** (Vehicle Condition + Damage): `StepCard stepNum={6} isLocked={!paymentSettled}`. Contains the "No damage" / "Damage found" toggle. When "No damage" is selected AND `paymentSettled` → show a success state (booking is already `RETURNED` via hooks). When "Damage found" → show the existing damage form and "Report Damage" button. Damage report does NOT affect booking status — it only creates the `DamageReport` record for manager review. | | |
| TASK-015 | Remove the old "Complete Return" dialog (`showCompleteDialog`), the "Report Manager for Damage" dialog (`showReportDialog`), and the sidebar "Return Summary" card with the action buttons. These are replaced by Step 5 and Step 6. | | |
| TASK-016 | Remove the "Advance Payment Banner" (lines 559–578 in current file). In the session flow, any outstanding balance shows up in the session ledger as a `BOOKING_BASE` entry. The banner is redundant and confusing. | | |
| TASK-017 | Preserve the full legacy path: wrap the entire new step flow in `{booking.usePaymentSessions ? <NewFlow /> : <LegacyFlow />}`. The legacy flow is the current flat card layout unchanged. | | |

### Implementation Phase 3 — Frontend: `StepCard` component extraction

- GOAL-003: Extract `StepCard` and `YesNoToggle` into shared components so both `StaffPickupsPage` and `ReturnProcessPage` use the same UI primitives.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Create `apps/frontend/src/components/employee/StepCard.tsx`. Export: `StepCard` (props: `stepNum, title, subtitle?, isCompleted, isLocked, children`). Copy the exact JSX from `StaffPickupsPage.tsx` lines ~200–240 (the `StepCard` inner function). | | |
| TASK-019 | Update `StaffPickupsPage.tsx` to import `StepCard` from the extracted component instead of defining it inline. | | |
| TASK-020 | Import `StepCard` in `ReturnProcessPage.tsx`. | | |

### Implementation Phase 4 — Frontend: `paymentSessionService` additions

- GOAL-004: Add `getActiveReturnSession` to `paymentSessionService` for page-reload restoration (same pattern as `getActivePickupSession`).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | In `apps/frontend/src/services/paymentSession.service.ts`, add: `async getActiveReturnSession(bookingPublicId: string): Promise<ReturnSessionResponse \| null>`. Calls `GET /employee/bookings/:bookingPublicId/return/session`, catches 404, returns null. Return type is `ReturnSessionResponse` (wraps `session` + `chargeBreakdown`). Note: `GetReturnSession` endpoint currently does NOT return `chargeBreakdown`. Update the service to accept `{ session: PaymentSession }` only for the restore case (chargeBreakdown is not needed on reload). | | |
| TASK-022 | In `ReturnProcessPage.tsx`, add `useEffect` (after `useSessionFlow` equivalent declaration) that calls `getActiveReturnSession` on mount and restores `returnSession` state if an AWAITING_PAYMENT session exists. | | |

### Implementation Phase 5 — Backend: `GetReturnSession` response shape fix

- GOAL-005: The `GetReturnSession` endpoint returns `{ session }` but `computeReturnSession` returns `{ session, chargeBreakdown }`. Align the GET response for page-reload consistency.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | In `apps/backend/src/controller/employee/returnSession.controller.ts`, update `GetReturnSession` to also return a `chargeBreakdown` stub: query `ChargeEntry` records for the booking and return them in the same shape as `ComputeReturnSession`. This allows the frontend to restore charge details on page reload without requiring recompute. Alternatively (simpler): store `chargeBreakdown` in the `PaymentSession.metadata` JSON field during compute so GET can return it without an extra DB query. Use the `metadata` approach. | | |
| TASK-024 | In `ComputeReturnSession`, after building `breakdown`, serialize it and store in `paymentSession.update({ data: { metadata: { chargeBreakdown: ... } } })` before transitioning to AWAITING_PAYMENT. | | |
| TASK-025 | In `GetReturnSession`, read `session.metadata?.chargeBreakdown` and include it in the response. If not present (old sessions), return `chargeBreakdown: null`. | | |

## 3. Alternatives

- **ALT-001**: Keep the damage form before payment — rejected because payment cannot be blocked by damage assessment ambiguity. Damage fines are a separate manager decision that happens after return.
- **ALT-002**: Auto-proceed when `netPayable === 0` without any button press — rejected because an explicit acknowledgement step is better UX and provides an audit trail.
- **ALT-003**: Add a separate "Use safety deposit as refund" toggle so the employee can choose to NOT apply it — rejected because the deposit was collected specifically as collateral for charges; automatic credit is correct. Full refund (when deposit > charges) is handled naturally by `netPayable < 0`.
- **ALT-004**: Store `chargeBreakdown` in a separate `ReturnChargeBreakdown` Prisma model — rejected as over-engineering. The `PaymentSession.metadata` JSON field is sufficient.

## 4. Dependencies

- **DEP-001**: `PaymentSession` model with `metadata: Json?` field — verify this exists in `packages/db/prisma/schema.prisma`.
- **DEP-002**: `runPostCompletionHooks(RETURN)` in `paymentSession.controller.ts` — must transition `booking.status → RETURNED` and `vehicle.status → AVAILABLE`. Verify this already works (it does, per earlier code review).
- **DEP-003**: `StepCard` component (to be created in Phase 3).
- **DEP-004**: `LedgerSummaryCard` — existing, no changes needed.
- **DEP-005**: `RecordPaymentPanel` — existing, already handles both payment and refund modes.
- **DEP-006**: `paymentSessionService.computeReturnSession` — existing, no changes needed.

## 5. Files

- **FILE-001**: `apps/frontend/src/pages/employee/ReturnProcessPage.tsx` — major refactor (new step flow)
- **FILE-002**: `apps/frontend/src/components/employee/StepCard.tsx` — NEW extracted component
- **FILE-003**: `apps/frontend/src/pages/employee/StaffPickupsPage.tsx` — minor: import StepCard from FILE-002
- **FILE-004**: `apps/frontend/src/services/paymentSession.service.ts` — add `getActiveReturnSession`
- **FILE-005**: `apps/backend/src/controller/employee/returnSession.controller.ts` — transaction wrap + metadata storage
- **FILE-006**: `apps/backend/src/routes/employee/session.routes.ts` — no changes needed (routes already registered)

## 6. Testing

- **TEST-001**: Branch with all modules enabled (extraKm, extraTime, fuel, fastag, grace, safetyDeposit, damage) — verify all Step 3 sub-panels render and chargeBreakdown contains entries for each module with charges.
- **TEST-002**: Customer with safetyDeposit=600, additional charges=400 → netPayable should be −200 (refund). Verify Step 5 shows "Refund to customer: ₹200" and RecordPaymentPanel calls `record-refund`.
- **TEST-003**: Customer with safetyDeposit=200, additional charges=500 → netPayable should be 300 (payment due). Verify Step 5 shows payment collection.
- **TEST-004**: Customer with safetyDeposit=300, no additional charges → netPayable=−300. Verify zero-charge edge case (no extra km/time, full fuel, no fastag) still produces correct session.
- **TEST-005**: Page reload when session is AWAITING_PAYMENT — verify `getActiveReturnSession` restores state and Step 5 is unlocked.
- **TEST-006**: Grace period toggle ON → `applyGrace: true` sent to compute endpoint → grace deduction applied in charge breakdown.
- **TEST-007**: Step 6 damage form — submit with photos → verify `reportDamage` endpoint called, booking status is already `RETURNED` from Step 5 completion.
- **TEST-008**: Legacy path (`usePaymentSessions: false`) — verify old flat form still works end-to-end with the "Complete Return" button.
- **TEST-009**: Transaction timeout — submit with 4 capture images + fastag + fuel deficit — verify no "Transaction not found" error (timeout=30000 fix).

## 7. Risks & Assumptions

- **RISK-001**: `PaymentSession.metadata` field may be `Json` type in Prisma but typed as `any` in generated client. Cast carefully to avoid runtime type errors when reading `session.metadata?.chargeBreakdown`.
- **RISK-002**: `runPostCompletionHooks(RETURN)` sets `booking.status = RETURNED`. If damage is reported AFTER this, the booking is already `RETURNED`. The damage report must accept `RETURNED` status bookings — verify this in `reportDamage` backend validation.
- **RISK-003**: If the employee closes the page after computing charges but before paying, the RETURN session will be in AWAITING_PAYMENT. On return, `getActiveReturnSession` will restore it. If they change odometer/fuel, they must recompute (existing entries are voided and replaced — this already works).
- **ASSUMPTION-001**: `booking.safetyDeposit` field is always present and accurate (set at pickup). The backend's automatic deposit credit in `ComputeReturnSession` uses this value.
- **ASSUMPTION-002**: `frozenChargeConfig` is populated on the booking fetched by `bookingService.getReturnDetails`. Verify the booking service query includes `frozenChargeConfig` in the select/include.
- **ASSUMPTION-003**: `vehicle.hasFastag` is included in the booking items response for the return page. Verify `booking.items[0].vehicle.hasFastag` is populated.

## 8. Related Specifications / Further Reading

- `plan/feature-unified-deferred-payment-session-1.md` — v1 pickup session plan (superseded by v2)
- `plan/feature-unified-pickup-flow-v2.md` — pickup flow v2 (implemented; this return plan mirrors its structure)
- `apps/backend/src/controller/employee/returnSession.controller.ts` — existing compute logic
- `apps/backend/src/controller/employee/paymentSession.controller.ts` — `runPostCompletionHooks(RETURN)` implementation
- `apps/frontend/src/components/payment/LedgerSummaryCard.tsx` — reused unchanged
- `apps/frontend/src/components/payment/RecordPaymentPanel.tsx` — reused unchanged
