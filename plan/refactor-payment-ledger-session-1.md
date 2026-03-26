---
goal: Refactor Extension, Safety Deposit, and Payment Handling into a Centralized Session-Driven Ledger-Based Financial Architecture
version: 1.0
date_created: 2026-03-26
last_updated: 2026-03-26
owner: Engineering
status: 'Planned'
tags: [architecture, refactor, payments, ledger, financial, session]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

The VRMS payment system currently stores financial state across fragmented Booking fields, a legacy `Payment` model, a newer `PaymentTransaction` model, and a `Deposit` model — with no unified source of truth for the full financial picture of a booking lifecycle. Extension commitments trigger immediate payments without allowing composition with other charges (deposit, coupons), the safety deposit flow requires branch manager approval adding friction, and there is no session-level idempotency guard against duplicate or partial charges.

This plan refactors all financial operations — booking payment, extension charges, safety deposit collection, return-time charges (extra km, fuel, fastag, damage) and discounts — into a **Payment Session + Ledger Entry** architecture. Every monetary operation becomes an append-only ledger entry (EXTENSION, DEPOSIT, EXTRA_KM, FUEL, FASTAG, DISCOUNT, PAYMENT, etc.), all entries belong to a single `PaymentSession` that is the authoritative source of computed totals, and the only way to trigger actual money movement is the unified **"Record Payment"** action. The session is persisted in both the database (primary) and optionally in a client-side resilient store (fallback), and every payment attempt is guarded by an idempotency key.

---

## 1. Requirements & Constraints

- **REQ-001**: Introduce a `PaymentSession` entity with a unique `paymentSessionId`, associated with a booking, persisting across all steps of a flow (pickup, extension, return).
- **REQ-002**: Introduce `LedgerEntry` entities with types: `BOOKING_BASE`, `EXTENSION`, `DEPOSIT`, `EXTRA_KM`, `EXTRA_TIME`, `FUEL`, `FASTAG`, `DAMAGE`, `DISCOUNT`, `PAYMENT`, `REFUND`.
- **REQ-003**: Each `LedgerEntry` must have a classification: `TAXABLE`, `NON_TAXABLE`, `DISCOUNT`, or `PAYMENT`.
- **REQ-004**: No financial module (extension, deposit, charges, overrides, discounts) may modify booking totals directly outside the ledger system.
- **REQ-005**: The final payable or refundable amount must be derived exclusively by aggregating ledger entries on the active session.
- **REQ-006**: The extension flow must add an `EXTENSION` ledger entry without triggering payment immediately, allowing other operations to be composed first.
- **REQ-007**: The safety deposit flow must not require branch manager approval. Employees add a `DEPOSIT` ledger entry directly; approval flag in `BranchChargeConfig` gates the amount ceiling only, not the workflow.
- **REQ-008**: Payment must only be executed through a single "Record Payment" action (`POST /api/employee/sessions/{sessionId}/record-payment`).
- **REQ-009**: Each payment attempt must carry a unique idempotency key to prevent duplicate charges on retry or network failure.
- **REQ-010**: `PaymentSession` state must be persisted in the DB (primary) and mirrored in Redis (secondary/cache) with configurable TTL.
- **REQ-011**: Frontend must mirror session state in `localStorage` as a fallback to restore state after page refresh or navigation.
- **REQ-012**: Upon returning from a payment gateway, the system must re-fetch the session from the backend, revalidate ledger totals, and confirm the payment before marking the session complete.
- **REQ-013**: Advance payment plan support: partial `PAYMENT` entries (with negative amounts representing prior payments) must be stored as ledger entries, and remaining balance is always derived from aggregation.
- **REQ-014**: During vehicle return, all charges (extra km, time, fuel, fastag, damage) must be created as ledger entries on a `RETURN`-type session, and the net payable or refundable is computed from the session.
- **REQ-015**: All modules must be controlled via `BranchChargeConfig` feature flags. The new session/ledger flow is gated by a new `usePaymentSessions: Boolean` flag per branch (defaults `false` for backward compatibility).
- **REQ-016**: All ledger entries must include actor identity (userId, role) and timestamps for full auditability.
- **REQ-017**: Each `LedgerEntry` must have its own `idempotencyKey` (unique) to prevent duplicate entry creation on API retry.
- **REQ-018**: Existing `PaymentTransaction` records must remain valid; new code creates `PaymentTransaction` entries for backward compatibility when a session is completed.
- **CON-001**: Must not break existing bookings. Branches with `usePaymentSessions=false` continue to use the current flow unchanged.
- **CON-002**: No changes to `PricingEngineService` internal calculation logic — it remains the authoritative pricing calculator. Session entries use its output as inputs.
- **CON-003**: Redis is used for caching session state only, not as primary storage. DB is always the source of truth.
- **CON-004**: Prisma transactions must wrap all session + ledger mutations to guarantee atomicity.
- **CON-005**: `DiscountApplication` records remain immutable; discounts applied post-booking are represented as `DISCOUNT` ledger entries on the session.
- **GUD-001**: Use `nanoid(21)` for all new `publicId` fields consistent with existing patterns.
- **GUD-002**: All new service methods must accept a Prisma transaction client (`tx`) parameter for composability inside atomic blocks.
- **GUD-003**: Write audit log entries OUTSIDE of Prisma transactions (consistent with existing `AuditService` usage).
- **GUD-004**: Session computed totals (`taxableBase`, `gstAmount`, `netPayable`, etc.) are cached on the session row and recomputed on every `LedgerEntry` mutation; they are never the authoritative source — the entries always are.
- **PAT-001**: Follow the existing controller → service pattern; no business logic in controllers.
- **PAT-002**: All new API routes follow `/api/employee/sessions/...` namespace for session operations.
- **PAT-003**: Idempotency keys are always `{actorId}:{sessionId}:{entryType}:{timestamp}` or UUIDs generated client-side and passed in the request body.

---

## 2. Implementation Steps

### Implementation Phase 1 — Database Schema: New Models & Enums

- **GOAL-001**: Add `PaymentSession`, `LedgerEntry` models and all required enums to the Prisma schema, run migration, regenerate client.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add enum `PaymentSessionStatus { OPEN COMPUTING AWAITING_PAYMENT PAYMENT_INITIATED COMPLETED ABANDONED }` to `packages/db/prisma/schema.prisma` | | |
| TASK-002 | Add enum `PaymentSessionType { BOOKING PICKUP EXTENSION RETURN }` to schema | | |
| TASK-003 | Add enum `LedgerEntryType { BOOKING_BASE EXTENSION DEPOSIT EXTRA_KM EXTRA_TIME FUEL FASTAG DAMAGE DISCOUNT PAYMENT REFUND }` to schema | | |
| TASK-004 | Add enum `LedgerEntryClassification { TAXABLE NON_TAXABLE DISCOUNT PAYMENT }` to schema | | |
| TASK-005 | Add `PaymentSession` model: fields `id Int @id @default(autoincrement())`, `publicId String @unique @default(nanoid(21))`, `bookingId Int`, `branchId Int`, `sessionType PaymentSessionType`, `status PaymentSessionStatus @default(OPEN)`, `taxableBase Decimal @default(0)`, `nonTaxableBase Decimal @default(0)`, `gstAmount Decimal @default(0)`, `totalCharges Decimal @default(0)`, `totalDiscounts Decimal @default(0)`, `totalPaymentsRecorded Decimal @default(0)`, `netPayable Decimal @default(0)`, `idempotencyKey String?`, `gatewayTransactionId String?`, `gatewayPaymentUrl String?`, `expiresAt DateTime?`, `metadata Json?`, `actorId Int`, `completedAt DateTime?`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, plus relations to `Booking`, `Branch`, `User` (actor), `LedgerEntry[]` | | |
| TASK-006 | Add `LedgerEntry` model: fields `id Int @id @default(autoincrement())`, `publicId String @unique @default(nanoid(21))`, `sessionId Int`, `bookingId Int`, `entryType LedgerEntryType`, `classification LedgerEntryClassification`, `amount Decimal` (positive=charge, negative=credit), `baseAmount Decimal?`, `gstAmount Decimal? @default(0)`, `description String`, `referenceId String?` (publicId of extension/chargeEntry/etc.), `referenceType String?`, `idempotencyKey String @unique`, `isVoided Boolean @default(false)`, `voidedAt DateTime?`, `voidedById Int?`, `voidReason String?`, `actorId Int`, `actorRole String`, `metadata Json?`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, plus relations to `PaymentSession`, `Booking`, `User` (actor), `User?` (voidedBy) | | |
| TASK-007 | Add field `activePaymentSessionId Int?` to `Booking` model with optional relation to `PaymentSession`; also add `paymentSessions PaymentSession[]` back-relation | | |
| TASK-008 | Add field `usePaymentSessions Boolean @default(false)` to `BranchChargeConfig` model (feature flag) | | |
| TASK-009 | Add field `safetyDepositRequiresApproval Boolean @default(false)` to `BranchChargeConfig` if not already present (controls amount ceiling, not workflow) | | |
| TASK-010 | Run `pnpm --filter @vrms/db prisma migrate dev --name add_payment_session_ledger` to create migration file at `packages/db/prisma/migrations/` | | |
| TASK-011 | Run `pnpm --filter @vrms/db prisma generate` to regenerate Prisma client in `packages/db/src/generated/client/` | | |

---

### Implementation Phase 2 — Core Backend Services

- **GOAL-002**: Build `PaymentSessionService` and `LedgerService` as the foundational primitives all other modules will call.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Create `apps/backend/src/services/payment/paymentSession.service.ts`. Implement `createSession(bookingId, branchId, sessionType, actorId, tx?)`: creates `PaymentSession` row with `status=OPEN`, stores on `Booking.activePaymentSessionId`. Returns session object. | | |
| TASK-013 | In `PaymentSessionService`, implement `getSession(sessionId, tx?)`: fetches session with all `LedgerEntry[]` (excluding voided). | | |
| TASK-014 | In `PaymentSessionService`, implement `recomputeTotals(sessionId, tx?)`: aggregates all non-voided `LedgerEntry` rows for the session. Computes: `taxableBase` = sum of TAXABLE entries (excluding PAYMENT/DISCOUNT/REFUND); `nonTaxableBase` = sum of NON_TAXABLE entries; `gstAmount` = sum of `entry.gstAmount`; `totalCharges = taxableBase + nonTaxableBase + gstAmount`; `totalDiscounts` = sum of DISCOUNT entries (negative); `totalPaymentsRecorded` = sum of PAYMENT/REFUND entries (negative); `netPayable = totalCharges + totalDiscounts + totalPaymentsRecorded`. Updates session row. Returns updated session. | | |
| TASK-015 | In `PaymentSessionService`, implement `updateStatus(sessionId, newStatus, tx?)`: validates allowed transitions (`OPEN → COMPUTING → AWAITING_PAYMENT → PAYMENT_INITIATED → COMPLETED`; any → `ABANDONED`). Updates row. | | |
| TASK-016 | In `PaymentSessionService`, implement `persistToRedis(session)`: serializes full session (entries + computed totals) to Redis key `payment_session:{sessionId}` with TTL of 24 hours. Uses existing Redis client. | | |
| TASK-017 | In `PaymentSessionService`, implement `restoreFromRedis(sessionId)`: reads from Redis, returns parsed session or null if expired/missing. | | |
| TASK-018 | In `PaymentSessionService`, implement `abandonSession(sessionId, actorId, reason, tx?)`: sets status=ABANDONED, clears `Booking.activePaymentSessionId`. Logs audit entry. | | |
| TASK-019 | Create `apps/backend/src/services/payment/ledger.service.ts`. Implement `addEntry(sessionId, bookingId, entryType, classification, amount, description, actorId, actorRole, opts?, tx?)` where `opts = { baseAmount?, gstAmount?, referenceId?, referenceType?, idempotencyKey?, metadata? }`. Checks `idempotencyKey` uniqueness (throws if duplicate). Creates `LedgerEntry` row. Calls `recomputeTotals`. Returns updated session. | | |
| TASK-020 | In `LedgerService`, implement `voidEntry(entryPublicId, actorId, voidReason, tx?)`: sets `isVoided=true`, calls `recomputeTotals`. Returns updated session. Only allowed when session status is OPEN or COMPUTING. | | |
| TASK-021 | In `LedgerService`, implement `buildTaxableEntry(baseAmount, gstRuleForBranch)`: helper that computes `gstAmount = baseAmount * (cgstRate + sgstRate)` and returns `{ baseAmount, gstAmount, totalAmount: baseAmount + gstAmount, classification: TAXABLE }`. | | |
| TASK-022 | In `LedgerService`, implement `validateSessionAmount(sessionId, expectedNetPayable, tolerancePaise?)`: re-fetches entries, recomputes totals, checks `|recomputed.netPayable - expectedNetPayable| <= tolerance`. Returns `{ valid: boolean, delta: Decimal }`. Called before every payment execution. | | |
| TASK-023 | Create `apps/backend/src/services/payment/idempotency.service.ts`. Implement `generateKey(actorId, sessionId, entryType, salt?)`: returns `SHA256(${actorId}:${sessionId}:${entryType}:${salt ?? Date.now()})`. Implement `assertUnique(key, tx?)`: queries `LedgerEntry.idempotencyKey`, throws `ConflictError` if found. | | |

---

### Implementation Phase 3 — Extension Flow Refactor

- **GOAL-003**: Modify extension commit to add `EXTENSION` ledger entry to active session instead of immediately creating a `PaymentTransaction` and completing payment.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | In `apps/backend/src/controller/employee/extension.controller.ts` `CommitExtension()`: before touching payment, call `PaymentSessionService.getOrCreateSession(bookingId, EXTENSION, actorId)` — returns existing OPEN session if any, or creates new one. | | |
| TASK-025 | In `CommitExtension()`: call `LedgerService.addEntry(sessionId, bookingId, EXTENSION, TAXABLE, extensionAmount, description, actorId, role, { referenceId: extension.publicId, referenceType: 'EXTENSION', idempotencyKey: req.body.idempotencyKey })`. If `usePaymentSessions=false`, keep existing PaymentTransaction flow. | | |
| TASK-026 | In `CommitExtension()`: update `BookingExtension.status = PENDING_PAYMENT` (not CONFIRMED yet — confirmation happens when session is completed via Record Payment). Remove the block that creates `PaymentTransaction` immediately. | | |
| TASK-027 | In `CommitExtension()`: call `PaymentSessionService.updateStatus(sessionId, AWAITING_PAYMENT)` and `persistToRedis(session)`. Return session publicId + computed totals to client. | | |
| TASK-028 | Add new endpoint `POST /api/employee/sessions/{sessionId}/add-entry` (for ad-hoc entries like a safety deposit added during the same extension flow): validates `entryType`, calls `LedgerService.addEntry`. Returns updated session. | | |
| TASK-029 | In `apps/backend/src/controller/employee/extension.controller.ts` `ConfirmExtension()` (called after Record Payment completes session): update `BookingExtension.status = CONFIRMED`, update `Booking.endAt`, update `Booking.totalFinal` from session totals, execute vehicle swap if needed. | | |

---

### Implementation Phase 4 — Safety Deposit Flow Refactor

- **GOAL-004**: Remove branch manager approval dependency. Employee adds a `DEPOSIT` ledger entry directly to the active session. The deposit amount is validated against branch ceiling config.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-030 | Add new endpoint `POST /api/employee/sessions/{sessionId}/add-deposit` in a new file `apps/backend/src/controller/employee/deposit.controller.ts`. Body: `{ amount: number, reason: string, idempotencyKey: string }`. | | |
| TASK-031 | In `add-deposit` handler: load `BranchChargeConfig.safetyDepositEnabled`. If false, reject with 403. Load any ceiling config. Validate `amount <= maxDepositAmount` (or branch default ceiling). | | |
| TASK-032 | In `add-deposit` handler: call `LedgerService.addEntry(sessionId, bookingId, DEPOSIT, NON_TAXABLE, amount, reason, actorId, role, { idempotencyKey })`. | | |
| TASK-033 | In `add-deposit` handler: create `SafetyDepositRequest` row with `status=APPROVED` (auto-approved, no manager step), `approvedById=actorId`, `approvedAmount=amount`, `approvedAt=now`. This preserves audit trail. | | |
| TASK-034 | Deprecate the `PENDING_APPROVAL` flow for `SafetyDepositRequest` when `usePaymentSessions=true`. Keep existing pickup controller `SafetyDepositRequest` creation for branches with `usePaymentSessions=false`. | | |
| TASK-035 | Remove all branch manager approval API calls from the frontend `StaffPickupsPage.tsx` and `ReturnProcessPage.tsx` when feature flag is active. Replace with direct `add-deposit` call. | | |

---

### Implementation Phase 5 — Pickup Session Integration

- **GOAL-005**: Wire the pickup flow to create and populate a `PICKUP`-type `PaymentSession`, replacing the current ad-hoc remaining-balance collection.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-036 | In `apps/backend/src/controller/employee/pickup.controller.ts` `PickupController()`: at the start of the handler (after gate checks), if `usePaymentSessions=true`, call `PaymentSessionService.createSession(bookingId, branchId, PICKUP, actorId, tx)`. | | |
| TASK-037 | If `booking.isAdvancePayment && !booking.remainingPaidAt`: call `LedgerService.addEntry(sessionId, bookingId, BOOKING_BASE, NON_TAXABLE, booking.remainingBalance, 'Remaining balance due at pickup', actorId, role, { idempotencyKey: idem })`. | | |
| TASK-038 | If `payload.safetyDepositRequest` provided: call `LedgerService.addEntry(sessionId, bookingId, DEPOSIT, NON_TAXABLE, safetyDepositRequest.amount, reason, ...)`. Create `SafetyDepositRequest` row (auto-approved). | | |
| TASK-039 | If `payload.couponCodeAtPickup` provided: evaluate coupon via `DiscountEvaluationEngine`, call `LedgerService.addEntry(sessionId, bookingId, DISCOUNT, DISCOUNT, -discountAmount, couponCode, ...)`. | | |
| TASK-040 | After all entries added: call `PaymentSessionService.updateStatus(sessionId, AWAITING_PAYMENT)` and `persistToRedis`. Return `{ sessionId, sessionPublicId, netPayable, breakdown }` to client. Do NOT mark booking as PICKED_UP yet — that happens when session is completed via Record Payment. | | |
| TASK-041 | Create `POST /api/employee/bookings/{bookingId}/pickup-session/initiate` as the new entry point for pickup flow when `usePaymentSessions=true`. Old `POST /api/employee/bookings/{bookingId}/pickup` remains unchanged for branches with `usePaymentSessions=false`. | | |

---

### Implementation Phase 6 — Return Session Creation

- **GOAL-006**: At vehicle return, create a `RETURN`-type session and populate it with all computed charge entries (extra km, time, fuel, fastag, damage) and safety deposit offset/refund entries.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-042 | Create `apps/backend/src/services/payment/returnSessionBuilder.service.ts`. Implement `buildReturnSession(bookingId, actorId, returnPayload, tx)`: creates RETURN PaymentSession, then calls charge engine and adds all entries. | | |
| TASK-043 | In `buildReturnSession`: call existing `ChargeEngineService.computeReturnCharges(bookingId, returnPayload)` to get charge breakdown. | | |
| TASK-044 | For each charge in breakdown: determine `entryType` (EXTRA_KM → `EXTRA_KM`, EXTRA_TIME → `EXTRA_TIME`, fuel deficit → `FUEL`, fastag → `FASTAG`, damage → `DAMAGE`). Call `LedgerService.buildTaxableEntry` for taxable charges, then `LedgerService.addEntry` for each. | | |
| TASK-045 | If `booking.safetyDeposit > 0` and not yet refunded: add a negative `DEPOSIT` ledger entry (`amount = -booking.safetyDeposit`, `entryType=DEPOSIT`, `classification=NON_TAXABLE`, description='Safety deposit refund'). This reduces the net payable (or creates refund). | | |
| TASK-046 | If net payable after all entries is positive (customer owes money): set `session.status=AWAITING_PAYMENT`. If negative (refund due): set status=AWAITING_PAYMENT with `metadata.isRefund=true`. | | |
| TASK-047 | Expose `POST /api/employee/bookings/{bookingId}/return/session/compute` endpoint. Calls `buildReturnSession`. Returns `{ sessionPublicId, entries, netPayable, isRefund, breakdown }`. This replaces the current `computeReturnCharges` endpoint for `usePaymentSessions=true` branches. | | |
| TASK-048 | After Record Payment (or refund recording) completes the return session: execute the existing return completion logic — update `Booking.status=RETURNED`, update `Booking.endOdometer`, update vehicle status, create `ChargeEntry` records, update invoice. | | |

---

### Implementation Phase 7 — Unified "Record Payment" Endpoint

- **GOAL-007**: Implement the single `POST /api/employee/sessions/{sessionId}/record-payment` endpoint that is the only way to execute payment or refund for any session type.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-049 | Create `apps/backend/src/controller/employee/recordPayment.controller.ts`. Body: `{ method: 'CASH' | 'ONLINE', amount: Decimal, idempotencyKey: string, notes?: string }`. | | |
| TASK-050 | In `recordPayment`: load session, verify `status=AWAITING_PAYMENT`. Verify session belongs to a booking in the employee's branch. | | |
| TASK-051 | In `recordPayment`: call `LedgerService.validateSessionAmount(sessionId, amount)`. If invalid (delta > 1 rupee), throw `ValidationError('Amount mismatch. Re-fetch session and retry.')`. | | |
| TASK-052 | For **CASH** payment: wrap in `prisma.$transaction`: (1) `LedgerService.addEntry(sessionId, PAYMENT, PAYMENT, -amount, 'Cash payment recorded', ...)`, (2) `PaymentSessionService.updateStatus(sessionId, COMPLETED)`, (3) create backward-compat `PaymentTransaction` row (status=CONFIRMED, purpose derived from `session.sessionType`), (4) call post-completion hooks (see TASK-048 for RETURN, TASK-029 for EXTENSION, TASK-057 for PICKUP). | | |
| TASK-053 | For **ONLINE** payment: (1) call PhonePe gateway with `amount` and `idempotencyKey` as `merchantTransactionId`. (2) `LedgerService.addEntry(sessionId, PAYMENT, PAYMENT, -amount, 'Online payment initiated', ..., metadata: { gatewayRef, status: 'INITIATED' })`. (3) `PaymentSessionService.updateStatus(sessionId, PAYMENT_INITIATED)`, set `session.gatewayTransactionId` and `session.gatewayPaymentUrl`. (4) `persistToRedis(session)`. Return `{ paymentUrl, sessionPublicId }` to client. | | |
| TASK-054 | Create `POST /api/employee/sessions/{sessionId}/verify-payment` — called by frontend after returning from gateway. (1) Re-fetch session from DB. (2) Query PhonePe status. (3) If SUCCESS: `LedgerService.updateEntryMetadata(paymentEntryId, { status: 'CONFIRMED', gatewayPaymentId })`. (4) `PaymentSessionService.updateStatus(sessionId, COMPLETED)`. (5) Run post-completion hooks. (6) `persistToRedis`. (7) Return `{ success: true, session }`. | | |
| TASK-055 | Create `POST /api/employee/sessions/{sessionId}/record-refund` for net-refund cases (return session where safety deposit > charges). Body: `{ method, amount, idempotencyKey }`. Validates `amount > 0` and `session.netPayable < 0`. Adds `REFUND` ledger entry. Marks session COMPLETED. Creates `PaymentTransaction` with `purpose=OVERPAYMENT_REFUND`. | | |
| TASK-056 | If `sessionType=PICKUP`: on COMPLETED — update `Booking.remainingPaidAt`, `Booking.remainingPaymentMode`, set `Booking.status=PICKED_UP`, update vehicles to `OUT_FOR_RENTAL`. | | |
| TASK-057 | If `sessionType=EXTENSION`: on COMPLETED — call `ConfirmExtension()` (TASK-029). | | |
| TASK-058 | If `sessionType=RETURN`: on COMPLETED — execute return finalization (TASK-048). | | |

---

### Implementation Phase 8 — Session Persistence & Recovery

- **GOAL-008**: Ensure no financial data is lost on page refresh, tab close, or network interruption. Implement dual-layer persistence (DB primary + Redis/localStorage fallback).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-059 | In `PaymentSessionService.persistToRedis(session)`: serialize `{ sessionPublicId, bookingId, sessionType, status, entries: LedgerEntry[], computedTotals, gatewayTransactionId, gatewayPaymentUrl, updatedAt }` to Redis key `payment_session:{publicId}` with 24-hour TTL. | | |
| TASK-060 | Create `GET /api/employee/sessions/{sessionPublicId}` endpoint: (1) try Redis restore, (2) if miss: DB fetch with entries, (3) recompute totals to validate, (4) return full session state to client. | | |
| TASK-061 | Create `GET /api/employee/bookings/{bookingId}/active-session` endpoint: fetches `Booking.activePaymentSessionId`, returns full session. Used by frontend on page load/refresh to restore in-progress payment flow. | | |
| TASK-062 | In frontend `apps/frontend/src/services/booking.service.ts`: add `saveSessionToLocalStorage(session)` that writes `{ sessionPublicId, netPayable, entries[], bookingId, sessionType, savedAt }` to `localStorage` key `vrms_session_{bookingId}`. Call after every mutation response. | | |
| TASK-063 | In frontend: add `restoreSessionFromLocalStorage(bookingId)`: reads localStorage, validates `savedAt < 24h`, calls `GET /api/employee/sessions/{sessionPublicId}` to verify DB state matches. If mismatch, evicts localStorage and uses DB state. | | |
| TASK-064 | On frontend page load for pickup/extension/return pages: call `GET /api/employee/bookings/{bookingId}/active-session`. If session found with status `AWAITING_PAYMENT` or `PAYMENT_INITIATED`, restore UI to correct step (skip earlier steps). | | |
| TASK-065 | Add session expiry handling: if `session.expiresAt < now`, call `abandonSession`. Frontend shows "Session expired — please restart" banner. For PAYMENT_INITIATED sessions, re-verify gateway status before abandoning (session may have been paid). | | |

---

### Implementation Phase 9 — Frontend Refactor

- **GOAL-009**: Update all employee-facing UI flows to operate against the session API, showing a unified ledger view before the single "Record Payment" action.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-066 | Create `apps/frontend/src/services/paymentSession.service.ts` with methods: `getSession(publicId)`, `getActiveSession(bookingId)`, `addEntry(sessionId, payload)`, `addDeposit(sessionId, payload)`, `recordPayment(sessionId, payload)`, `recordRefund(sessionId, payload)`, `verifyOnlinePayment(sessionId)`. All call respective backend endpoints. | | |
| TASK-067 | Create `apps/frontend/src/store/paymentSession.store.ts` (Zustand): state `{ session: PaymentSession | null, entries: LedgerEntry[], netPayable: Decimal, isRefund: boolean }`. Actions: `setSession`, `addEntry`, `clearSession`. Persist to localStorage via `saveSessionToLocalStorage` on every `setSession` call. | | |
| TASK-068 | Create reusable component `apps/frontend/src/components/payment/LedgerSummaryCard.tsx`: renders a table of all non-voided ledger entries grouped by type (charges, discounts, payments), shows computed totals row, highlights net payable/refundable. Used in all three flows (pickup, extension, return). | | |
| TASK-069 | Create reusable component `apps/frontend/src/components/payment/RecordPaymentPanel.tsx`: shows payment method selector (CASH/ONLINE), amount (pre-filled from `session.netPayable`, read-only), idempotency key (auto-generated UUID), "Record Payment" / "Process Refund" button. Handles online redirect + gateway return verification. | | |
| TASK-070 | Refactor `apps/frontend/src/pages/employee/StaffPickupsPage.tsx`: replace remaining-payment dialog with session-based flow. On "Approve Handover" click: call `POST /api/employee/bookings/{bookingId}/pickup-session/initiate` → receive session → show `LedgerSummaryCard` + `RecordPaymentPanel` as a multi-step panel. Remove old `initiateRemainingPayment` call. | | |
| TASK-071 | Refactor `apps/frontend/src/pages/employee/ReturnProcessPage.tsx`: after odometer/fuel capture and charge computation: call `POST /api/employee/bookings/{bookingId}/return/session/compute` → receive session → show `LedgerSummaryCard` + `RecordPaymentPanel`. Replace `handleCompleteReturn` with `recordPayment` / `recordRefund`. | | |
| TASK-072 | Refactor extension commit flow in employee UI (wherever extension UI exists): after extension evaluation and confirmation, call `CommitExtension` (which now adds EXTENSION ledger entry + returns session), then show session panel with option to add deposit or apply coupon before payment. | | |
| TASK-073 | Add "Add Safety Deposit" button in `LedgerSummaryCard` (visible when `chargeConfig.safetyDepositEnabled=true`): opens a small form (amount, reason), calls `addDeposit(sessionId, ...)`, refreshes session state in store. | | |
| TASK-074 | Handle online payment gateway return: on return URL, read `sessionPublicId` from URL param, call `verifyOnlinePayment(sessionId)`. Show loading state. On success: show completion screen. On failure: show retry option with same idempotency key. | | |
| TASK-075 | Add session restoration on page mount in all three flow pages: call `getActiveSession(bookingId)`, if session found with `status != COMPLETED/ABANDONED`, restore store state and jump to correct UI step. Show banner "Previous session restored." | | |

---

### Implementation Phase 10 — Routes, Middleware & Integration

- **GOAL-010**: Register all new routes, add idempotency middleware, wire up audit logging for all session operations.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-076 | Create `apps/backend/src/routes/employee/session.routes.ts`: register `GET /sessions/:publicId`, `GET /bookings/:bookingId/active-session`, `POST /sessions/:sessionId/add-entry`, `POST /sessions/:sessionId/add-deposit`, `POST /sessions/:sessionId/record-payment`, `POST /sessions/:sessionId/record-refund`, `POST /sessions/:sessionId/verify-payment`. Mount under `/api/employee/`. | | |
| TASK-077 | Create `apps/backend/src/routes/employee/pickup-session.routes.ts`: register `POST /bookings/:bookingId/pickup-session/initiate`. | | |
| TASK-078 | Create `apps/backend/src/routes/employee/return-session.routes.ts`: register `POST /bookings/:bookingId/return/session/compute`. | | |
| TASK-079 | Add idempotency middleware `apps/backend/src/middleware/idempotency.middleware.ts`: reads `X-Idempotency-Key` header or body `idempotencyKey`, checks Redis `idem:{key}` for prior response, returns cached response if found (HTTP 200 with `X-Idempotent-Replayed: true`). Stores response in Redis for 24h after first execution. Apply to all `record-payment`, `add-entry`, `add-deposit`, `record-refund` endpoints. | | |
| TASK-080 | Add audit log calls to all new service methods: `createSession` → `PAYMENT_SESSION_CREATED`, `addEntry` → `LEDGER_ENTRY_ADDED`, `voidEntry` → `LEDGER_ENTRY_VOIDED`, `recordPayment` → `PAYMENT_RECORDED`, `recordRefund` → `REFUND_RECORDED`, `verifyOnlinePayment` → `ONLINE_PAYMENT_VERIFIED`. Use existing `AuditService` called outside transactions. | | |
| TASK-081 | Add staff activity log calls: each session mutation → `StaffActivityService.log(actorId, branchId, PAYMENT, entityRef=session.publicId, actionType=CONFIRMED/CREATED/UPDATED)`. | | |
| TASK-082 | Mount new route files in `apps/backend/src/routes/employee/employee.routes.ts`: import and use `sessionRoutes`, `pickupSessionRoutes`, `returnSessionRoutes`. | | |

---

### Implementation Phase 11 — Backward Compatibility & Migration

- **GOAL-011**: Ensure all branches with `usePaymentSessions=false` continue to work. Provide a data migration script to backfill existing `PaymentTransaction` records into `LedgerEntry` rows for reporting.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-083 | All new session-based code paths are gated by `if (branchChargeConfig.usePaymentSessions)` check at the top of each controller. If false, fall through to existing code. This ensures zero regression for existing branches. | | |
| TASK-084 | Create migration script `packages/db/src/scripts/backfill-ledger-entries.ts`: for each `PaymentTransaction` with status=CONFIRMED: create a synthetic `PaymentSession` (status=COMPLETED, completedAt=transaction.collectedAt) and a corresponding `PAYMENT` `LedgerEntry`. Idempotency key = `backfill:{transactionId}`. | | |
| TASK-085 | In the migration script, also backfill `EXTENSION` entries for confirmed `BookingExtension` records with existing `paymentTransactionId`. Map `BookingExtension.additionalAmount` → `EXTENSION` entry amount. | | |
| TASK-086 | Add `usePaymentSessions=true` as a manual opt-in per branch via admin endpoint `PATCH /api/admin/branches/{branchId}/charge-config` (field already in `BranchChargeConfig`). Document in internal ops runbook. | | |

---

## 3. Alternatives

- **ALT-001**: **Extend `PaymentTransaction` with entry types instead of a new `LedgerEntry` model.** Rejected because `PaymentTransaction` has a fixed schema oriented around gateway references and cash shift reconciliation. Overloading it with DISCOUNT, EXTRA_KM, FUEL entries would violate single responsibility and make aggregation queries complex.
- **ALT-002**: **Use a CQRS event-sourced approach** (domain events → event store → read-model projections). Rejected because the codebase is a traditional Prisma/Express architecture; introducing event sourcing would require a full architecture overhaul and is out of scope. The append-only ledger achieves the same financial correctness guarantees with far less complexity.
- **ALT-003**: **Keep branch manager approval for safety deposits.** Rejected as per requirements. The configuration flag `safetyDepositRequiresApproval` will only gate the maximum amount an employee may add, not the workflow itself. This reduces operational friction without sacrificing branch control.
- **ALT-004**: **Store payment session in localStorage only (no backend persistence).** Rejected because localStorage is ephemeral (cleared on browser data clear, incognito mode, different devices). DB persistence is mandatory; localStorage is the fallback, not the primary.
- **ALT-005**: **One session per booking type (separate PICKUP, EXTENSION, RETURN sessions always created fresh).** Accepted — each flow creates its own typed session. This is simpler than a single long-running session per booking and avoids state contamination across flow boundaries.

---

## 4. Dependencies

- **DEP-001**: Existing `PaymentTransaction`, `Booking`, `BookingExtension`, `SafetyDepositRequest`, `ChargeEntry` models — new code reads from and writes to these for backward compat.
- **DEP-002**: `PricingEngineService` — provides base pricing input for BOOKING_BASE entries. No changes to this service.
- **DEP-003**: `ChargeEngineService.computeReturnCharges()` — provides charge breakdown input for return session builder. Used as-is.
- **DEP-004**: `DiscountEvaluationEngine` — evaluates coupon at pickup time if applied post-booking. Used as-is.
- **DEP-005**: `PhonePe Gateway SDK` — used for online payment initiation and status verification in `record-payment` and `verify-payment`. Existing integration reused.
- **DEP-006**: `Redis` — used for session caching and idempotency response cache. Existing Redis client reused.
- **DEP-007**: `AuditService` — used for all new financial audit events. Existing service reused unchanged.
- **DEP-008**: `nanoid` — already used for `publicId` generation. Used for new model publicIds.
- **DEP-009**: `Prisma` — `prisma.$transaction` used for all atomic session + ledger mutations. Existing transaction patterns followed.
- **DEP-010**: Zustand — existing state management library used for new `paymentSession.store.ts`. No new dependency.
- **DEP-011**: `react-dropzone`, existing UI components (`Card`, `Dialog`, `Button`, `Badge`) — reused in `LedgerSummaryCard` and `RecordPaymentPanel`.

---

## 5. Files

### New Backend Files
- **FILE-001**: `apps/backend/src/services/payment/paymentSession.service.ts` — PaymentSessionService
- **FILE-002**: `apps/backend/src/services/payment/ledger.service.ts` — LedgerService
- **FILE-003**: `apps/backend/src/services/payment/idempotency.service.ts` — IdempotencyService
- **FILE-004**: `apps/backend/src/services/payment/returnSessionBuilder.service.ts` — ReturnSessionBuilder
- **FILE-005**: `apps/backend/src/controller/employee/recordPayment.controller.ts` — Record Payment handler
- **FILE-006**: `apps/backend/src/controller/employee/deposit.controller.ts` — Add deposit to session
- **FILE-007**: `apps/backend/src/routes/employee/session.routes.ts` — Session routes
- **FILE-008**: `apps/backend/src/routes/employee/pickup-session.routes.ts` — Pickup session initiation route
- **FILE-009**: `apps/backend/src/routes/employee/return-session.routes.ts` — Return session compute route
- **FILE-010**: `apps/backend/src/middleware/idempotency.middleware.ts` — Request idempotency guard
- **FILE-011**: `packages/db/src/scripts/backfill-ledger-entries.ts` — Data migration script

### Modified Backend Files
- **FILE-012**: `packages/db/prisma/schema.prisma` — Add `PaymentSession`, `LedgerEntry` models; add 4 new enums; add fields to `Booking`, `BranchChargeConfig`
- **FILE-013**: `apps/backend/src/controller/employee/pickup.controller.ts` — Wire session creation at pickup initiation
- **FILE-014**: `apps/backend/src/controller/employee/extension.controller.ts` — Replace immediate payment with EXTENSION ledger entry
- **FILE-015**: `apps/backend/src/routes/employee/employee.routes.ts` — Mount new route files

### New Frontend Files
- **FILE-016**: `apps/frontend/src/services/paymentSession.service.ts` — Session API client
- **FILE-017**: `apps/frontend/src/store/paymentSession.store.ts` — Zustand session store with localStorage persistence
- **FILE-018**: `apps/frontend/src/components/payment/LedgerSummaryCard.tsx` — Reusable ledger display component
- **FILE-019**: `apps/frontend/src/components/payment/RecordPaymentPanel.tsx` — Unified payment/refund action component

### Modified Frontend Files
- **FILE-020**: `apps/frontend/src/pages/employee/StaffPickupsPage.tsx` — Session-based pickup payment flow
- **FILE-021**: `apps/frontend/src/pages/employee/ReturnProcessPage.tsx` — Session-based return settlement
- **FILE-022**: `apps/frontend/src/services/booking.service.ts` — Add session localStorage helpers

---

## 6. Testing

- **TEST-001**: Unit test `LedgerService.recomputeTotals`: given a set of TAXABLE, NON_TAXABLE, DISCOUNT, PAYMENT entries, assert `netPayable` equals expected amount. Test positive (owed) and negative (refund) outcomes.
- **TEST-002**: Unit test `LedgerService.addEntry` idempotency: calling with the same `idempotencyKey` twice must throw `ConflictError` on the second call without creating a duplicate entry.
- **TEST-003**: Unit test `LedgerService.validateSessionAmount`: assert returns `valid=false` when expected amount differs by more than 1 rupee from computed total.
- **TEST-004**: Integration test `PaymentSessionService.createSession → addEntry × N → recomputeTotals → validateSessionAmount → recordPayment (CASH)`: full happy path for a PICKUP session. Assert `session.status=COMPLETED`, `PaymentTransaction` created, `Booking.status=PICKED_UP`.
- **TEST-005**: Integration test extension commit with session: add EXTENSION entry, add DEPOSIT entry, call record-payment. Assert `BookingExtension.status=CONFIRMED`, `Booking.endAt` updated, both ledger entries present.
- **TEST-006**: Integration test return session with refund: charges (EXTRA_KM + FUEL) total < safety deposit. Assert `netPayable < 0`, `record-refund` endpoint creates REFUND entry, `Booking.status=RETURNED`.
- **TEST-007**: Test idempotency middleware: POST `record-payment` with same `X-Idempotency-Key` twice. Assert second call returns cached response without creating a second `PAYMENT` entry.
- **TEST-008**: Test session restoration: create session, call `persistToRedis`, flush DB entry from memory, call `GET /sessions/{publicId}`. Assert full entry list and totals match original.
- **TEST-009**: Test `usePaymentSessions=false` branch: call old pickup endpoint on a branch with the flag disabled. Assert old flow executes (PaymentTransaction created directly, no PaymentSession row created).
- **TEST-010**: Test online payment gateway retry safety: initiate online payment, simulate gateway timeout (no response), retry with same idempotency key. Assert only one `PAYMENT` entry exists, gateway called only once (via idempotency middleware).
- **TEST-011**: Test safety deposit — employee adds deposit without manager approval: POST `add-deposit`, assert `LedgerEntry(DEPOSIT)` created, `SafetyDepositRequest.status=APPROVED`, no approval workflow triggered.
- **TEST-012**: Frontend unit test `paymentSession.store`: dispatch `addEntry`, assert `localStorage` key `vrms_session_{bookingId}` updated with new entry in serialized form.

---

## 7. Risks & Assumptions

- **RISK-001**: **Concurrent session mutations** — two parallel API calls for the same session could cause stale-read totals. Mitigation: use Prisma's optimistic concurrency (add `version Int @default(0)` to `PaymentSession` and check on update), or use `SELECT FOR UPDATE` inside transactions for `recomputeTotals`.
- **RISK-002**: **Backfill script data fidelity** — historical `PaymentTransaction` records may lack sufficient metadata to accurately map to ledger entry types. Mitigation: use `purpose` field for type mapping; mark all backfilled entries with `metadata.source='backfill'` for auditability.
- **RISK-003**: **Feature flag sprawl** — with `usePaymentSessions` added, two parallel code paths must be maintained indefinitely until all branches opt in. Mitigation: set a migration deadline (e.g., 90 days), after which all branches default to `usePaymentSessions=true`.
- **RISK-004**: **Redis cache staleness during session mutations** — if a mutation succeeds in DB but Redis write fails, the client may restore stale session state. Mitigation: client always calls `GET /api/employee/sessions/{publicId}` (DB-backed) on page load; Redis is cache, not primary.
- **RISK-005**: **PhonePe gateway timeout during verify-payment** — payment may have succeeded at gateway but DB update failed. Mitigation: `verify-payment` endpoint queries gateway status independently of DB state; if gateway shows SUCCESS but `LedgerEntry` PAYMENT entry is missing, it creates one with `metadata.recoveredFromGateway=true`.
- **RISK-006**: **Decimal precision** — mixing `Decimal` (Prisma) with JavaScript `number` in frontend can cause rounding errors in validation. Mitigation: all amounts passed as strings between frontend and backend; `parseFloat` only at display layer.
- **RISK-007**: **Session abandoned mid-flow** — employee closes browser mid-session. On next page load, restoration logic (TASK-064) detects the open session and asks employee to resume or abandon. Abandoned sessions are logged but no financial data is lost (entries remain in DB as voided or unconfirmed).
- **ASSUMPTION-001**: `ChargeEngineService.computeReturnCharges` already returns a structured breakdown with per-charge type, amount, and whether taxable. If not, a thin adapter layer may be needed in `ReturnSessionBuilder`.
- **ASSUMPTION-002**: The existing `BranchChargeConfig` always has a record per branch. New fields (`usePaymentSessions`, `safetyDepositRequiresApproval`) default to `false`, so no migration is needed to populate existing rows.
- **ASSUMPTION-003**: All employee sessions are single-device (no concurrent employee sessions for the same booking from different devices). Multi-device concurrency is not a design goal in this plan.
- **ASSUMPTION-004**: GST rates (`cgstRate`, `sgstRate`) are accessible from the branch GST rule cache in `LedgerService.buildTaxableEntry` via the existing Redis-cached `gst:rule:{branchId}` key.

---

## 8. Related Specifications / Further Reading

- [Current Pricing Engine — `apps/backend/src/services/pricing/pricing-engine.service.ts`]
- [Current Charge Engine — `apps/backend/src/services/charges/charge-engine.service.ts`]
- [Discount Evaluation Engine — `apps/backend/src/services/discount/discount-evaluation-engine.service.ts`]
- [Prisma Schema — `packages/db/prisma/schema.prisma`]
- [Existing Payment Confirmation — `apps/backend/src/controller/payment/checkPayment.controller.ts`]
- [PhonePe Payment Gateway Integration — existing gateway service]
- [ReturnProcessPage UI — `apps/frontend/src/pages/employee/ReturnProcessPage.tsx`]
- [StaffPickupsPage UI — `apps/frontend/src/pages/employee/StaffPickupsPage.tsx`]
- [PaymentTransaction Model — schema.prisma lines 1490–1544]
- [BookingExtension Model — schema.prisma lines 1617–1673]
