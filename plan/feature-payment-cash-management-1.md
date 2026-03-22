---
goal: Modular Cash & Payment Management System for VRMS
version: 1.0
date_created: 2026-03-22
last_updated: 2026-03-22
owner: Backend
status: 'In progress'
tags: [feature, payment, cash, reconciliation, audit, finance]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

This plan implements a modular, configurable, and audit-safe cash and payment management system for the Vehicle Rental Management Platform. The system supports both online and cash transactions with strict financial accountability, a two-actor confirmation model (employee collects → manager confirms), configurable cash control modes (simple vs. full-control), settlement engine for return scenarios, refund approval workflows, cash shift reconciliation, and fraud prevention mechanisms. All features are toggleable per branch via `BranchPaymentConfig`. The implementation integrates with the existing booking lifecycle, discount system, dual-audit pattern (AuditLog + StaffActivityLog), and existing middleware (AdminCheck, ManagerCheck).

---

## 1. Requirements & Constraints

- **REQ-001**: Every financial transaction must produce a `PaymentTransaction` record — no offline money movement without a system entry.
- **REQ-002**: Payment is mandatory before `PICKED_UP` transition. In strict mode (`blockProgressionUntilConfirmed=true`), cash must be CONFIRMED. In relaxed mode, COLLECTED is sufficient.
- **REQ-003**: Online payments (ONLINE_RAZORPAY, UPI) always transition INITIATED → CONFIRMED immediately with a transaction reference. No manager confirmation step for online.
- **REQ-004**: Cash payments in simple mode (`cashConfirmationEnabled=false`) also transition INITIATED → CONFIRMED immediately. No two-step flow.
- **REQ-005**: Cash payments in control mode (`cashConfirmationEnabled=true`) transition INITIATED → COLLECTED → CONFIRMED or REJECTED. Manager must physically verify and confirm.
- **REQ-006**: Split payments (cash + online) record both portions. The online portion confirms immediately; the cash portion follows the cash lifecycle.
- **REQ-007**: Refunds require mandatory reason. Cash refunds require manager approval (PENDING_APPROVAL → APPROVED → COMPLETED). Online refunds record immediately with transaction reference.
- **REQ-008**: `CashShift` tracks an employee's entire cash session. If `requireShiftSettlement=true`, employee cannot close shift with unconfirmed/unreconciled cash.
- **REQ-009**: Duplicate payment prevention: a booking cannot receive a second CONFIRMED/COLLECTED payment for the same `purpose` unless the previous one is FAILED or REJECTED.
- **REQ-010**: Excess payment prevention: total collected for a booking cannot exceed `totalFinal` (plus applicable extension/damage charges).
- **REQ-011**: All mutations must call both `auditService.log()` (AuditLog table) and `staffActivityService.log()` (StaffActivityLog table).
- **REQ-012**: All entities exposed to the frontend must have both `id` (Int, internal, DB joins only) and `publicId` (nanoid(21), external, URL params and API responses).
- **REQ-013**: Financial amounts use `Decimal.js` and are stored as `Decimal @db.Decimal(10,2)`.
- **REQ-014**: `PaymentTransaction` is append-only — no update or delete service methods. Status transitions occur via dedicated state-change methods only.
- **REQ-015**: The Financial State Engine must be queryable at any time to return: amountDue, collectedConfirmed, collectedPending, collectedBy, verifiedBy, currentLifecycleState.

- **SEC-001**: Only MANAGER or ADMIN roles may confirm cash payments, approve refunds, or close cash shifts.
- **SEC-002**: Only the collecting employee or a manager may view cash shift details.
- **SEC-003**: `maxCashPerEmployee` (from BranchPaymentConfig) is enforced server-side — no client bypass.
- **SEC-004**: Fraud alerts must be logged to AuditLog with severity WARNING or CRITICAL and must not be suppressible by client.

- **CON-001**: Must not duplicate existing fields on `Booking`: `isAdvancePayment`, `advanceAmount`, `advancePaidAt`, `advancePaymentId`, `advancePaymentMode`, `remainingBalance`, `remainingPaidAt`, `remainingPaymentId`, `remainingPaymentMode`, `remainingPaidDuring`, `safetyDeposit`, `safetyDepositPaidAt`, `safetyDepositMethod`. These remain as-is and are supplemented by `PaymentTransaction` records, not replaced.
- **CON-002**: Existing `DepositMethod` enum (ONLINE_RAZORPAY, CASH, UPI) must be extended, not replaced. New `PaymentMethod` enum includes SPLIT; DepositMethod remains for backward compatibility.
- **CON-003**: Existing `PaymentStatus` enum on Booking (CREATED, SUCCESS, FAILED, REFUNDED) must not be removed — it remains the booking-level summary status. `PaymentTransactionStatus` is the transaction-level granular state.
- **CON-004**: Existing `Invoice.payments: Payment[]` relation references a `Payment` model. New entity is named `PaymentTransaction` to avoid collision.
- **CON-005**: Must not modify existing `Deposit` model (used for safety deposits). New `PaymentTransaction` handles rental payment flows only.
- **CON-006**: All new Prisma models follow the existing pattern: `id Int @id @default(autoincrement())`, `publicId String @unique` (where exposed to frontend), `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt` (where mutable).

- **GUD-001**: Services must define explicit return type annotations on all async methods (no inferred Prisma types in `.d.ts`) — required by `declaration: true` + `noUncheckedIndexedAccess: true` in tsconfig.
- **GUD-002**: Use `Decimal.js` for all monetary arithmetic. Never use JavaScript native `number` for financial calculations.
- **GUD-003**: All service classes are instantiated as singletons and exported as `export const xyzService = new XyzService()`.
- **GUD-004**: All controllers import from `@repo/schemas` for Zod validation. Schema files live in `packages/schemas/src/`.
- **GUD-005**: Route files use barrel imports from controller files. Admin routes protected by `AdminCheck` middleware. Manager routes protected by `ManagerCheck` middleware.

- **PAT-001**: Two-actor model: employee-facing endpoints record collection; manager-facing endpoints record confirmation.
- **PAT-002**: Config-first evaluation: every service method must first load `BranchPaymentConfig` to determine operating mode before executing business logic.
- **PAT-003**: State machine enforcement: transitions are validated against allowed next-states; invalid transitions throw descriptive errors.
- **PAT-004**: Idempotency key on `PaymentTransaction.idempotencyKey` (nanoid, unique per attempt) prevents duplicate submissions from retried requests.

---

## 2. Implementation Steps

### Implementation Phase 1 — Schema & Migration

- GOAL-001: Define all new Prisma enums, models, and Booking extensions. Run migration.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `PaymentMethod` enum to `packages/db/prisma/schema.prisma`: values `CASH \| ONLINE \| SPLIT`. This is distinct from `DepositMethod` (which remains). | ✅ | 2026-03-22 |
| TASK-002 | Add `PaymentTransactionStatus` enum: values `INITIATED \| COLLECTED \| CONFIRMED \| FAILED \| REJECTED \| REFUNDED`. | ✅ | 2026-03-22 |
| TASK-003 | Add `PaymentPurpose` enum: values `ADVANCE \| REMAINING_BALANCE \| FULL_PAYMENT \| EXTENSION \| DAMAGE_FEE \| SAFETY_DEPOSIT \| OVERPAYMENT_REFUND \| CANCELLATION_REFUND`. | ✅ | 2026-03-22 |
| TASK-004 | Add `RefundStatus` enum: values `PENDING_APPROVAL \| APPROVED \| COMPLETED \| REJECTED`. | ✅ | 2026-03-22 |
| TASK-005 | Add `CashShiftStatus` enum: values `OPEN \| CLOSED \| DISCREPANCY_FLAGGED`. | ✅ | 2026-03-22 |
| TASK-006 | Extend `StaffEntityType` enum with: `PAYMENT_TRANSACTION`, `CASH_SHIFT`, `REFUND_REQUEST`. | ✅ | 2026-03-22 |
| TASK-007 | Extend `StaffActionType` enum with: `COLLECTED`, `RECONCILED`, `SETTLED`, `DISBURSED`. | ✅ | 2026-03-22 |
| TASK-008 | Add `BranchPaymentConfig` model. | ✅ | 2026-03-22 |
| TASK-009 | Add `PaymentTransaction` model. | ✅ | 2026-03-22 |
| TASK-010 | Add `RefundRequest` model. | ✅ | 2026-03-22 |
| TASK-011 | Add `CashShift` model. | ✅ | 2026-03-22 |
| TASK-012 | Add back-relations to `Booking`, `Branch`, and `User`. | ✅ | 2026-03-22 |
| TASK-013 | Run migration: `pnpm --filter @repo/db prisma migrate dev --name add_payment_cash_management`. | ✅ | 2026-03-22 |

### Implementation Phase 2 — Zod Validation Schemas

- GOAL-002: Create all Zod schemas in `packages/schemas/src/payment.schema.ts` and export from `packages/schemas/src/index.ts`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Create `packages/schemas/src/payment.schema.ts` with all payment Zod schemas. | ✅ | 2026-03-22 |
| TASK-015 | Add `confirmCashPaymentSchema` and `rejectCashPaymentSchema`. | ✅ | 2026-03-22 |
| TASK-016 | Add `createRefundRequestSchema`, `rejectRefundSchema`, `completeRefundSchema`. | ✅ | 2026-03-22 |
| TASK-017 | Add `closeCashShiftSchema`, `reconcileCashShiftSchema`. | ✅ | 2026-03-22 |
| TASK-018 | Add `updateBranchPaymentConfigSchema` and `updateBranchPaymentConfigAdminSchema`. | ✅ | 2026-03-22 |
| TASK-019 | Add `listPendingCashSchema`, `listPendingSettlementsSchema`, `listCashShiftsSchema`. | ✅ | 2026-03-22 |
| TASK-020 | Export `payment.schema.ts` from `packages/schemas/src/index.ts`. | ✅ | 2026-03-22 |

### Implementation Phase 3 — Core Payment Services

- GOAL-003: Implement all payment service files in `apps/backend/src/services/payment/`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | Create `apps/backend/src/services/payment/branch-payment-config.service.ts`. | ✅ | 2026-03-22 |
| TASK-022 | Create `apps/backend/src/services/payment/financial-state.service.ts`. | ✅ | 2026-03-22 |
| TASK-023 | Create `apps/backend/src/services/payment/payment-transaction.service.ts`. | ✅ | 2026-03-22 |
| TASK-024 | Create `apps/backend/src/services/payment/settlement-engine.service.ts`. | ✅ | 2026-03-22 |
| TASK-025 | Create `apps/backend/src/services/payment/refund.service.ts`. | ✅ | 2026-03-22 |
| TASK-026 | Create `apps/backend/src/services/payment/cash-shift.service.ts`. | ✅ | 2026-03-22 |
| TASK-027 | Create `apps/backend/src/services/payment/fraud-detection.service.ts`. | ✅ | 2026-03-22 |
| TASK-028 | Create `apps/backend/src/services/payment/index.ts` barrel export. | ✅ | 2026-03-22 |

### Implementation Phase 4 — Controllers

- GOAL-004: Implement all controllers for admin and branch-manager payment endpoints.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | Create `apps/backend/src/controller/admin/payment-config.controller.ts`. | ✅ | 2026-03-22 |
| TASK-030 | Create `apps/backend/src/controller/branchManager/payment-config.controller.ts`. | ✅ | 2026-03-22 |
| TASK-031 | Create `apps/backend/src/controller/branchManager/payment-transaction.controller.ts`. | ✅ | 2026-03-22 |
| TASK-032 | Create `apps/backend/src/controller/branchManager/cash-confirmation.controller.ts`. | ✅ | 2026-03-22 |
| TASK-033 | Create `apps/backend/src/controller/branchManager/settlement.controller.ts`. | ✅ | 2026-03-22 |
| TASK-034 | Create `apps/backend/src/controller/branchManager/refund.controller.ts`. | ✅ | 2026-03-22 |
| TASK-035 | Create `apps/backend/src/controller/branchManager/cash-shift.controller.ts`. | ✅ | 2026-03-22 |

### Implementation Phase 5 — Routes

- GOAL-005: Register all payment routes with correct middleware.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-036 | Create `apps/backend/src/routes/admin/payment.routes.ts`. | ✅ | 2026-03-22 |
| TASK-037 | Create `apps/backend/src/routes/branchManger/payment.routes.ts` with all 24 routes. | ✅ | 2026-03-22 |
| TASK-038 | Register payment routes in `branchManager.routes.ts` and `admin.routes.ts`. | ✅ | 2026-03-22 |

### Implementation Phase 6 — Booking Lifecycle Integration

- GOAL-006: Enforce payment gate before PICKED_UP transition and integrate discount→payment flow.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-039 | Add payment gate check in `ConfirmPickupWithDeposit` in `bookings.controller.ts`: call `financialStateService.getState()` and `branchPaymentConfigService.getConfig()`. Return 402 if financial state is not satisfied. | ✅ | 2026-03-22 |
| TASK-040 | Add payment gate check in the CONFIRMED status transition (booking confirmation after HOLD) for advance payment verification. | | |
| TASK-041 | Ensure `financialStateService.getState()` reads from `Booking.totalFinal` as the authoritative total-due figure when discount is applied. | | |
| TASK-042 | Create `apps/backend/src/jobs/delayedCashAlert.worker.ts` — hourly interval-based check calling `fraudDetectionService.checkDelayedCash()` for all branches. Register in `index.ts`. | ✅ | 2026-03-22 |

### Implementation Phase 7 — UI Flow Reference Documentation

- GOAL-007: Write the reference UI flow document (backend developer reference only — no frontend code).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-043 | Create `plan/ui-payment-cash-management-flows.md` — full UI/UX flow reference for all 7 flows, state badge tables, API quick reference. | ✅ | 2026-03-22 |

---

## 3. Alternatives

- **ALT-001**: Reuse the existing `Payment` model (referenced by `Invoice.payments: Payment[]`) instead of creating `PaymentTransaction`. Rejected — the existing `Payment` model is tied to the invoice flow and uses different semantics. Creating `PaymentTransaction` avoids coupling and allows independent evolution.
- **ALT-002**: Extend `DepositMethod` enum with SPLIT instead of creating a new `PaymentMethod` enum. Rejected — `DepositMethod` is used across many existing fields on `Booking` and `Deposit`. Adding SPLIT would break existing simple-type assumptions and require schema-wide migration.
- **ALT-003**: Store cash shift cash total by querying PaymentTransactions at runtime. Rejected — denormalized `expectedTotal` and `actualTotal` on `CashShift` are necessary for auditability and performance on the reconciliation dashboard.
- **ALT-004**: Single `status` field on `Booking` to track payment state. Rejected — `Booking.paymentStatus` already exists as a summary field. Granular state lives on `PaymentTransaction` to support multiple partial payments per booking.
- **ALT-005**: Use existing `Deposit` model for rental payments. Rejected — `Deposit` is semantically and structurally for safety deposits only. Rental payments have different purposes, amounts, and lifecycle states.

---

## 4. Dependencies

- **DEP-001**: `@repo/database/client` — Prisma client with new models. Must run migration (TASK-013) before any service implementation.
- **DEP-002**: `@repo/schemas` — Zod validation schemas from Phase 2 must be built before controllers can import them.
- **DEP-003**: `decimal.js` — already installed; used for all monetary calculations.
- **DEP-004**: `nanoid` — already installed via `createID()` util; used for `publicId` and `idempotencyKey`.
- **DEP-005**: Existing `auditService` (`apps/backend/src/services/audit/audit.service.ts`) — imported by all payment services.
- **DEP-006**: Existing `staffActivityService` (`apps/backend/src/services/staffActivity/staffActivity.service.ts`) — imported by all payment services.
- **DEP-007**: Existing `ManagerCheck` middleware (`apps/backend/src/middlewares/managerCheck.middlewares.ts`) — applied to all branch manager payment routes.
- **DEP-008**: Existing `AdminCheck` middleware (`apps/backend/src/middlewares/adminCheck.middleware.ts`) — applied to all admin payment routes.
- **DEP-009**: BullMQ + Redis — already installed; required for TASK-042 delayed cash alert job.

---

## 5. Files

**New Files:**
- **FILE-001**: `packages/db/prisma/schema.prisma` — add 5 new enums, 3 new models, back-relations to Booking/Branch/User.
- **FILE-002**: `packages/schemas/src/payment.schema.ts` — all Zod schemas for payment system.
- **FILE-003**: `apps/backend/src/services/payment/branch-payment-config.service.ts`
- **FILE-004**: `apps/backend/src/services/payment/financial-state.service.ts`
- **FILE-005**: `apps/backend/src/services/payment/payment-transaction.service.ts`
- **FILE-006**: `apps/backend/src/services/payment/settlement-engine.service.ts`
- **FILE-007**: `apps/backend/src/services/payment/refund.service.ts`
- **FILE-008**: `apps/backend/src/services/payment/cash-shift.service.ts`
- **FILE-009**: `apps/backend/src/services/payment/fraud-detection.service.ts`
- **FILE-010**: `apps/backend/src/services/payment/index.ts`
- **FILE-011**: `apps/backend/src/controller/admin/payment-config.controller.ts`
- **FILE-012**: `apps/backend/src/controller/branchManager/payment-config.controller.ts`
- **FILE-013**: `apps/backend/src/controller/branchManager/payment-transaction.controller.ts`
- **FILE-014**: `apps/backend/src/controller/branchManager/cash-confirmation.controller.ts`
- **FILE-015**: `apps/backend/src/controller/branchManager/settlement.controller.ts`
- **FILE-016**: `apps/backend/src/controller/branchManager/refund.controller.ts`
- **FILE-017**: `apps/backend/src/controller/branchManager/cash-shift.controller.ts`
- **FILE-018**: `apps/backend/src/routes/admin/payment.routes.ts`
- **FILE-019**: `apps/backend/src/routes/branchManger/payment.routes.ts`
- **FILE-020**: `apps/backend/src/jobs/payment/delayed-cash-alert.job.ts`
- **FILE-021**: `apps/backend/docs/payment-ui-flow-reference.md`

**Modified Files:**
- **FILE-022**: `packages/schemas/src/index.ts` — add export for payment.schema.js.
- **FILE-023**: `apps/backend/src/controller/branchManager/bookings.controller.ts` — add payment gate checks in status transition handlers (TASK-039, TASK-040).
- **FILE-024**: `apps/backend/src/routes/branchManger/branchManager.routes.ts` (or main app file) — register new route files.
- **FILE-025**: `apps/backend/src/routes/admin/admin.routes.ts` — register new admin payment route.

---

## 6. Testing

- **TEST-001**: Unit test `financialStateService.getState()` — seed booking with mixed CONFIRMED/COLLECTED/FAILED transactions, assert `amountDue`, `lifecycleState`, and totals are computed correctly.
- **TEST-002**: Integration test `paymentTransactionService.record()` in simple mode — assert status transitions directly to CONFIRMED for cash.
- **TEST-003**: Integration test `paymentTransactionService.record()` in cash-control mode — assert status is COLLECTED, confirm it goes to CONFIRMED after `confirmCash()`.
- **TEST-004**: Test duplicate idempotency key — second request with same key must throw or return existing transaction without creating a duplicate.
- **TEST-005**: Test excess payment prevention — attempt to record payment exceeding `booking.totalFinal`, assert 400 error.
- **TEST-006**: Test employee cash limit — set `maxCashPerEmployee=1000`, record 900, assert next 200 throws, next 100 succeeds.
- **TEST-007**: Test pickup gate — booking in HOLD, no confirmed payment, assert PICKED_UP transition throws 402 in strict mode, succeeds in relaxed mode.
- **TEST-008**: Test refund workflow — request refund → assert PENDING_APPROVAL → approve → assert APPROVED → complete → assert COMPLETED. Total refundable must not exceed collected.
- **TEST-009**: Test cash shift open/close — open shift, record cash payments, close with matching actualTotal, assert CLOSED status and zero discrepancy.
- **TEST-010**: Test cash shift discrepancy — close with mismatched actualTotal, assert DISCREPANCY_FLAGGED, assert reconcile requires explanation.
- **TEST-011**: Test split payment — record SPLIT method with cashAmount+onlineAmount=totalAmount, assert online portion CONFIRMED immediately and cash portion COLLECTED.
- **TEST-012**: Test `settlementEngineService.calculateSettlement()` — booking with advance paid, damage charges approved, assert netPayable = remainingBalance + damageCost.

---

## 7. Risks & Assumptions

- **RISK-001**: The existing `Payment` model (referenced by `Invoice.payments: Payment[]`) is not documented in the schema output. If it has overlapping fields with `PaymentTransaction`, naming conflicts or confusion may arise. Mitigation: name the new entity `PaymentTransaction` throughout and document the distinction clearly.
- **RISK-002**: Existing `Booking` fields (`remainingBalance`, `advanceAmount`, etc.) may become stale if `PaymentTransaction` records are the authoritative source. Mitigation: `financialStateService` computes from `PaymentTransaction` records; existing Booking fields are treated as snapshot metadata only and updated after each confirmed payment.
- **RISK-003**: BullMQ Redis dependency — if Redis is unavailable, the delayed cash alert job will not run. Mitigation: the core payment flow is not dependent on BullMQ; only the proactive alert is.
- **RISK-004**: Race condition in idempotency check (two simultaneous requests with the same key). Mitigation: `idempotencyKey String @unique` enforced at DB level; Prisma will throw P2002 on collision, which should be caught and returned as 409.

- **ASSUMPTION-001**: The existing booking pickup/confirmation transition logic is in `apps/backend/src/controller/branchManager/bookings.controller.ts` and can be modified without breaking other flows.
- **ASSUMPTION-002**: `req.branch_Id` (number) and `req.public_Id` (string, user publicId) are available on all manager-route requests after `ManagerCheck` middleware runs.
- **ASSUMPTION-003**: BullMQ worker initialization exists in the project and new jobs can be registered by adding them to the existing worker registration file.
- **ASSUMPTION-004**: `branchPaymentConfigService.getConfig()` returns safe defaults (all flags false, no limits) when no config row exists for the branch, so branches without explicit config operate in simple mode automatically.

---

## 8. Related Specifications / Further Reading

- [Discount System Plan](./feature-discount-system-1.md) — DiscountApplication.finalAmount is the authoritative total-due figure consumed by the payment system.
- [Staff Activity Log Plan](./feature-staff-activity-log-1.md) — StaffActivityLog pattern followed by all payment service mutations.
- [Audit Log Plan](./feature-audit-logs-enhanced-1.md) — AuditLog pattern followed by all payment service mutations.
- Prisma Decimal type docs: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-decimal
- Razorpay refund API (for online refund references): internal integration assumed already present.
