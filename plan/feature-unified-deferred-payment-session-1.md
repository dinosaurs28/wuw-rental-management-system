---
goal: Deferred Centralized Payment Capture — Unified Payment Session for Pickup, Extension, Charges, Safety Deposit & Discounts
version: 1.0
date_created: 2026-03-27
last_updated: 2026-03-27
owner: Backend + Frontend
status: 'In progress'
tags: [feature, payment, refactor, pickup, extension, session]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Currently, the pickup workflow (`StaffPickupsPage.tsx` + `pickup.controller.ts`) and the extension workflow (`ExtendBookingModal.tsx` + `extension.controller.ts`) each trigger their own payment collection independently. Safety deposit, additional charges, and discounts similarly each initiate payment in isolation. This creates a fragmented, repetitive experience for the employee who must handle multiple "collect payment" interactions per booking.

This plan replaces the per-section payment model with a **deferred, backend-managed payment session ledger**. Each section (extension, additional charges, safety deposit, discount) performs only its business logic and writes a ledger entry to an active session. The employee completes all required sections in any order, then triggers a single **"Make Payment"** action. The backend recomputes the total, validates idempotency, and atomically commits all state changes (booking status, vehicle status, extension confirmation, deposit recording) upon successful payment collection.

The `PaymentSession` + `LedgerEntry` model already exists and is used by the PICKUP session flow. This plan extends that infrastructure to cover the full pre-handover workflow.

---

## 1. Requirements & Constraints

- **REQ-001**: Each section (extension, additional charge, safety deposit, discount) MUST write a `LedgerEntry` to an active `PaymentSession` instead of triggering immediate payment.
- **REQ-002**: A single `PaymentSession` of type `PICKUP` MUST aggregate all pre-handover charges before the employee initiates payment.
- **REQ-003**: The backend MUST recompute `netPayable` from all ledger entries at payment time and MUST NOT trust frontend-supplied totals.
- **REQ-004**: The "Make Payment" endpoint MUST implement idempotency using a client-supplied `idempotencyKey` to prevent duplicate payments.
- **REQ-005**: The `PaymentSession` MUST be persisted in the database and survive page reloads or connection drops.
- **REQ-006**: Post-payment completion hooks MUST atomically commit: booking status → `PICKED_UP`, vehicle status → `OUT_FOR_RENTAL`, extension confirmation, safety deposit approval, discount application.
- **REQ-007**: Each section's ledger entry MUST be idempotent — re-submitting the same section action MUST update the existing entry, not create a duplicate.
- **REQ-008**: The extension `commit` flow (vehicle locking, availability check) remains unchanged. Only the payment step is deferred to the unified session.
- **REQ-009**: The existing PICKUP session flow (`pickupSession.controller.ts`) already handles remaining balance and safety deposit. The refactor MUST extend this controller to also accept extension and additional charge ledger entries.
- **REQ-010**: All monetary amounts MUST be stored as `Decimal`/`string` — never `number` — in database fields to avoid floating-point errors.
- **REQ-011**: The `BranchChargeConfig.usePaymentSessions` flag MUST be respected. If `false`, the legacy direct-payment flow (`pickup.controller.ts`, `extension.controller.ts`) remains active.
- **REQ-012**: The frontend MUST poll or refetch the active session after each section action so the displayed running total stays current.

- **SEC-001**: The backend MUST verify the booking belongs to the authenticated employee's branch on every session mutation.
- **SEC-002**: Ledger entries for discounts MUST be validated against the discount record in the database — the employee cannot submit arbitrary negative amounts.
- **SEC-003**: Safety deposit amounts MUST be validated against `frozenChargeConfig.safetyDepositEnabled` and any configured max limits.

- **CON-001**: `PaymentSession.sessionType` enum currently contains `PICKUP | EXTENSION | RETURN`. No new type is needed — the unified session uses `PICKUP`.
- **CON-002**: Extension vehicle locking via Redis has a TTL. The session must be completed before the lock expires (or lock TTL must be extended while session is open).
- **CON-003**: The `ExtendBookingModal` step 3 (payment collection) is eliminated. Extension is committed and its charge written to the session; payment happens at the unified Make Payment step.
- **CON-004**: The `pickupSession.controller.ts` `initiatePickupSession` endpoint must be refactored to accept optional extension public ID, additional charges, and discount codes to pre-populate ledger entries.

- **GUD-001**: Backend endpoints that add ledger entries MUST return the full updated session (with recalculated totals) so the frontend can stay in sync with a single response.
- **GUD-002**: All new endpoints MUST be placed under `/api/employee/bookings/:bookingId/pickup-session/` to maintain routing consistency.
- **GUD-003**: Frontend state for the payment session MUST be held in a React Query cache entry, not in raw `useState`, to enable automatic refetch and cache invalidation.

- **PAT-001**: Follow the existing `RecordPaymentPanel` + `paymentSession.controller.ts` pattern for the final payment step — no new payment UI component is needed.
- **PAT-002**: Follow the existing `LedgerEntryType` enum values: `BOOKING_BASE`, `EXTENSION`, `DEPOSIT`, `ADDITIONAL_CHARGE`, `DISCOUNT`, `PAYMENT`, `REFUND`.
- **PAT-003**: Post-completion hooks must follow the pattern already in `paymentSession.controller.ts` `handlePostCompletion()`.

---

## 2. Implementation Steps

### Implementation Phase 1 — Database & Schema Audit

- GOAL-001: Confirm existing `LedgerEntryType` values cover all required entry types and add any missing ones; confirm `PaymentSession` schema is sufficient for unified flow.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Read `packages/db/src/schema.prisma` and confirm `LedgerEntryType` enum contains: `BOOKING_BASE`, `EXTENSION`, `DEPOSIT`, `ADDITIONAL_CHARGE`, `DISCOUNT`, `PAYMENT`, `REFUND`. Add any missing values. | ✅ | 2026-03-27 |
| TASK-002 | Confirm `PaymentSession` has a nullable `metadata` JSON column suitable for storing pre-handover state (odo, fuelLevel, pickupFuelLevel, captureImages). If missing, add it (it already appears to exist). | ✅ | 2026-03-27 |
| TASK-003 | Confirm `LedgerEntry` has a `label` or `description` string column for human-readable entry names (e.g., "Extension charge", "Safety Deposit", "Promo discount"). Add if missing. | ✅ | 2026-03-27 |
| TASK-004 | If schema changes are made, run `pnpm db:generate` and `pnpm db:migrate` and commit generated client files. | ✅ | 2026-03-27 |

---

### Implementation Phase 2 — Backend: Extend Pickup Session Initiation

- GOAL-002: Extend `POST /employee/bookings/:bookingId/pickup-session/initiate` to accept optional extension public ID and additional charge line items, writing corresponding ledger entries at session creation time.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | In `apps/backend/src/controller/employee/pickupSession.controller.ts`, update `initiatePickupSessionSchema` to add optional fields: `extensionPublicId?: string`, `additionalCharges?: Array<{ label: string; amount: number; taxable: boolean }>`, `discountCode?: string`. | ✅ | 2026-03-27 |
| TASK-006 | In `InitiatePickupSession` handler: if `extensionPublicId` is provided, query the `Extension` record (must belong to this booking, status `PENDING_PAYMENT`), read `extensionAmount`/`taxAmount` from the extension, and create a `LedgerEntry` of type `EXTENSION` with the extension's computed charge. | ✅ | 2026-03-27 |
| TASK-007 | In `InitiatePickupSession` handler: if `additionalCharges` array is provided, create one `LedgerEntry` of type `ADDITIONAL_CHARGE` per item, respecting the `taxable` flag for GST inclusion. | | |
| TASK-008 | In `InitiatePickupSession` handler: if `discountCode` is provided, validate the discount record exists and is active in the DB (do not trust the discount amount from the client), then create a `LedgerEntry` of type `DISCOUNT` with a negative amount. | | |
| TASK-009 | After all entries are created, recompute session totals (`taxableBase`, `nonTaxableBase`, `gstAmount`, `totalCharges`, `totalDiscounts`, `netPayable`) in a single DB transaction and update the `PaymentSession` record. Return the full session with all entries. | ✅ | 2026-03-27 |

---

### Implementation Phase 3 — Backend: Add-to-Session Mutation Endpoints

- GOAL-003: Create individual endpoints that allow adding or updating ledger entries on an existing open PICKUP session, enabling the employee to apply sections in any order after session initiation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Create `POST /employee/bookings/:bookingId/pickup-session/add-extension` handler in `pickupSession.controller.ts`. Accepts `{ extensionPublicId: string }`. Validates: session exists, status is `AWAITING_PAYMENT`, extension belongs to booking, extension status is `PENDING_PAYMENT`. Upserts a `EXTENSION` ledger entry (delete existing EXTENSION entry if present, create new). Recomputes and updates session totals. Returns updated session. | | |
| TASK-011 | Create `POST /employee/bookings/:bookingId/pickup-session/add-charge` handler. Accepts `{ label: string; amount: number; taxable: boolean; idempotencyKey: string }`. Validates session open. Uses `idempotencyKey` to upsert (prevent duplicates). Creates `ADDITIONAL_CHARGE` ledger entry. Recomputes totals. Returns updated session. | | |
| TASK-012 | Create `POST /employee/bookings/:bookingId/pickup-session/remove-charge` handler. Accepts `{ ledgerEntryPublicId: string }`. Validates entry belongs to this session and is type `ADDITIONAL_CHARGE`. Deletes entry. Recomputes totals. Returns updated session. | | |
| TASK-013 | Create `POST /employee/bookings/:bookingId/pickup-session/apply-discount` handler. Accepts `{ discountCode: string }`. Validates discount record in DB. Upserts DISCOUNT ledger entry (only one discount per session). Recomputes totals. Returns updated session. | | |
| TASK-014 | Create `DELETE /employee/bookings/:bookingId/pickup-session/remove-discount` handler. Removes existing DISCOUNT ledger entry. Recomputes totals. Returns updated session. | | |
| TASK-015 | Extract a shared `recomputeSessionTotals(sessionId, tx)` utility function in `apps/backend/src/services/paymentSession/sessionTotals.service.ts` that all the above handlers call. Logic: sum all non-PAYMENT/non-REFUND entries split by taxable flag, apply GST rate from `frozenChargeConfig`, set `totalCharges`, `totalDiscounts`, `gstAmount`, `netPayable`. | | |

---

### Implementation Phase 4 — Backend: Post-Completion Hook for Unified PICKUP Session

- GOAL-004: Extend the `handlePostCompletion` function in `paymentSession.controller.ts` so that when a `PICKUP` session completes, it also confirms any committed extension and applies any approved discount.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | In `apps/backend/src/controller/employee/paymentSession.controller.ts`, locate `handlePostCompletion`. In the `PICKUP` branch, after setting booking → `PICKED_UP` and vehicle → `OUT_FOR_RENTAL`, add: query session entries for type `EXTENSION`; if found, fetch the linked `Extension` record and update its status to `CONFIRMED`, update `booking.endAt` to extension's `newEndAt`, increment `booking.extensionCount`. | ✅ | 2026-03-27 |
| TASK-017 | In the `PICKUP` post-completion hook, add: query session entries for type `DISCOUNT`; if found, fetch the linked discount record and apply it to `booking.discountAmount` and `booking.discountCode`. Also record `discount.usageCount` increment if the discount has a usage limit. | | |
| TASK-018 | In the `PICKUP` post-completion hook, add: query session entries for type `ADDITIONAL_CHARGE`; if found, create `AdditionalCharge` records (or equivalent) linked to the booking, summing the charged amounts into `booking.additionalCharges`. | | |
| TASK-019 | Wrap all post-completion mutations (booking status, vehicle status, extension confirm, discount apply, additional charges) in a single Prisma `$transaction`. On transaction failure, set session status back to `AWAITING_PAYMENT` (or `PAYMENT_INITIATED`) and return a 500 with a retryable error. | ✅ | 2026-03-27 |

---

### Implementation Phase 5 — Backend: Disable Per-Section Immediate Payment in Extension Flow

- GOAL-005: Remove the extension `collect` payment trigger when `usePaymentSessions = true` and instead return the session state, directing the frontend to the unified payment step.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | In `apps/backend/src/controller/employee/extension.controller.ts`, in the `CommitExtension` handler: after successful commit (extension status = `PENDING_PAYMENT`), check `BranchChargeConfig.usePaymentSessions`. If true, return `{ status: "PENDING_PAYMENT", usePaymentSession: true, extensionPublicId }` instead of any payment prompt. | ✅ | 2026-03-27 |
| TASK-021 | In `apps/backend/src/services/extension/extension.service.ts`, the `collect()` method remains unchanged for the legacy flow. Add a guard at the top: if `usePaymentSessions = true`, throw a 400 error with `"Use payment session flow instead"` to prevent accidental direct payment collection. | | |
| TASK-022 | Update `apps/backend/src/routes/employee/extension.routes.ts` to document (via comment) that `/:extensionPublicId/collect` is a legacy route disabled when `usePaymentSessions = true`. | | |

---

### Implementation Phase 6 — Frontend: Pickup Session State Management

- GOAL-006: Replace raw `useState` for pickup session with React Query cache and expose a typed session hook that all sections in `StaffPickupsPage.tsx` can read and mutate.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | In `apps/frontend/src/services/paymentSession.service.ts` (or create `pickupSession.service.ts`), add typed API call functions: `addExtensionToSession(bookingId, extensionPublicId)`, `addChargeToSession(bookingId, payload)`, `removeChargeFromSession(bookingId, ledgerEntryPublicId)`, `applyDiscountToSession(bookingId, discountCode)`, `removeDiscountFromSession(bookingId)`. Each returns the updated `PaymentSession`. | | |
| TASK-024 | In `apps/frontend/src/pages/employee/StaffPickupsPage.tsx`, replace the `pickupSession` raw state with a `useQuery` call: `useQuery(['pickup-session', bookingId], () => pickupSessionService.getSession(bookingId))`. The query is enabled only when `hasPendingPayment === true` and a session has been initiated. | | |
| TASK-025 | Add a `useInitiatePickupSession` mutation (wraps `useMutation`) that calls `initiatePickupSession` and then invalidates the `['pickup-session', bookingId]` query key on success. | | |
| TASK-026 | Add a `useAddExtensionToSession` mutation that calls `addExtensionToSession` and invalidates `['pickup-session', bookingId]`. This mutation is called from the extension section after a successful `commit` response with `usePaymentSession: true`. | | |
| TASK-027 | Add a `useApplyDiscountToSession` / `useRemoveDiscountFromSession` mutation pair that calls the corresponding service functions and invalidates the session query. | | |

---

### Implementation Phase 7 — Frontend: Refactor StaffPickupsPage Section Flows

- GOAL-007: Remove per-section payment dialogs from `StaffPickupsPage.tsx`. Each section writes to the session; the final step shows a unified `RecordPaymentPanel`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-028 | In `StaffPickupsPage.tsx`, locate the extension step. After `ExtendBookingModal.onSuccess` fires with `usePaymentSession: true`, call `addExtensionToSession` mutation instead of showing a payment dialog. Display a success toast "Extension added to payment" and show the updated session total in the UI. | | |
| TASK-029 | In `StaffPickupsPage.tsx`, if an additional-charge section exists, replace any direct payment trigger with a call to `addChargeToSession`. Display the updated session ledger inline. | | |
| TASK-030 | In `StaffPickupsPage.tsx`, if a discount/coupon section exists, replace direct application with a call to `applyDiscountToSession`. Show discount row in the session ledger summary. | | |
| TASK-031 | In `StaffPickupsPage.tsx`, render a session ledger summary card (below the section list and above the "Make Payment" button) that shows all current ledger entries from the active session: label, amount, taxable indicator, and a running total (`netPayable`). This card reads from the React Query session cache. | | |
| TASK-032 | Replace `showSessionPaymentDialog` state and the current ad-hoc payment dialog with a single bottom-anchored `RecordPaymentPanel` component that receives the active session. The panel is shown when the session exists and status is `AWAITING_PAYMENT`. Disable the "Make Payment" / "Confirm Handover" button until all mandatory sections are complete (e.g., KYC verified, photos uploaded). | | |

---

### Implementation Phase 8 — Frontend: Refactor ExtendBookingModal Payment Step

- GOAL-008: Remove Step 3 (payment collection) from `ExtendBookingModal` when the parent context is a pickup session flow; replace with a confirmation message that directs the employee to the unified payment step.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-033 | Add a `mode` prop to `ExtendBookingModal`: `"standalone" | "pickup-session"`. When `mode === "pickup-session"`, after successful `commit`, skip Step 3 and instead show "Extension committed — ₹X added to pickup payment." and call `onSuccess({ usePaymentSession: true, extensionPublicId, amount })`. | | |
| TASK-034 | When `mode === "standalone"` (called from rental management page outside pickup flow), retain the existing Step 3 payment collection behavior unchanged. | | |
| TASK-035 | Remove the auto-cancel on close behavior from `ExtendBookingModal` when `mode === "pickup-session"` and extension status is `PENDING_PAYMENT` — the extension should remain committed until the session is completed or abandoned. Extension cancellation in this context should only occur if the employee explicitly cancels the entire pickup session. | | |

---

### Implementation Phase 9 — Backend: Session Abandonment & Cleanup

- GOAL-009: Handle the case where a pickup session is abandoned (employee navigates away, vehicle becomes unavailable, session expires) and cleanly revert all pending state.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-036 | Create `POST /employee/bookings/:bookingId/pickup-session/abandon` endpoint. Validates session exists and is not `COMPLETED`. Updates session status to `ABANDONED`. If session has an `EXTENSION` ledger entry, resets the linked extension status back to `PENDING_PAYMENT` (releases vehicle lock is a separate concern handled by Redis TTL). | | |
| TASK-037 | On `StaffPickupsPage.tsx` unmount (component cleanup / `useEffect` return), if an active session exists with status `AWAITING_PAYMENT`, call the abandon endpoint. | | |
| TASK-038 | Add a `GET /employee/bookings/:bookingId/pickup-session` endpoint (already partially exists) that returns the current active (non-abandoned, non-completed) session for a booking. Frontend uses this to restore state on page reload. | | |

---

### Implementation Phase 10 — Validation, Guards & Idempotency

- GOAL-010: Ensure all critical mutations are idempotent and all inputs are validated at the backend boundary.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-039 | Add Zod schemas in `packages/schemas/src/pickupSession.schema.ts` for all new endpoint payloads: `addExtensionSchema`, `addChargeSchema`, `applyDiscountSchema`, `recordPickupPaymentSchema`. Export from `packages/schemas/src/index.ts`. | | |
| TASK-040 | Implement upsert logic (not insert) for ledger entries: before creating a new entry, check if an entry of the same type (EXTENSION, DISCOUNT) already exists in the session. Delete the old one, insert the new one, recompute totals — all in one transaction. | | |
| TASK-041 | For `ADDITIONAL_CHARGE` entries, use the client-supplied `idempotencyKey` as a unique constraint (unique index on `LedgerEntry.idempotencyKey`). On duplicate key violation, return the existing session unchanged (HTTP 200). | | |
| TASK-042 | Before the final `record-payment` call, the backend MUST lock the booking row (`SELECT ... FOR UPDATE` or Prisma `$executeRaw`) to prevent concurrent payment submissions. | | |

---

## 3. Alternatives

- **ALT-001**: **Frontend-only aggregation** — accumulate all charges in React state and send the total to a single payment endpoint. Rejected because the backend cannot recompute or validate totals without the original line items, violating REQ-003. State is also lost on page reload.
- **ALT-002**: **New `HANDOVER` session type** — introduce a new `PaymentSessionType.HANDOVER` to distinguish the unified session from the existing `PICKUP` session. Rejected because it requires a schema migration and the `PICKUP` type already semantically covers the vehicle handover event; the extension is deferred by design.
- **ALT-003**: **Immediate extension payment, then credit to session** — collect extension payment immediately and record it as a PAYMENT ledger entry on the session, then let the session settle any remaining balance. Rejected because it introduces two payment interactions and the session pattern exists precisely to avoid this.
- **ALT-004**: **WebSocket live session updates** — push session state updates to the frontend via WebSocket instead of polling/refetching. Rejected as over-engineering; React Query's `invalidateQueries` on mutation success is sufficient and avoids WebSocket infrastructure complexity.
- **ALT-005**: **Separate "additional charges" microflow outside the session** — keep additional charges in their own table updated independently, and only merge into the session at payment time. Rejected because it requires a separate aggregation step and the ledger is the natural place for all charge line items.

---

## 4. Dependencies

- **DEP-001**: `PaymentSession` + `LedgerEntry` Prisma models — already present; this plan extends their usage.
- **DEP-002**: `BranchChargeConfig.usePaymentSessions` flag — must be `true` for the unified flow to activate. The legacy flow remains for branches with this flag disabled.
- **DEP-003**: Redis vehicle locking in `extension.service.ts` — the Redis lock TTL for committed extensions must be sufficient to cover the full pickup session duration (recommend extending TTL to 30 minutes on commit when `usePaymentSessions = true`).
- **DEP-004**: `RecordPaymentPanel.tsx` component — already exists and works with any `PaymentSession`; no changes needed.
- **DEP-005**: `recomputeSessionTotals` utility (TASK-015) — all Phase 3 endpoints depend on this being extracted before they are implemented.
- **DEP-006**: `packages/schemas` Zod schemas (TASK-039) — must be created before frontend API service functions reference them.

---

## 5. Files

- **FILE-001**: `apps/backend/src/controller/employee/pickupSession.controller.ts` — primary file for all new add-to-session endpoints (Phases 2, 3, 9).
- **FILE-002**: `apps/backend/src/controller/employee/paymentSession.controller.ts` — extend `handlePostCompletion` for unified PICKUP hook (Phase 4).
- **FILE-003**: `apps/backend/src/controller/employee/extension.controller.ts` — add `usePaymentSessions` branch in `CommitExtension` handler (Phase 5).
- **FILE-004**: `apps/backend/src/services/extension/extension.service.ts` — add guard in `collect()` for session mode (Phase 5).
- **FILE-005**: `apps/backend/src/services/paymentSession/sessionTotals.service.ts` — NEW FILE: shared `recomputeSessionTotals(sessionId, tx)` utility (TASK-015).
- **FILE-006**: `apps/backend/src/routes/employee/pickupSession.routes.ts` — register new endpoints from Phase 3 and 9.
- **FILE-007**: `apps/frontend/src/pages/employee/StaffPickupsPage.tsx` — major refactor: replace payment dialogs with session-based flow (Phase 6, 7).
- **FILE-008**: `apps/frontend/src/components/employee/extension/ExtendBookingModal.tsx` — add `mode` prop, remove Step 3 in `pickup-session` mode (Phase 8).
- **FILE-009**: `apps/frontend/src/services/pickupSession.service.ts` — NEW FILE: typed API call wrappers for all new pickup session endpoints (TASK-023).
- **FILE-010**: `packages/schemas/src/pickupSession.schema.ts` — NEW FILE: Zod schemas for new endpoints (TASK-039).
- **FILE-011**: `packages/schemas/src/index.ts` — export new schemas (TASK-039).
- **FILE-012**: `packages/db/src/schema.prisma` — add missing `LedgerEntryType` values or `LedgerEntry.description` column if TASK-001/003 identify gaps.

---

## 6. Testing

- **TEST-001**: `POST /pickup-session/initiate` with `extensionPublicId` creates EXTENSION ledger entry and returns updated `netPayable` including extension charge.
- **TEST-002**: Submitting the same `add-charge` request twice with the same `idempotencyKey` returns HTTP 200 with unchanged session (no duplicate entry).
- **TEST-003**: `apply-discount` with an invalid/expired discount code returns HTTP 400.
- **TEST-004**: `record-payment` on a PICKUP session with EXTENSION ledger entry confirms the extension (status → `CONFIRMED`, `booking.endAt` updated) atomically with booking/vehicle status change.
- **TEST-005**: `record-payment` on a PICKUP session with DISCOUNT ledger entry applies the discount to the booking and increments `discount.usageCount`.
- **TEST-006**: Abandoning a session (calling `/abandon`) resets the linked extension back to `PENDING_PAYMENT`.
- **TEST-007**: Page reload mid-flow restores the active session from `GET /pickup-session` and re-renders the ledger summary with all previously added entries.
- **TEST-008**: Concurrent `record-payment` calls with different idempotency keys return 409 / second call fails due to booking row lock.
- **TEST-009**: When `usePaymentSessions = false`, the legacy `pickup.controller.ts` and `extension.controller.ts` collect flows still work end-to-end.
- **TEST-010**: `ExtendBookingModal` in `pickup-session` mode does not show Step 3 and calls `onSuccess` with `usePaymentSession: true` after commit.

---

## 7. Risks & Assumptions

- **RISK-001**: Redis lock TTL for committed extensions may expire before the employee completes the pickup session, causing the vehicle to become bookable again. **Mitigation**: Extend lock TTL to 30 minutes on extension commit when `usePaymentSessions = true` (TASK in Phase 5).
- **RISK-002**: `recomputeSessionTotals` runs inside multiple transactions; if GST rate changes between ledger entry creation and total recomputation, the displayed total could be inconsistent. **Mitigation**: Capture GST rate in `PaymentSession.metadata` at session initiation and use that frozen rate for all recomputations.
- **RISK-003**: The `handlePostCompletion` transaction in TASK-019 touches many tables (booking, vehicle, extension, discount, additionalCharges) and may hit Prisma's interactive transaction timeout (5 s). **Mitigation**: Minimize queries inside the transaction — use bulk updates and avoid N+1 patterns.
- **RISK-004**: Existing integrations that call `POST /extensions/:id/collect` from other surfaces (e.g., manager panel) will be blocked when `usePaymentSessions = true`. **Mitigation**: TASK-021 adds a clear 400 error message directing to the session flow; verify no other call sites rely on the collect endpoint.
- **RISK-005**: If the employee closes the tab without abandoning the session, the extension vehicle lock persists until Redis TTL. **Mitigation**: Acceptable given the 30-minute TTL; add a cron job to abandon sessions older than `expiresAt` if needed.

- **ASSUMPTION-001**: `BranchChargeConfig.usePaymentSessions` is already stored per branch and readable in all relevant controllers via `req.branch_Id`.
- **ASSUMPTION-002**: The `LedgerEntry` model already has a `publicId` column for deletion operations.
- **ASSUMPTION-003**: GST/tax calculation logic in `recomputeSessionTotals` follows the same rules already implemented in `pickupSession.controller.ts` (taxable base × GST rate).
- **ASSUMPTION-004**: The discount system (`packages/db/schema` discount model, discount service) is already implemented and the discount record can be queried by code.
- **ASSUMPTION-005**: `StaffPickupsPage.tsx` is the only surface that initiates PICKUP sessions — no manager or admin path initiates them independently.

---

## 8. Related Specifications / Further Reading

- [Existing Payment Ledger Session Refactor Plan](./refactor-payment-ledger-session-1.md)
- [Rental Extension System Feature Plan](./feature-rental-extension-system-1.md)
- [Discount System Feature Plan](./feature-discount-system-1.md)
- [Payment Cash Management Feature Plan](./feature-payment-cash-management-1.md)
- `apps/backend/src/controller/employee/pickupSession.controller.ts` — current PICKUP session initiation reference implementation
- `apps/backend/src/controller/employee/paymentSession.controller.ts` — `handlePostCompletion` hook reference
