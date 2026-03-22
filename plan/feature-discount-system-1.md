---
goal: Rule-Driven, Auditable Discount System for VRMS — Coupons, Duration Slabs, Manual Overrides, and Evaluation Engine
version: 1.0
date_created: 2026-03-22
last_updated: 2026-03-22
owner: Backend Team
status: 'In progress'
tags: [feature, discount, coupon, pricing, backend, database, audit, analytics]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

VRMS currently supports only multiplier-based multi-day discount slabs (`PricingDiscountSlab`) applied silently inside the pricing engine. There is no coupon system, no manual override mechanism, no per-booking discount audit trail, and no branch-level control over discount behaviour. This plan designs and implements a **complete, production-grade discount system** that is rule-driven, fully auditable, and deeply integrated with the existing booking, pricing, payment, and audit infrastructure.

The system is structured around five core layers:

1. **Rule Definition** — `DiscountRule` (coupons/promos), `DurationDiscountSlab` (rental-length-based slabs), `BranchDiscountConfig` (branch-level settings)
2. **Evaluation Engine** — `DiscountEvaluationEngine` (centralized orchestration with strict ordering: Base → Duration → Coupon/Manual → GST)
3. **Application Tracking** — `DiscountApplication` (immutable per-booking record), `CouponUsageLog` (per-use limit enforcement)
4. **Manual Overrides** — `ManualDiscount` (manager-issued overrides with mandatory reason, optional approval, full audit)
5. **Analytics & Guardrails** — Anomaly detection, per-employee limits, branch-level reporting

The plan integrates with the **existing** `PricingEngineService`, `AdvanceDepositService`, `AuditService`, `StaffActivityService`, and the Prisma schema in `packages/db/prisma/schema.prisma`.

---

## 1. Requirements & Constraints

### Functional Requirements
- **REQ-001**: A `DiscountRule` entity must define all coupon configurations including type (PERCENTAGE or FLAT), value, max discount cap, scope (GLOBAL, BRANCH, USER), applicable branches, validity dates, and activation flag.
- **REQ-002**: Customer eligibility rules must be configurable: new customers only, minimum/maximum booking count, or specific customer targeting by customer ID array.
- **REQ-003**: Booking constraints must be configurable per rule: minimum/maximum booking amount, vehicle category whitelist, minimum/maximum rental duration (days), pickup/drop location filters.
- **REQ-004**: Payment plan constraints must be configurable: applicable payment plans (FULL, ADVANCE, BOTH), whether partial payment is allowed post-discount, minimum advance amount after discount.
- **REQ-005**: Usage limits must be configurable at four levels: total uses, per-user uses, per-branch uses, per-day uses.
- **REQ-006**: Stacking rules and priority must be configurable per discount rule (allow stacking with duration discounts, coupon priority integer).
- **REQ-007**: A `DurationDiscountSlab` must replace and extend the existing `PricingDiscountSlab`, adding discountType (PERCENTAGE or FLAT), branchId (required), and explicit enable/disable flag at branch level.
- **REQ-008**: A `BranchDiscountConfig` entity must allow each branch to enable/disable duration discounts, configure whether duration discounts stack with coupons, and set a maximum combined discount percentage.
- **REQ-009**: The discount calculation order must be strictly enforced: **Base Amount → Duration Discount → Coupon/Manual Discount → GST Calculation**.
- **REQ-010**: A `DiscountApplication` record must be created for every booking that has any discount applied, capturing: originalAmount, durationDiscountAmount, durationDiscountPercent, couponDiscountAmount, couponDiscountPercent, manualDiscountAmount, finalAmount, paymentPlan, adjustmentType.
- **REQ-011**: A `CouponUsageLog` record must be created for every coupon redemption, capturing: discountRuleId, bookingId, customerId, branchId, discountedAmount, appliedAt.
- **REQ-012**: A `ManualDiscount` entity must support manager-issued overrides at booking or pickup time with mandatory reason, optional second-level approval for amounts exceeding a configured threshold, and full audit log entry.
- **REQ-013**: Coupon codes must support both manual entry and auto-generation with configurable patterns (branch prefix, employee-linked, promotional alphanumeric).
- **REQ-014**: The system must revalidate and recalculate discounts whenever booking parameters change (duration, vehicle type, payment plan).
- **REQ-015**: GST must always be calculated on the post-discount amount unless a rule explicitly marks `applyTaxBeforeDiscount: true`.
- **REQ-016**: If a discount causes the advance amount to exceed the final discounted total, the system must trigger a refund, wallet credit, or adjustment flow with `adjustmentType` set accordingly.
- **REQ-017**: Discounts must never be applied on partial/remaining amounts — always on the full base amount.
- **REQ-018**: Historical `DiscountApplication` and `CouponUsageLog` records must be immutable — no DELETE or UPDATE operations are permitted after creation.

### Security Requirements
- **SEC-001**: Manual discounts exceeding a branch-configured threshold (e.g., ₹500 or 10%) must require second-level approval from a MANAGER or ADMIN.
- **SEC-002**: Per-employee daily manual discount limits must be enforced (configurable in `BranchDiscountConfig`).
- **SEC-003**: Cross-branch coupon misuse must be blocked — branch-scoped coupons must validate `booking.branchId` against `DiscountRule.applicableBranchIds`.
- **SEC-004**: Repeated discount usage by the same customer within a configurable window must trigger an anomaly flag logged to `AuditLog` with severity CRITICAL.
- **SEC-005**: All coupon codes must be unique at the database level (`@unique` constraint on `DiscountRule.code`).
- **SEC-006**: Discount rule mutations (create, update, deactivate) must be restricted to ADMIN and MANAGER roles.
- **SEC-007**: `CouponUsageLog` and `DiscountApplication` tables must be append-only — no update/delete routes or service methods must exist for these tables.

### Constraints
- **CON-001**: The existing `PricingDiscountSlab` model must be migrated to the new `DurationDiscountSlab` model. The old model must be removed from the schema after migration.
- **CON-002**: `PricingEngineService` must remain the single entry point for all pricing calculations — the discount engine must be invoked from within it, not bypass it.
- **CON-003**: GST calculation logic in `PricingEngineService` must not be duplicated — it must remain in one place and receive the post-discount base as input.
- **CON-004**: The Prisma schema is in `packages/db/prisma/schema.prisma`. All new models must be added there and migrated via `prisma migrate dev`.
- **CON-005**: All monetary values must use `Decimal` type (Prisma `Decimal` / `Decimal.js` in application code) to prevent floating-point errors.
- **CON-006**: Discount application must not block booking creation — validation failures must return structured error responses, not throw unhandled exceptions.
- **CON-007**: The system must be backward-compatible: bookings without any discount must continue to work with zero discount fields.

### Guidelines
- **GUD-001**: Follow the existing service pattern: one class per service file, constructor-injected Prisma client, no static methods.
- **GUD-002**: All new Zod validation schemas must be placed in `packages/schemas/src/` and exported from the package index.
- **GUD-003**: All new routes must follow the existing role-based controller directory structure (`admin/`, `branchManager/`, `staff/`, `public/`).
- **GUD-004**: Extend `AuditCategory` enum with `DISCOUNT` and `StaffEntityType` enum with `DISCOUNT_RULE`, `DISCOUNT_APPLICATION`, `MANUAL_DISCOUNT`.
- **GUD-005**: Every service method that mutates discount state must emit both an `AuditLog` entry and a `StaffActivityLog` entry.
- **GUD-006**: Duration discount slabs must be sorted and matched server-side — never trust client-sent slab index.

### Patterns to Follow
- **PAT-001**: Follow the `VehicleSwapService` pattern for validation-first, then mutation, then dual audit logging.
- **PAT-002**: Follow the `DamageChargeService` pattern for tax-aware financial calculations (apply tax on post-discount amount).
- **PAT-003**: Follow the `FeatureFlagService` pattern for branch-level feature enable/disable (`BranchDiscountConfig.durationDiscountEnabled`).
- **PAT-004**: Follow the existing `PricingDiscountSlab` query pattern (find highest matching slab) for `DurationDiscountSlab` matching logic.

---

## 2. Implementation Steps

### Implementation Phase 1 — Database Schema Design & Migration

- GOAL-001: Add all new Prisma models, extend existing models, create migration, and seed initial `BranchDiscountConfig` rows for all existing branches.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `DiscountScope` enum to `schema.prisma`: values `GLOBAL`, `BRANCH`, `USER` | ✅ | 2026-03-22 |
| TASK-002 | Add `DiscountType` enum to `schema.prisma`: values `PERCENTAGE`, `FLAT` | ✅ | 2026-03-22 |
| TASK-003 | Add `AdjustmentType` enum to `schema.prisma`: values `NONE`, `PENDING_REFUND`, `REFUNDED`, `WALLET_CREDITED`, `CASH_HANDLED` | ✅ | 2026-03-22 |
| TASK-004 | Add `ManualDiscountStatus` enum to `schema.prisma`: values `PENDING_APPROVAL`, `APPROVED`, `REJECTED` | ✅ | 2026-03-22 |
| TASK-005 | Add `DiscountRule` model to `schema.prisma` with all fields as specified in Section 5 FILE-003 | ✅ | 2026-03-22 |
| TASK-006 | Add `DurationDiscountSlab` model to `schema.prisma` with fields: `id`, `branchId`, `minDays`, `maxDays`, `discountType: DiscountType`, `value: Decimal`, `label?`, `createdAt`, `updatedAt` | ✅ | 2026-03-22 |
| TASK-007 | Add `BranchDiscountConfig` model to `schema.prisma` with fields: `id`, `branchId` (unique), `durationDiscountEnabled: Boolean @default(false)`, `stackWithCoupon: Boolean @default(false)`, `maxCombinedDiscountPercent: Decimal?`, `managerApprovalThreshold: Decimal @default(500)`, `maxManualDiscountsPerEmployeePerDay: Int @default(5)`, `createdAt`, `updatedAt` | ✅ | 2026-03-22 |
| TASK-008 | Add `DiscountApplication` model to `schema.prisma` with all fields as specified in Section 5 FILE-005 | ✅ | 2026-03-22 |
| TASK-009 | Add `CouponUsageLog` model to `schema.prisma` with fields: `id`, `discountRuleId`, `bookingId`, `customerId`, `branchId`, `discountedAmount: Decimal`, `appliedAt: DateTime @default(now())` — with index on `[discountRuleId, customerId]` and `[discountRuleId, branchId, appliedAt]` | ✅ | 2026-03-22 |
| TASK-010 | Add `ManualDiscount` model to `schema.prisma` with fields: `id`, `publicId`, `bookingId` (unique), `amount: Decimal`, `reason: String`, `issuedById`, `approvedById?`, `status: ManualDiscountStatus @default(PENDING_APPROVAL)`, `requiresApproval: Boolean`, `approvedAt?`, `rejectedAt?`, `rejectionReason?`, `createdAt`, `updatedAt` | ✅ | 2026-03-22 |
| TASK-011 | Extend `Booking` model: add `couponCode: String?`, `discountRuleId: Int?` as nullable fields with relations. Back-relations `discountApplication` and `manualDiscount` via `@unique` FK on child tables. | ✅ | 2026-03-22 |
| TASK-012 | Extend `AuditCategory` enum: add `DISCOUNT` value | ✅ | 2026-03-22 |
| TASK-013 | Extend `StaffEntityType` enum: add `DISCOUNT_RULE`, `DISCOUNT_APPLICATION`, `MANUAL_DISCOUNT` values | ✅ | 2026-03-22 |
| TASK-014 | Extend `StaffActionType` enum: add `APPLIED`, `OVERRIDDEN`, `RECALCULATED`, `FLAGGED` values | ✅ | 2026-03-22 |
| TASK-015 | `PricingDiscountSlab` left in schema — migration to `DurationDiscountSlab` deferred to Phase 7 | | |
| TASK-016 | Run `pnpm --filter @repo/db prisma migrate dev --name add_discount_system` — **manual step by developer** | | |
| TASK-017 | Write seed function in `packages/db/prisma/seed.ts` to create `BranchDiscountConfig` rows for all existing branches with `durationDiscountEnabled: false` | | |
| TASK-018 | Add DB-level indexes: included in all new model definitions via `@@index` attributes | ✅ | 2026-03-22 |

### Implementation Phase 2 — Core Service Layer

- GOAL-002: Implement all business logic services for discount rule management, coupon code generation, duration slab evaluation, coupon validation, and the centralized discount evaluation engine.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Create `apps/backend/src/services/discount/discount-rule.service.ts` | ✅ | 2026-03-22 |
| TASK-020 | Create `apps/backend/src/services/discount/coupon-code-generator.service.ts` | ✅ | 2026-03-22 |
| TASK-021 | Create `apps/backend/src/services/discount/duration-discount.service.ts` | ✅ | 2026-03-22 |
| TASK-022 | Create `apps/backend/src/services/discount/coupon-validation.service.ts` — 10-layer validation | ✅ | 2026-03-22 |
| TASK-023 | Create `apps/backend/src/services/discount/discount-calculation.service.ts` | ✅ | 2026-03-22 |
| TASK-024 | Create `apps/backend/src/services/discount/discount-evaluation-engine.service.ts` — centralized orchestrator with strict ordering and stacking enforcement | ✅ | 2026-03-22 |
| TASK-025 | Create `apps/backend/src/services/discount/discount-application.service.ts` — immutable record + coupon usage log | ✅ | 2026-03-22 |
| TASK-026 | Create `apps/backend/src/services/discount/manual-discount.service.ts` — issue/approve/reject with daily limits | ✅ | 2026-03-22 |
| TASK-027 | Create `apps/backend/src/services/discount/discount-analytics.service.ts` — deferred to future iteration | | |
| TASK-028 | Create `apps/backend/src/services/discount/index.ts` barrel export | ✅ | 2026-03-22 |

### Implementation Phase 3 — Pricing Engine Integration

- GOAL-003: Integrate the discount evaluation engine into the existing `PricingEngineService`, migrate the `PricingDiscountSlab` logic to use `DurationDiscountService`, and ensure the strict calculation order is enforced.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | Read existing `PricingEngineService` — identified `applyDiscountSlabs()` using `PricingDiscountSlab` | ✅ | 2026-03-22 |
| TASK-030 | `PricingEngineService` is a class — `DiscountEvaluationEngine` imported directly (no DI container) | ✅ | 2026-03-22 |
| TASK-031 | Replaced `applyDiscountSlabs()` with `discountEvaluationEngine.evaluate()` call | ✅ | 2026-03-22 |
| TASK-032 | Added `couponCode?`, `manualDiscountAmount?`, `manualDiscountId?` params to `calculateBookingPrice()` | ✅ | 2026-03-22 |
| TASK-033 | Updated `PricingResult` interface with all discount breakdown fields | ✅ | 2026-03-22 |
| TASK-034 | GST now calculated on `postDiscountBase` (= `discountEvaluation.finalAmount`) | ✅ | 2026-03-22 |
| TASK-035 | `pricingSnapshot` updated in `booking-discount.controller.ts` when coupon applied | ✅ | 2026-03-22 |
| TASK-036 | Recalculation logic implemented inside `ApplyCoupon` controller using `calculateBookingPrice` | ✅ | 2026-03-22 |

### Implementation Phase 4 — Booking Flow Integration

- GOAL-004: Integrate discount application into the booking creation, confirmation, and pickup flows. Handle coupon revalidation on parameter changes and post-booking discount scenarios.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-037 | Locate booking creation controller/service (likely `apps/backend/src/controller/booking/` or `apps/backend/src/services/booking/`). Add `couponCode?: string` to the booking creation request schema in `packages/schemas/src/`. | | |
| TASK-038 | In the booking creation flow, after pricing calculation: if `couponCode` is provided, call `DiscountEvaluationEngine.evaluate()`. On validation failure, return structured error `{ code: 'COUPON_INVALID', reason: string }` — do NOT block booking creation, just clear the coupon. | | |
| TASK-039 | After successful booking creation with a discount, call `DiscountApplicationService.recordApplication()` to persist the `DiscountApplication` row. Update `Booking.discountRuleId` and `Booking.discountApplicationId`. | | |
| TASK-040 | In `AdvanceDepositService.recordAdvancePayment()`, after recording advance: check `DiscountApplication.adjustmentType`. If `advancePaidAmount > finalAmount`, set `adjustmentType: PENDING_REFUND` and log `AuditLog` with severity WARNING and action `ADVANCE_EXCEEDS_DISCOUNTED_TOTAL`. | | |
| TASK-041 | Add payment plan revalidation: when a booking's payment plan changes (FULL ↔ ADVANCE), call `CouponValidationService.validateCoupon()` with new payment plan. If coupon is no longer valid for new plan, return error requiring explicit re-confirmation or coupon removal. | | |
| TASK-042 | Add a `POST /api/branchManager/bookings/:publicId/apply-coupon` endpoint that accepts `{ couponCode }`, calls `PricingEngineService.recalculateWithDiscount()`, and returns updated pricing. Restricted to MANAGER and STAFF roles. | | |
| TASK-043 | Add a `POST /api/branchManager/bookings/:publicId/apply-manual-discount` endpoint that accepts `{ amount, reason }`, calls `ManualDiscountService.issueManualDiscount()`, then `PricingEngineService.recalculateWithDiscount()`. Restricted to MANAGER role. | | |
| TASK-044 | Add a `POST /api/admin/manual-discounts/:id/approve` and `/:id/reject` endpoints for second-level approval of high-value manual discounts. Restricted to ADMIN role. | | |
| TASK-045 | Handle post-invoice discount application: if booking has status `RETURNED` and an invoice exists in `FINALIZED` state, block `apply-coupon` endpoint and return error `{ code: 'DISCOUNT_POST_INVOICE_BLOCKED' }`. Only allow if `DiscountRule.allowPostInvoice: true` and caller is ADMIN. | | |

### Implementation Phase 5 — Discount Rule Management API

- GOAL-005: Build the admin and branch-manager-facing APIs for managing discount rules, duration slabs, branch config, and coupon code generation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-046 | Create `apps/backend/src/controller/admin/discount-rule.controller.ts` — List, Get, Create, Update, Deactivate | ✅ | 2026-03-22 |
| TASK-047 | `GenerateCouponCode` merged into discount-rule.controller.ts | ✅ | 2026-03-22 |
| TASK-048 | Create `apps/backend/src/controller/branchManager/discount-slabs.controller.ts` | ✅ | 2026-03-22 |
| TASK-049 | Create `apps/backend/src/controller/branchManager/discount-config.controller.ts` | ✅ | 2026-03-22 |
| TASK-050 | Create `packages/schemas/src/discount.schema.ts` — all Zod schemas, exported from index | ✅ | 2026-03-22 |
| TASK-051 | Registered `discountRouter` in `admin.routes.ts` (`/discount-rules`) and `branchManager.routes.ts` (`/discount`) | ✅ | 2026-03-22 |

### Implementation Phase 6 — Audit, Anomaly Detection & Analytics API

- GOAL-006: Fully instrument all discount operations with dual audit logging, implement anomaly detection, and expose analytics endpoints.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-052 | Update `apps/backend/src/services/audit/audit.service.ts` — add `DISCOUNT` to `AuditCategory` enum usage (enum is defined in Prisma schema — ensure it's re-generated after migration). | | |
| TASK-053 | Ensure `DiscountRuleService`, `ManualDiscountService`, `DiscountApplicationService` each call both `auditService.log()` (AuditLog) and `staffActivityService.log()` (StaffActivityLog) on every state-changing operation. Use `category: DISCOUNT`, entity: `'DiscountRule'` / `'ManualDiscount'` / `'DiscountApplication'`. | | |
| TASK-054 | In `DiscountAnalyticsService.detectAnomalies()`, implement three anomaly rules: (1) Customer used >3 coupons in 7 days → log CRITICAL AuditLog with action `ANOMALY_CUSTOMER_COUPON_ABUSE`, (2) Employee issued >daily-limit manual discounts → log CRITICAL AuditLog with action `ANOMALY_EMPLOYEE_DISCOUNT_LIMIT`, (3) Single coupon code used >50% of its total limit in 1 day → log CRITICAL AuditLog with action `ANOMALY_COUPON_SPIKE`. | | |
| TASK-055 | Schedule `DiscountAnalyticsService.detectAnomalies()` to run via BullMQ daily at midnight IST. Create job definition in `apps/backend/src/jobs/discount-anomaly.job.ts`. Register in existing BullMQ worker setup. | | |
| TASK-056 | Create `apps/backend/src/controller/admin/discount/discount-analytics.controller.ts` with routes: `GET /api/admin/discount/analytics/branch-summary` (query params: `branchId`, `from`, `to`), `GET /api/admin/discount/analytics/employee-activity` (query params: `branchId`, `from`, `to`), `GET /api/admin/discount/analytics/anomalies` (query params: `from`, `to`). Restricted to ADMIN. | | |
| TASK-057 | Create `apps/backend/src/controller/branchManager/discount/discount-analytics.controller.ts` with route: `GET /api/branchManager/discount/analytics` returning branch-scoped summary (current branch only, from `req.user.branchId`). Restricted to MANAGER. | | |

### Implementation Phase 7 — Data Migration & Cleanup

- GOAL-007: Migrate existing `PricingDiscountSlab` data to `DurationDiscountSlab`, validate all existing bookings remain unaffected, and remove the deprecated model.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-058 | Execute migration script `packages/db/migrations/migrate-discount-slabs.ts` in a database transaction: for each `PricingDiscountSlab` row, create a corresponding `DurationDiscountSlab` row with `discountType: PERCENTAGE`, `value: (1 - multiplier) * 100`, `minDays: 1`, `maxDays: 9999` (open-ended upper bound). | | |
| TASK-059 | Validate migration: run a query comparing counts of `PricingDiscountSlab` vs `DurationDiscountSlab` rows per branch. Log discrepancies. | | |
| TASK-060 | Remove `PricingDiscountSlab` model from `schema.prisma`. Run `prisma migrate dev --name remove_pricing_discount_slab`. | | |
| TASK-061 | Verify all existing bookings with `totalDiscount > 0` still render correctly on their invoices — the `pricingSnapshot` JSON is the source of truth for historical records, so no recalculation is needed. | | |
| TASK-062 | Seed `BranchDiscountConfig` rows for all existing branches with `durationDiscountEnabled: true` (migrated slabs should be active) and `stackWithCoupon: false` (conservative default). | | |

---

## 3. Alternatives

- **ALT-001**: **Extend `PricingDiscountSlab` directly** instead of creating a new `DurationDiscountSlab` model. Rejected because the existing model uses a multiplier (0.85 = 15% off) which is ambiguous and doesn't support FLAT discounts. A clean new model with explicit `discountType` and `value` fields is less error-prone.
- **ALT-002**: **Use a third-party discount/promotion engine** (e.g., Voucherify, Talon.One). Rejected because VRMS has highly domain-specific constraints (rental duration, vehicle category, branch scope, Indian GST, payment plans) that would require heavy customization of external tools, introducing vendor lock-in.
- **ALT-003**: **Store all discount config in a single JSON field on `Branch`**. Rejected because JSON fields cannot be indexed, enforced with foreign keys, or queried efficiently. Relational models with proper indexes are required for usage limit enforcement.
- **ALT-004**: **Apply discounts post-GST** (i.e., discount the final total including tax). Rejected because Indian GST regulations require GST to be calculated on the taxable value after legitimate trade discounts. The correct order is: discount first, tax second.
- **ALT-005**: **Allow coupon deletion** instead of deactivation. Rejected because `CouponUsageLog` entries reference `discountRuleId` by foreign key, and historical audit completeness requires the rule to remain in the database. Soft deactivation via `isActive: false` is the correct approach.
- **ALT-006**: **Implement stacking as first-come-first-served** (apply whatever discount the user presents). Rejected because uncontrolled stacking can lead to revenue leakage. Explicit `stackWithCoupon` flag in `BranchDiscountConfig` with `maxCombinedDiscountPercent` cap is the safe approach.

---

## 4. Dependencies

- **DEP-001**: `packages/db` — Prisma client and schema. All new models are added here. Must run `prisma migrate dev` and regenerate client before backend compilation.
- **DEP-002**: `packages/schemas` — Zod schemas package. New discount-related schemas must be added and exported here before controllers can use them.
- **DEP-003**: `Decimal.js` — Already a dependency via `prisma` and used in `PricingEngineService`. All monetary calculations must use `Decimal` instances.
- **DEP-004**: `BullMQ` + Redis — Already configured in the backend. Required for the anomaly detection cron job (TASK-055). Confirm queue name conventions from existing job definitions.
- **DEP-005**: `AuditService` (`apps/backend/src/services/audit/audit.service.ts`) — Must be injected into all discount services. No new audit infrastructure needed.
- **DEP-006**: `StaffActivityService` (`apps/backend/src/services/audit/staff-activity.service.ts`) — Must be injected alongside `AuditService`. Uses `StaffEntityType` enum which must be extended (TASK-013).
- **DEP-007**: `PricingEngineService` (`apps/backend/src/services/pricing/pricing-engine.service.ts`) — Must be modified to inject and invoke `DiscountEvaluationEngine`. No architectural changes beyond adding injection and replacing the slab query block.
- **DEP-008**: `AdvanceDepositService` (`apps/backend/src/services/booking/advance-deposit.service.ts`) — Must be modified to check `DiscountApplication.adjustmentType` after recording advance payment (TASK-040).
- **DEP-009**: `GSTRule` — Existing Prisma model. No changes needed. The GST calculation must continue to receive post-discount base from `PricingEngineService`.
- **DEP-010**: `crypto` (Node.js built-in) — Used in `CouponCodeGeneratorService` for cryptographically random code generation. No new package installation required.

---

## 5. Files

### New Files
- **FILE-001**: `packages/db/prisma/schema.prisma` — Add 6 new models (`DiscountRule`, `DurationDiscountSlab`, `BranchDiscountConfig`, `DiscountApplication`, `CouponUsageLog`, `ManualDiscount`), 4 new enums (`DiscountScope`, `DiscountType`, `AdjustmentType`, `ManualDiscountStatus`), extend `Booking` model, extend `AuditCategory`, `StaffEntityType`, `StaffActionType` enums.
- **FILE-002**: `packages/db/migrations/migrate-discount-slabs.ts` — One-time data migration script: `PricingDiscountSlab` → `DurationDiscountSlab`.
- **FILE-003**: `apps/backend/src/services/discount/discount-rule.service.ts` — CRUD for `DiscountRule` with audit logging.
- **FILE-004**: `apps/backend/src/services/discount/coupon-code-generator.service.ts` — Crypto-random code generation with uniqueness check.
- **FILE-005**: `apps/backend/src/services/discount/duration-discount.service.ts` — Slab-based duration discount evaluation.
- **FILE-006**: `apps/backend/src/services/discount/coupon-validation.service.ts` — 10-layer coupon validation.
- **FILE-007**: `apps/backend/src/services/discount/discount-calculation.service.ts` — Pure coupon discount math (PERCENTAGE / FLAT with cap).
- **FILE-008**: `apps/backend/src/services/discount/discount-evaluation-engine.service.ts` — Centralized orchestrator with strict ordering.
- **FILE-009**: `apps/backend/src/services/discount/discount-application.service.ts` — Immutable application recording.
- **FILE-010**: `apps/backend/src/services/discount/manual-discount.service.ts` — Manager override with approval flow.
- **FILE-011**: `apps/backend/src/services/discount/discount-analytics.service.ts` — Usage analytics and anomaly detection.
- **FILE-012**: `apps/backend/src/services/discount/index.ts` — Barrel export.
- **FILE-013**: `apps/backend/src/jobs/discount-anomaly.job.ts` — BullMQ job for nightly anomaly detection.
- **FILE-014**: `apps/backend/src/controller/admin/discount/discount-rule.controller.ts` — Admin discount rule CRUD endpoints.
- **FILE-015**: `apps/backend/src/controller/admin/discount/coupon-generate.controller.ts` — Admin coupon code generation endpoint.
- **FILE-016**: `apps/backend/src/controller/admin/discount/discount-analytics.controller.ts` — Admin analytics endpoints.
- **FILE-017**: `apps/backend/src/controller/branchManager/discount/duration-slabs.controller.ts` — Branch manager slab management endpoints.
- **FILE-018**: `apps/backend/src/controller/branchManager/discount/branch-config.controller.ts` — Branch discount config endpoints.
- **FILE-019**: `apps/backend/src/controller/branchManager/discount/discount-analytics.controller.ts` — Branch-scoped analytics endpoint.
- **FILE-020**: `packages/schemas/src/discount/discount-rule.schema.ts` — Zod schemas for discount rule creation/update.
- **FILE-021**: `packages/schemas/src/discount/duration-slab.schema.ts` — Zod schemas for slab management.
- **FILE-022**: `packages/schemas/src/discount/branch-config.schema.ts` — Zod schemas for branch config update.
- **FILE-023**: `packages/schemas/src/discount/apply-discount.schema.ts` — Zod schemas for applying coupon and manual discount.
- **FILE-024**: `packages/schemas/src/discount/index.ts` — Barrel export for discount schemas.

### Modified Files
- **FILE-025**: `apps/backend/src/services/pricing/pricing-engine.service.ts` — Inject `DiscountEvaluationEngine`, replace `PricingDiscountSlab` query, add `couponCode?` and `manualOverrideAmount?` params, update `PricingResult` interface.
- **FILE-026**: `apps/backend/src/services/booking/advance-deposit.service.ts` — Add overpayment check using `DiscountApplication.adjustmentType` after advance payment recording.
- **FILE-027**: `packages/db/prisma/schema.prisma` — Primary schema file (same as FILE-001, listed for clarity as a modified file).
- **FILE-028**: `packages/schemas/src/index.ts` — Add export for `packages/schemas/src/discount/index.ts`.
- **FILE-029**: `apps/backend/src/routes/adminRouter.ts` (or equivalent) — Register new admin discount routes.
- **FILE-030**: `apps/backend/src/routes/branchManagerRouter.ts` (or equivalent) — Register new branch manager discount routes.

### DiscountRule Model Schema (Reference)
```prisma
model DiscountRule {
  id                        Int            @id @default(autoincrement())
  publicId                  String         @unique @default(cuid())
  code                      String         @unique
  name                      String
  description               String?

  // Type & Value
  discountType              DiscountType
  value                     Decimal        @db.Decimal(10, 4)
  maxDiscountCap            Decimal?       @db.Decimal(10, 2)

  // Scope
  scope                     DiscountScope  @default(GLOBAL)
  applicableBranchIds       Int[]
  targetCustomerIds         Int[]

  // Customer eligibility
  newCustomersOnly          Boolean        @default(false)
  minBookingCount           Int?
  maxBookingCount           Int?

  // Booking constraints
  minBookingAmount          Decimal?       @db.Decimal(10, 2)
  maxBookingAmount          Decimal?       @db.Decimal(10, 2)
  applicableVehicleCategories Int[]
  minRentalDays             Int?
  maxRentalDays             Int?
  applicablePickupLocations String[]
  applicableDropLocations   String[]

  // Payment constraints
  applicablePaymentPlans    String[]       // ["FULL", "ADVANCE", "BOTH"]
  allowPartialPayment       Boolean        @default(true)
  minAdvanceAfterDiscount   Decimal?       @db.Decimal(10, 2)
  allowPostBooking          Boolean        @default(false)
  allowPostInvoice          Boolean        @default(false)

  // Usage limits
  totalUsageLimit           Int?
  perUserLimit              Int?
  perBranchLimit            Int?
  perDayLimit               Int?

  // Stacking & Priority
  stackable                 Boolean        @default(false)
  priority                  Int            @default(0)

  // Validity
  startDate                 DateTime
  endDate                   DateTime
  isActive                  Boolean        @default(true)

  // Relations
  usageLogs                 CouponUsageLog[]
  bookings                  Booking[]

  createdAt                 DateTime       @default(now())
  updatedAt                 DateTime       @updatedAt

  @@index([isActive, startDate, endDate])
  @@index([code])
}
```

---

## 6. Testing

- **TEST-001**: Unit test `DurationDiscountService.evaluateDurationDiscount()` — verify correct slab selection for edge cases: exact boundary match, booking days between two slabs, no matching slab, `durationDiscountEnabled: false`.
- **TEST-002**: Unit test `CouponValidationService.validateCoupon()` — test each of the 10 validation layers independently using mocked Prisma responses.
- **TEST-003**: Unit test `DiscountCalculationService.calculateCouponDiscount()` — verify PERCENTAGE and FLAT calculations, verify `maxDiscountCap` is enforced correctly, verify Decimal precision.
- **TEST-004**: Integration test `DiscountEvaluationEngine.evaluate()` — test full pipeline with real database: duration-only discount, coupon-only discount, stacked discounts, stacking blocked by branch config.
- **TEST-005**: Integration test booking creation with coupon — verify `DiscountApplication` row is created, `CouponUsageLog` row is created, `Booking.discountRuleId` is populated.
- **TEST-006**: Integration test coupon usage limits — create a coupon with `totalUsageLimit: 2`, apply it 3 times, verify the 3rd application fails with `{ code: 'COUPON_USAGE_LIMIT_EXCEEDED' }`.
- **TEST-007**: Integration test per-day coupon limit — apply coupon beyond `perDayLimit` in same UTC day, verify failure.
- **TEST-008**: Integration test manual discount threshold — issue manual discount above `BranchDiscountConfig.manualDiscountThreshold`, verify `requiresApproval: true` and `status: PENDING_APPROVAL`.
- **TEST-009**: Integration test overpayment detection — create booking with advance payment exceeding discounted total, verify `adjustmentType: PENDING_REFUND` and AuditLog entry with severity WARNING.
- **TEST-010**: Integration test payment plan revalidation — apply ADVANCE-only coupon, switch to FULL payment, verify coupon becomes invalid.
- **TEST-011**: Integration test GST calculation order — verify GST is computed on `baseAmount - durationDiscount - couponDiscount`, not on original `baseAmount`.
- **TEST-012**: Integration test cross-branch coupon misuse — create BRANCH-scoped coupon for Branch A, attempt to use in Branch B booking, verify failure with `{ code: 'COUPON_BRANCH_SCOPE_MISMATCH' }`.
- **TEST-013**: Test `CouponCodeGeneratorService` — verify generated codes are unique, match pattern format, and uniqueness check loops correctly on collision.
- **TEST-014**: Test anomaly detection thresholds — seed >3 coupon uses in 7 days for same customer, run `detectAnomalies()`, verify CRITICAL AuditLog is created.
- **TEST-015**: Test `DiscountApplication` immutability — attempt to call any UPDATE or DELETE on `DiscountApplication` table via service, verify no such method exists and any direct Prisma call is rejected by DB constraints (append-only enforcement via no update/delete routes).

---

## 7. Risks & Assumptions

- **RISK-001**: **Concurrent coupon usage race condition** — Two simultaneous booking creation requests with the same coupon code near its `totalUsageLimit` may both pass the usage limit check before either has committed. Mitigation: Use a Prisma `$transaction` with a `SELECT ... FOR UPDATE` (raw SQL) on the usage count check, or use a Redis-based atomic counter with BullMQ. Implement Redis counter as primary guard.
- **RISK-002**: **`PricingDiscountSlab` migration data loss** — If the migration script fails mid-way, some branches may have no active slabs. Mitigation: Wrap the entire migration in a database transaction. Run migration in staging first. Keep `PricingDiscountSlab` table intact until Phase 7 TASK-060 is explicitly executed and validated.
- **RISK-003**: **Pricing snapshot staleness** — Bookings created before discount system launch have `pricingSnapshot` JSON without discount breakdown fields. Historical invoices must render correctly without them. Mitigation: All invoice rendering code must treat new discount fields as optional with safe fallback to zero.
- **RISK-004**: **GST recalculation on existing bookings** — If a discount is applied post-booking, the GST amount in the existing invoice may be incorrect. Mitigation: Post-booking coupon application (allowed only when `DiscountRule.allowPostBooking: true`) must always regenerate the invoice with corrected tax values. This triggers the invoice re-generation flow.
- **RISK-005**: **Manual discount approval latency** — High-value manual discounts requiring ADMIN approval may block customer pickup if the admin is unavailable. Mitigation: Allow MANAGER to approve discounts below a second (higher) threshold. Define two thresholds in `BranchDiscountConfig`: `managerApprovalThreshold` and `adminApprovalThreshold`.
- **RISK-006**: **Frontend integration effort** — The frontend (React + Vite) will need new UI for coupon code entry, discount breakdown display, manual discount forms, and admin analytics. This plan covers backend only; frontend implementation is a separate task.

- **ASSUMPTION-001**: The existing `PricingEngineService.calculate()` is called once per booking at creation time. The `pricingSnapshot` JSON field on `Booking` stores the immutable pricing record for that booking. This plan preserves that pattern.
- **ASSUMPTION-002**: The `Branch` model always has a corresponding `BranchDiscountConfig` row (seeded via TASK-017 and TASK-062). Service code may safely use `!` (non-null assertion) after loading branch config.
- **ASSUMPTION-003**: All monetary amounts in the system use ISR (Indian Rupees) and two decimal places. The `Decimal` type with `@db.Decimal(10, 2)` for amounts and `@db.Decimal(10, 4)` for rates/percents is consistent with existing schema patterns.
- **ASSUMPTION-004**: The GST is always compound (CGST + SGST for intra-state, IGST for inter-state) as configured in `GSTRule`. This plan does not change GST calculation logic — only ensures the input base is post-discount.
- **ASSUMPTION-005**: Redis is available in the deployment environment for BullMQ-based anomaly detection scheduling and optional coupon usage rate limiting. This is already confirmed by the existing BullMQ usage in the codebase.
- **ASSUMPTION-006**: `ADMIN` role has system-wide access across all branches. `MANAGER` role has access limited to their assigned branch. `STAFF` role can apply existing coupons during booking but cannot create or modify discount rules.

---

## 8. Related Specifications / Further Reading

- [Existing Audit Log Plan](./feature-audit-logs-enhanced-1.md)
- [Existing Staff Activity Log Plan](./feature-staff-activity-log-1.md)
- [Prisma Schema — packages/db/prisma/schema.prisma]
- [Pricing Engine — apps/backend/src/services/pricing/pricing-engine.service.ts]
- [Advance Deposit Service — apps/backend/src/services/booking/advance-deposit.service.ts]
- [GST Rules in India — CGST Act 2017, Section 15 (Value of Taxable Supply) — discounts known at time of supply are deductible before GST]
- [Decimal.js Documentation — https://mikemcl.github.io/decimal.js/]
