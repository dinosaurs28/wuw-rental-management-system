---
goal: Pricing & Charge Management System — Modular, configurable, and auditable charge engine for the vehicle rental platform
version: 1.0
date_created: 2026-03-23
last_updated: 2026-03-23
owner: VRMS Engineering
status: 'Planned'
tags: [feature, architecture, pricing, charge-engine, settlement, audit]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan implements a **Modular Charge Engine** for the vehicle rental platform. All charge types — base pricing, extra kilometers, extra time, fuel deficit, fastag, damage, and safety deposits — are controlled via branch-level feature toggles and executed through a deterministic, unified settlement pipeline. Pricing plans are auto-derived from booking configuration; employees view computed plan details but never manually select pricing plans. All charge calculations, overrides, and settlement outcomes are fully audited.

---

## 1. Requirements & Constraints

- **REQ-001**: All charge types (base, extra km, extra time, fuel deficit, fastag, damage, safety deposit) must be controlled by branch-level feature toggles (`BranchChargeConfig`).
- **REQ-002**: Branch charge configuration must be frozen (snapshot) at booking creation time and stored immutably as `frozenChargeConfig` JSON on the booking. Mid-lifecycle config changes must not affect active bookings.
- **REQ-003**: Pricing plans (1 hour, 12 hours, 24 hours, monthly) must be auto-derived from booking `startAt`/`endAt`. Employees must not manually select pricing plans; they view computed plan details only.
- **REQ-004**: The Charge Engine must execute modules in a strict deterministic order: (1) base pricing → (2) duration adjustment → (3) extra km → (4) extra time → (5) grace → (6) fuel → (7) fastag → (8) damage → (9) employee override → (10) settlement.
- **REQ-005**: Each charge module must be an independent plug-in. Disabled modules must have zero effect on backend logic and zero visibility on the frontend.
- **REQ-006**: Fastag charges are only applicable if the vehicle has a `fastagNumber` configured and `hasFastag = true`. The `Vehicle` model must be extended with these optional fields.
- **REQ-007**: Fuel module must capture pickup and return fuel levels (enum: EMPTY, QUARTER, HALF, THREE_QUARTER, FULL). On return, detect deficit and allow custom charge input or mandatory skip-reason.
- **REQ-008**: Safety deposit requests initiated by employees must be approved by the branch manager before charging the customer.
- **REQ-009**: Employee charge override is permitted only when `employeeOverrideEnabled = true` in `BranchChargeConfig`. All overrides require a mandatory written reason.
- **REQ-010**: Damage reports must be manager-approved before inclusion in settlement.
- **REQ-011**: The Settlement Engine must handle all three outcomes: full refund (no extra charges), partial refund (charges < deposit), and additional payment required (charges > deposit).
- **REQ-012**: All actions — charge calculations, overrides, module applications, safety deposits, settlement — must be logged in `AuditLog` and `StaffActivityLog`.
- **REQ-013**: Concurrent updates to booking charge data must be guarded via version checks (`chargeConfigVersion` field).
- **REQ-014**: Repeated employee charge waivers must be tracked and flagged for anomaly detection.
- **REQ-015**: Grace policy module supports two modes: AUTOMATIC (applied without employee action) and MANUAL (employee triggers grace application).
- **REQ-016**: Override constraints: configurable max override percent per booking, optional manager approval above a threshold amount (`overrideApprovalThreshold`).

- **SEC-001**: Override actions must record `actorId`, `actorRole`, `originalAmount`, `overriddenAmount`, `waivedAmount`, and `reason` — immutably.
- **SEC-002**: `frozenChargeConfig` is write-once at booking creation; no endpoint may update it post-creation.
- **SEC-003**: Damage charge finalization endpoint must require `MANAGER` role.
- **SEC-004**: Safety deposit approval endpoint must require `MANAGER` role.
- **SEC-005**: Override approval endpoint (when `overrideRequiresApproval = true`) must require `MANAGER` role.

- **CON-001**: No duplicate charge modules — if the fuel module is disabled, no fuel-related fields are exposed to the frontend or processed by the backend.
- **CON-002**: `ChargeEntry` records are created by the Charge Engine only; no direct employee creation of arbitrary charge entries.
- **CON-003**: Existing `settlement-engine.service.ts` and `pricing-engine.service.ts` must be refactored into (or replaced by) the new Charge Engine architecture — no parallel logic.
- **CON-004**: The new system must integrate with the existing `PaymentTransaction`, `Invoice`, `AuditLog`, `StaffActivityLog`, and `DamageReport` models without schema breakage.
- **CON-005**: All monetary amounts use `Decimal` type with `@db.Decimal(10, 2)` precision.

- **GUD-001**: Module plug-ins are implemented as named strategy classes implementing a `ChargeModule` interface with methods `isApplicable(context): boolean` and `compute(context): ChargeResult`.
- **GUD-002**: The Charge Engine returns a `ChargeBreakdown` object consumed by both API responses and the Settlement Engine.
- **GUD-003**: All new service files follow the existing pattern: `*.service.ts` in `/apps/backend/src/services/charges/`.
- **GUD-004**: All new schema models must have a `publicId` (cuid), `createdAt`, and `updatedAt`.
- **GUD-005**: Frontend module visibility is driven by `frozenChargeConfig`; UI components check the frozen config, not live branch config.

- **PAT-001**: Follow the existing Prisma + Express.js + TypeScript stack — no new ORMs or frameworks.
- **PAT-002**: Follow role-based controller organization: `admin/`, `branchManager/`, `employee/`.
- **PAT-003**: Audit logging follows the dual-log pattern: `AuditLog` (detailed) + `StaffActivityLog` (action-focused).

---

## 2. Implementation Steps

### Implementation Phase 1 — Schema & Data Model

- **GOAL-001**: Extend the Prisma schema with all new models and fields required by the Charge Engine, then run migration.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `fastagNumber String?` and `hasFastag Boolean @default(false)` fields to the `Vehicle` model in `packages/db/prisma/schema.prisma` | | |
| TASK-002 | Add `frozenChargeConfig Json?` and `chargeConfigVersion Int @default(1)` fields to the `Booking` model | | |
| TASK-003 | Create `BranchChargeConfig` model: `id`, `publicId`, `branchId @unique`, `extraKmEnabled Boolean @default(true)`, `extraTimeEnabled Boolean @default(true)`, `fuelModuleEnabled Boolean @default(false)`, `fastagModuleEnabled Boolean @default(false)`, `gracePolicyEnabled Boolean @default(false)`, `damageModuleEnabled Boolean @default(true)`, `graceType GraceType @default(AUTOMATIC)`, `graceMinutes Int @default(15)`, `employeeOverrideEnabled Boolean @default(false)`, `maxOverridePercent Decimal?`, `overrideRequiresApproval Boolean @default(false)`, `overrideApprovalThreshold Decimal?`, `safetyDepositEnabled Boolean @default(false)`, `safetyDepositRequiresApproval Boolean @default(true)`, `createdAt`, `updatedAt`, relation to `Branch` | | |
| TASK-004 | Create `GraceType` enum: `AUTOMATIC`, `MANUAL` | | |
| TASK-005 | Create `ChargeType` enum: `BASE`, `EXTRA_KM`, `EXTRA_TIME`, `FUEL_DEFICIT`, `FASTAG`, `DAMAGE`, `GRACE_ADJUSTMENT`, `SAFETY_DEPOSIT` | | |
| TASK-006 | Create `ChargeEntry` model: `id`, `publicId`, `bookingId`, `chargeType ChargeType`, `moduleKey String`, `label String`, `originalAmount Decimal @db.Decimal(10,2)`, `finalAmount Decimal @db.Decimal(10,2)`, `quantity Decimal?`, `unitRate Decimal?`, `notes String?`, `isOverridden Boolean @default(false)`, `overrideId Int?`, `createdById`, `createdAt`, `updatedAt`; relations to `Booking`, `ChargeOverride`, `User` | | |
| TASK-007 | Create `OverrideStatus` enum: `PENDING`, `APPROVED`, `AUTO_APPROVED`, `REJECTED` | | |
| TASK-008 | Create `ChargeOverride` model: `id`, `publicId`, `bookingId`, `chargeEntryId Int? @unique`, `originalAmount Decimal`, `overriddenAmount Decimal`, `waivedAmount Decimal`, `reason String`, `status OverrideStatus @default(PENDING)`, `actorId`, `actorRole UserRole`, `approverId Int?`, `approvedAt DateTime?`, `rejectedAt DateTime?`, `rejectionReason String?`, `createdAt`, `updatedAt`; relations to `Booking`, `ChargeEntry`, `User` (actor + approver) | | |
| TASK-009 | Create `FuelLevel` enum: `EMPTY`, `QUARTER`, `HALF`, `THREE_QUARTER`, `FULL` | | |
| TASK-010 | Create `FuelRecord` model: `id`, `publicId`, `bookingId Int @unique`, `pickupFuelLevel FuelLevel`, `returnFuelLevel FuelLevel?`, `fuelDeficit Boolean @default(false)`, `fuelDeficitCharge Decimal?`, `skipReason String?`, `capturedByPickupId`, `capturedByReturnId Int?`, `pickupAt DateTime`, `returnAt DateTime?`, `createdAt`, `updatedAt`; relations to `Booking`, `User` (pickup + return captors) | | |
| TASK-011 | Create `SafetyDepositStatus` enum: `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CHARGED`, `REFUNDED` | | |
| TASK-012 | Create `SafetyDepositRequest` model: `id`, `publicId`, `bookingId`, `requestedAmount Decimal`, `reason String`, `status SafetyDepositStatus @default(PENDING_APPROVAL)`, `requestedById`, `approvedById Int?`, `approvedAmount Decimal?`, `approvedAt DateTime?`, `rejectedAt DateTime?`, `rejectionReason String?`, `createdAt`, `updatedAt`; relations to `Booking`, `User` (requester + approver) | | |
| TASK-013 | Add relations to `Booking` model: `chargeEntries ChargeEntry[]`, `chargeOverrides ChargeOverride[]`, `fuelRecord FuelRecord?`, `safetyDepositRequest SafetyDepositRequest?` | | |
| TASK-014 | Add relation to `Branch` model: `chargeConfig BranchChargeConfig?` | | |
| TASK-015 | Extend `StaffActivityLog.entityType` enum with new values: `CHARGE_ENTRY`, `CHARGE_OVERRIDE`, `FUEL_RECORD`, `SAFETY_DEPOSIT_REQUEST`, `BRANCH_CHARGE_CONFIG` | | |
| TASK-016 | Extend `AuditLog.category` enum with `CHARGE` category | | |
| TASK-017 | Run `pnpm --filter @vrms/db db:migrate dev --name "add_charge_engine"` and verify migration output | | |
| TASK-018 | Run `pnpm --filter @vrms/db db:generate` to regenerate Prisma client | | |

---

### Implementation Phase 2 — TypeScript Types & Shared Schemas

- **GOAL-002**: Define all TypeScript interfaces and Zod validation schemas for the Charge Engine domain.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Create `/apps/backend/src/types/charge-engine.types.ts` defining: `ChargeContext` (booking snapshot, vehicle, frozenConfig, pickup data), `ChargeResult` (chargeType, moduleKey, label, originalAmount, finalAmount, quantity, unitRate), `ChargeBreakdown` (array of `ChargeResult` + totals: subtotal, overrideTotal, waivedTotal, finalTotal), `ChargeModuleInterface` (isApplicable, compute methods) | | |
| TASK-020 | Create `/packages/schemas/src/charge-config.schema.ts` with Zod schemas: `branchChargeConfigSchema` (all toggle fields + constraints), `updateBranchChargeConfigSchema` (partial), `frozenChargeConfigSchema` (readonly snapshot) | | |
| TASK-021 | Create `/packages/schemas/src/charge-entry.schema.ts` with: `chargeOverrideInputSchema` (chargeEntryPublicId, overriddenAmount, reason), `fuelRecordPickupSchema` (pickupFuelLevel), `fuelRecordReturnSchema` (returnFuelLevel, fuelDeficitCharge?, skipReason?), `safetyDepositRequestSchema` (requestedAmount, reason), `fastagChargeInputSchema` (amount, notes?) | | |
| TASK-022 | Add `fastagNumber`, `hasFastag` to vehicle schemas in `/packages/schemas/src/vehicle.schema.ts` | | |

---

### Implementation Phase 3 — Charge Module Plug-ins

- **GOAL-003**: Implement each charge module as an independent plug-in class implementing `ChargeModuleInterface`. Each module is located in `/apps/backend/src/services/charges/modules/`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | Create `/services/charges/modules/base-pricing.module.ts`: reads `VehicleCustomPricing` for the vehicle, derives the correct plan (hourly/12h/24h/monthly) from `booking.startAt`/`endAt`, computes `baseTotal`. Always enabled — not togglable. Returns `ChargeResult` with `chargeType: BASE` | | |
| TASK-024 | Create `/services/charges/modules/extra-km.module.ts`: `isApplicable` checks `frozenConfig.extraKmEnabled`. Computes `(totalKmDriven - freeKmLimit) * extraKmRate` if positive, else 0. Returns `ChargeResult` with `chargeType: EXTRA_KM`, `quantity: excessKm`, `unitRate: extraKmRate` | | |
| TASK-025 | Create `/services/charges/modules/extra-time.module.ts`: `isApplicable` checks `frozenConfig.extraTimeEnabled`. Computes billable extra hours beyond plan using `booking.actualHours` vs `booking.billableHours`. Applies `extraHourRate` from `VehicleCustomPricing`. Returns `ChargeResult` with `chargeType: EXTRA_TIME` | | |
| TASK-026 | Create `/services/charges/modules/grace-policy.module.ts`: `isApplicable` checks `frozenConfig.gracePolicyEnabled`. If enabled, subtracts `graceMinutes` from late-return duration before passing to extra-time module. If `graceType = AUTOMATIC`, applies without input. If `graceType = MANUAL`, requires employee trigger flag in context. Returns `ChargeResult` with `chargeType: GRACE_ADJUSTMENT` (negative amount) | | |
| TASK-027 | Create `/services/charges/modules/fuel-deficit.module.ts`: `isApplicable` checks `frozenConfig.fuelModuleEnabled`. Computes deficit if `returnFuelLevel < pickupFuelLevel`. Employee inputs custom `fuelDeficitCharge` or provides `skipReason`. Returns `ChargeResult` with `chargeType: FUEL_DEFICIT` | | |
| TASK-028 | Create `/services/charges/modules/fastag.module.ts`: `isApplicable` checks `frozenConfig.fastagModuleEnabled AND vehicle.hasFastag`. If applicable, employee inputs fastag expense amount. Returns `ChargeResult` with `chargeType: FASTAG` | | |
| TASK-029 | Create `/services/charges/modules/damage.module.ts`: `isApplicable` checks `frozenConfig.damageModuleEnabled`. Reads all `DamageReport` records for the booking with `status = APPROVED`. Sums `finalCost` values. Returns `ChargeResult` with `chargeType: DAMAGE`. If no approved damage reports, returns 0. | | |
| TASK-030 | Create `/services/charges/modules/override-adjuster.module.ts`: `isApplicable` checks `frozenConfig.employeeOverrideEnabled`. Reads all `ChargeOverride` records with `status IN [APPROVED, AUTO_APPROVED]` for the booking. Applies waived amounts as negative adjustments against matching `ChargeEntry` records. Returns adjusted `ChargeResult[]` with `isOverridden = true` | | |

---

### Implementation Phase 4 — Charge Engine Orchestrator

- **GOAL-004**: Implement the central `ChargeEngineService` that executes all modules in deterministic order and produces a `ChargeBreakdown`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-031 | Create `/services/charges/charge-engine.service.ts` with method `computeCharges(context: ChargeContext): Promise<ChargeBreakdown>`. Execution order: (1) BasePricingModule, (2) ExtraKmModule, (3) ExtraTimeModule, (4) GracePolicyModule (applied before extra-time finalization), (5) FuelDeficitModule, (6) FastagModule, (7) DamageModule, (8) OverrideAdjusterModule. Collect all `ChargeResult[]`, compute `subtotal`, `waivedTotal`, `finalTotal`. | | |
| TASK-032 | Add `persistChargeEntries(bookingId: number, breakdown: ChargeBreakdown, actorId: number, tx: PrismaTransaction): Promise<ChargeEntry[]>` method to `charge-engine.service.ts`. Upserts `ChargeEntry` records — one per non-zero charge result. Uses `moduleKey` as upsert key per booking. | | |
| TASK-033 | Add `freezeChargeConfig(branchId: number): Promise<FrozenChargeConfig>` method to `/services/charges/charge-config.service.ts` (new file). Reads `BranchChargeConfig` for the branch and returns a plain JSON snapshot. Returns defaults (all safe defaults) if no config exists yet for the branch. | | |
| TASK-034 | Create `/services/charges/charge-config.service.ts` with full CRUD: `getChargeConfig(branchId)`, `upsertChargeConfig(branchId, data)`, `freezeChargeConfig(branchId)` | | |
| TASK-035 | Refactor existing `/services/pricing/pricing-engine.service.ts`: remove any settlement/extra-charge logic that now belongs to the Charge Engine. Retain only `computeBasePrice(vehicleId, startAt, endAt)` and `derivePricingPlan(startAt, endAt)` as utility functions consumed by `BasePricingModule`. | | |
| TASK-036 | Refactor existing `/services/payment/settlement-engine.service.ts`: remove any charge-computation logic. Retain only settlement math: `computeSettlement(breakdown: ChargeBreakdown, depositTotal: Decimal, safetyDeposit: Decimal): SettlementOutcome`. `SettlementOutcome` must have: `outcomeType: FULL_REFUND | PARTIAL_REFUND | ADDITIONAL_PAYMENT_REQUIRED`, `amountDue: Decimal`, `refundAmount: Decimal`, `breakdown: ChargeBreakdown`. | | |

---

### Implementation Phase 5 — Branch Charge Configuration API

- **GOAL-005**: Expose CRUD endpoints for `BranchChargeConfig`, accessible by branch managers and admins.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-037 | Create `/apps/backend/src/controller/branchManager/charge-config.controller.ts` with handlers: `getChargeConfig(req, res)` — GET own branch config; `upsertChargeConfig(req, res)` — PUT with `branchChargeConfigSchema` validation | | |
| TASK-038 | Create `/apps/backend/src/controller/admin/charge-config.controller.ts` with handlers: `getChargeConfigForBranch(req, res)` — GET any branch; `upsertChargeConfigForBranch(req, res)` — PUT any branch | | |
| TASK-039 | Add routes to `/apps/backend/src/routes/branchManager/branchManager.routes.ts`: `GET /charge-config` → `getChargeConfig`; `PUT /charge-config` → `upsertChargeConfig` | | |
| TASK-040 | Add routes to `/apps/backend/src/routes/admin/admin.routes.ts`: `GET /branches/:branchId/charge-config` → `getChargeConfigForBranch`; `PUT /branches/:branchId/charge-config` → `upsertChargeConfigForBranch` | | |
| TASK-041 | Log all charge config changes to `AuditLog` (category: `CHARGE`, action: `CHARGE_CONFIG_UPDATED`, before/after JSON) and `StaffActivityLog` (entityType: `BRANCH_CHARGE_CONFIG`, actionType: `UPDATED`) | | |

---

### Implementation Phase 6 — Vehicle Fastag Configuration API

- **GOAL-006**: Expose endpoints to configure `fastagNumber` and `hasFastag` on a vehicle.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-042 | Add `PATCH /vehicles/:vehiclePublicId/fastag` route in `/routes/branchManager/branchManager.routes.ts` with body `{ fastagNumber: string, hasFastag: boolean }` | | |
| TASK-043 | Add handler `updateVehicleFastag(req, res)` in `/controller/branchManager/vehicle.controller.ts` (or existing vehicle controller). Validates input, updates vehicle, logs to `AuditLog` (category: `VEHICLE`, action: `FASTAG_CONFIGURED`) and `StaffActivityLog` | | |

---

### Implementation Phase 7 — Booking Creation: Config Freeze

- **GOAL-007**: Freeze branch charge config as an immutable snapshot at booking creation time.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-044 | In the existing booking creation flow (locate booking create controller/service), call `chargeConfigService.freezeChargeConfig(branchId)` and store the result as `booking.frozenChargeConfig` (JSON) during the Prisma `booking.create` call | | |
| TASK-045 | Ensure `frozenChargeConfig` is excluded from all `booking.update` calls — add a lint/comment guard or a Prisma middleware that strips this field from updates | | |
| TASK-046 | Include `frozenChargeConfig` in the booking detail API response so the frontend can conditionally render charge modules | | |

---

### Implementation Phase 8 — Pickup Flow: Baseline Data Capture

- **GOAL-008**: Capture start odometer and optionally fuel level during vehicle pickup. Optionally initiate safety deposit request.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-047 | Extend the existing pickup request schema (in `/packages/schemas/`) to include: `startOdometer: number` (required), `pickupFuelLevel: FuelLevel` (required if `frozenChargeConfig.fuelModuleEnabled = true`), `safetyDepositRequest?: { requestedAmount: number, reason: string }` (optional, if `frozenChargeConfig.safetyDepositEnabled = true`) | | |
| TASK-048 | In the existing pickup controller/service, after validating the pickup payload: (a) update `booking.startOdometer`; (b) if fuel module enabled, create `FuelRecord` with `pickupFuelLevel`, `capturedByPickupId`, `pickupAt`; (c) if safety deposit request present and `safetyDepositRequiresApproval = true`, create `SafetyDepositRequest` with `status: PENDING_APPROVAL`; if approval not required, set `status: APPROVED` and proceed to charge | | |
| TASK-049 | Log `FuelRecord` creation to `StaffActivityLog` (entityType: `FUEL_RECORD`, actionType: `CREATED`) and `AuditLog` (category: `CHARGE`) | | |
| TASK-050 | Log `SafetyDepositRequest` creation to `StaffActivityLog` (entityType: `SAFETY_DEPOSIT_REQUEST`, actionType: `INITIATED`) and `AuditLog` (category: `CHARGE`, severity: `WARNING` if pending approval) | | |

---

### Implementation Phase 9 — Safety Deposit Request: Manager Approval

- **GOAL-009**: Expose manager endpoints for approving/rejecting safety deposit requests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-051 | Create `/controller/branchManager/safety-deposit-request.controller.ts` with: `listPendingSafetyDepositRequests(req, res)`, `approveSafetyDepositRequest(req, res)` (body: `{ approvedAmount }`), `rejectSafetyDepositRequest(req, res)` (body: `{ rejectionReason }`) | | |
| TASK-052 | Add routes in `/routes/branchManager/branchManager.routes.ts`: `GET /safety-deposit-requests` (filter by status=PENDING_APPROVAL), `POST /safety-deposit-requests/:publicId/approve`, `POST /safety-deposit-requests/:publicId/reject` | | |
| TASK-053 | On approval: update `SafetyDepositRequest.status = APPROVED`, create a `PaymentTransaction` with `purpose: SAFETY_DEPOSIT`, `status: COLLECTED` (or route to existing deposit flow), update `booking.safetyDeposit`. Log to `AuditLog` (category: `CHARGE`) and `StaffActivityLog` | | |
| TASK-054 | On rejection: update `SafetyDepositRequest.status = REJECTED`. Log to `AuditLog` and `StaffActivityLog`. Notify employee (reuse existing notification mechanism if available) | | |

---

### Implementation Phase 10 — Return Flow: Charge Computation

- **GOAL-010**: Compute all applicable charges at vehicle return using the Charge Engine, persist `ChargeEntry` records, and present the breakdown for employee review.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-055 | Extend the existing return request schema to include: `endOdometer: number`, `returnFuelLevel: FuelLevel` (required if fuel module enabled), `fuelDeficitCharge: number?` (if deficit detected), `fuelSkipReason: string?` (required if deficit but charge skipped), `fastagAmount: number?` (required if fastag module enabled and `vehicle.hasFastag = true`), `fastagNotes: string?`, `applyGrace: boolean?` (only relevant if `graceType = MANUAL`) | | |
| TASK-056 | Create `/services/charges/return-charge.service.ts` with method `processReturnCharges(bookingId, returnInput, actorId): Promise<ChargeBreakdown>`. This service: (a) loads booking with `frozenChargeConfig`, vehicle, and `fuelRecord`; (b) computes `totalKmDriven = endOdometer - startOdometer`; (c) computes `actualHours` from `startAt` to return time; (d) if fuel module enabled, updates `FuelRecord` with return data; (e) if fastag module enabled, prepares fastag context; (f) builds `ChargeContext` and calls `chargeEngineService.computeCharges(context)`; (g) calls `persistChargeEntries(bookingId, breakdown, actorId, tx)`; (h) updates `booking.endOdometer`, `totalKmDriven`, `actualHours`, `billableHours`, `status = RETURNED` | | |
| TASK-057 | In the return endpoint (existing employee return controller), call `returnChargeService.processReturnCharges(...)` and return the `ChargeBreakdown` in the response for employee review before settlement confirmation | | |
| TASK-058 | Add validation: if `fuelModuleEnabled && fuelDeficit && !fuelDeficitCharge && !fuelSkipReason`, return HTTP 422 with clear error message | | |
| TASK-059 | Add validation: if `fastagModuleEnabled && vehicle.hasFastag && fastagAmount === undefined`, return HTTP 422 | | |
| TASK-060 | Log return charge computation to `AuditLog` (category: `CHARGE`, action: `CHARGES_COMPUTED`, entity: `Booking`, after: `ChargeBreakdown`) and `StaffActivityLog` (entityType: `CHARGE_ENTRY`, actionType: `CREATED`) | | |

---

### Implementation Phase 11 — Employee Charge Override

- **GOAL-011**: Allow employees to reduce or waive computed charges when `employeeOverrideEnabled = true`, with mandatory reason and optional manager approval.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-061 | Create `/controller/employee/charge-override.controller.ts` with handler `submitOverride(req, res)`. Validates: (a) `frozenChargeConfig.employeeOverrideEnabled = true`; (b) `overriddenAmount >= 0`; (c) `reason` is non-empty string; (d) if `maxOverridePercent` configured, `waivedAmount / originalAmount <= maxOverridePercent / 100`; (e) creates `ChargeOverride` with `status = PENDING` if `overrideRequiresApproval = true` AND `waivedAmount > overrideApprovalThreshold`, else `status = AUTO_APPROVED`; (f) if AUTO_APPROVED, updates linked `ChargeEntry.finalAmount` and `isOverridden = true` immediately | | |
| TASK-062 | Add route `POST /bookings/:bookingPublicId/charge-entries/:chargeEntryPublicId/override` in `/routes/employee/employee.routes.ts` | | |
| TASK-063 | Create `/controller/branchManager/charge-override.controller.ts` with: `listPendingOverrides(req, res)`, `approveOverride(req, res)`, `rejectOverride(req, res)` (body: `{ rejectionReason }`) | | |
| TASK-064 | Add routes in `/routes/branchManager/branchManager.routes.ts`: `GET /charge-overrides/pending`, `POST /charge-overrides/:publicId/approve`, `POST /charge-overrides/:publicId/reject` | | |
| TASK-065 | On override approval: update `ChargeOverride.status = APPROVED`, update linked `ChargeEntry.finalAmount = overriddenAmount`, `isOverridden = true`. Log to `AuditLog` (category: `CHARGE`, action: `OVERRIDE_APPROVED`, before: `{originalAmount}`, after: `{overriddenAmount, waivedAmount, reason}`) and `StaffActivityLog` (entityType: `CHARGE_OVERRIDE`, actionType: `APPROVED`) | | |
| TASK-066 | On override rejection: update `ChargeOverride.status = REJECTED`. Log to `AuditLog` and `StaffActivityLog`. `ChargeEntry.finalAmount` remains unchanged. | | |
| TASK-067 | On any override action (submit/approve/reject), call anomaly detection: count total `ChargeOverride` records by `actorId` with `status IN [APPROVED, AUTO_APPROVED]` in the last 30 days and waived amounts. If count > threshold (configurable via `BranchChargeConfig` or `SystemSetting`), create a `StaffActivityLog` with `actionType: FLAGGED` and `AuditLog` with `severity: WARNING, action: OVERRIDE_ANOMALY_DETECTED` | | |
| TASK-068 | Log all override submissions to `AuditLog` (category: `CHARGE`, action: `OVERRIDE_SUBMITTED`, severity: `WARNING`) and `StaffActivityLog` (entityType: `CHARGE_OVERRIDE`, actionType: `OVERRIDDEN`) | | |

---

### Implementation Phase 12 — Damage Charge Finalization

- **GOAL-012**: Ensure damage charges are manager-approved before inclusion in settlement, integrating with the existing `DamageReport` model and `/services/damage/damage-charge.service.ts`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-069 | Verify existing damage approval endpoint requires `MANAGER` role and sets `DamageReport.status = APPROVED` and `finalCost`. If missing, add it. | | |
| TASK-070 | In the `DamageModule.compute()`, only include `DamageReport` records with `status = APPROVED`. Documents uploaded as evidence must be present (`photos.length > 0`) for approval to succeed — add this check to the damage approval controller | | |
| TASK-071 | Extend the existing damage approval flow: on approval, trigger `charge-engine.service.ts` recomputation for the booking to update the `DAMAGE` `ChargeEntry`. If settlement has already been initiated, flag the booking for manager review | | |
| TASK-072 | Log damage charge finalization to `AuditLog` (category: `CHARGE`, action: `DAMAGE_CHARGE_FINALIZED`) and `StaffActivityLog` (entityType: `DAMAGE_REPORT`, actionType: `APPROVED`) — confirm this already exists in the damage service; add if missing | | |

---

### Implementation Phase 13 — Settlement Engine Integration

- **GOAL-013**: Connect the `ChargeBreakdown` output to the `SettlementEngine` and handle all three settlement outcome types using the existing `PaymentTransaction` infrastructure.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-073 | Update `/services/payment/settlement-engine.service.ts` `computeSettlement` method signature to: `computeSettlement(bookingId: number): Promise<SettlementOutcome>`. Internally: (a) load all `ChargeEntry` records for the booking (sum `finalAmount` values); (b) load `booking.totalDeposit` and `booking.safetyDeposit`; (c) compute outcome type; (d) return `SettlementOutcome` | | |
| TASK-074 | Create `/controller/employee/settlement.controller.ts` with `initiateSettlement(req, res)`: calls `computeSettlement(bookingId)`, returns `SettlementOutcome` for employee review before payment collection | | |
| TASK-075 | Create `/controller/employee/settlement.controller.ts` `confirmSettlement(req, res)`: locks the breakdown, creates the appropriate `PaymentTransaction` based on `outcomeType` — (a) `FULL_REFUND`: create `PaymentTransaction` with `purpose: OVERPAYMENT_REFUND`; (b) `PARTIAL_REFUND`: create `RefundRequest` via existing refund flow; (c) `ADDITIONAL_PAYMENT_REQUIRED`: create `PaymentTransaction` with `purpose: REMAINING_BALANCE` | | |
| TASK-076 | Add routes in `/routes/employee/employee.routes.ts`: `GET /bookings/:bookingPublicId/settlement` → `initiateSettlement`; `POST /bookings/:bookingPublicId/settlement/confirm` → `confirmSettlement` | | |
| TASK-077 | Add concurrent update guard: `confirmSettlement` must include `chargeConfigVersion` in request body, compare against `booking.chargeConfigVersion`, return HTTP 409 if mismatch, and increment `chargeConfigVersion` on success | | |
| TASK-078 | Log settlement initiation and confirmation to `AuditLog` (category: `CHARGE`, action: `SETTLEMENT_INITIATED` / `SETTLEMENT_CONFIRMED`, entity: `Booking`) and `StaffActivityLog` (entityType: `BOOKING`, actionType: `SETTLED`) | | |
| TASK-079 | Update `Invoice` generation: after settlement confirmation, call the existing invoice service to create `InvoiceItem` records from `ChargeEntry` records (one line item per charge entry using `ChargeEntry.label` and `finalAmount`) | | |

---

### Implementation Phase 14 — Frontend: Branch Charge Configuration UI

- **GOAL-014**: Build the branch manager UI for configuring charge modules.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-080 | Create `apps/frontend/src/pages/branch-manager/ChargeConfigPage.tsx`: form with toggle switches for each module (extra km, extra time, fuel, fastag, grace, damage, employee override, safety deposit). Show sub-options (graceMinutes, graceType, maxOverridePercent, overrideApprovalThreshold) only when parent toggle is enabled | | |
| TASK-081 | Create `apps/frontend/src/components/charge-config/ChargeModuleToggle.tsx`: reusable toggle component with label, description, enabled state, and optional child config panel | | |
| TASK-082 | Add "Charge Settings" navigation item in the branch manager sidebar/nav, linking to `ChargeConfigPage` | | |
| TASK-083 | Wire `ChargeConfigPage` to `PUT /api/branch-manager/charge-config` and `GET /api/branch-manager/charge-config` API endpoints | | |

---

### Implementation Phase 15 — Frontend: Vehicle Fastag Configuration UI

- **GOAL-015**: Allow branch managers to configure fastag on vehicles.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-084 | In the existing vehicle detail/edit page (`apps/frontend/src/pages/branch-manager/`), add a "Fastag" section with: a toggle for `hasFastag` and a text input for `fastagNumber` (shown only when `hasFastag = true`) | | |
| TASK-085 | Wire to `PATCH /api/branch-manager/vehicles/:vehiclePublicId/fastag` | | |

---

### Implementation Phase 16 — Frontend: Pickup Flow UI (Module-Aware)

- **GOAL-016**: Update the pickup UI to conditionally capture baseline data based on `frozenChargeConfig`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-086 | In the existing pickup form component, add `startOdometer` input (always shown) | | |
| TASK-087 | If `frozenChargeConfig.fuelModuleEnabled = true`, show `FuelLevelSelector` component (dropdown: EMPTY / QUARTER / HALF / THREE_QUARTER / FULL) labeled "Pickup Fuel Level" | | |
| TASK-088 | If `frozenChargeConfig.safetyDepositEnabled = true`, show an optional "Request Safety Deposit" section with `requestedAmount` and `reason` inputs | | |
| TASK-089 | Create `apps/frontend/src/components/pickup/FuelLevelSelector.tsx`: dropdown component with fuel level icons/labels | | |
| TASK-090 | Display auto-computed pricing plan details (plan type, allowed km, duration, extra km rate, extra time rate) in a read-only info panel. Label: "Pricing Plan Details — For Customer Communication". No editable fields. | | |

---

### Implementation Phase 17 — Frontend: Return Flow UI (Module-Aware Charge Review)

- **GOAL-017**: Build the return UI with module-aware charge inputs and a charge breakdown review step before settlement.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-091 | In the existing return form, add `endOdometer` input (always shown). Display computed `totalKmDriven` (endOdometer - startOdometer) as read-only alongside free km allowance | | |
| TASK-092 | If `frozenChargeConfig.fuelModuleEnabled = true`: show `FuelLevelSelector` for "Return Fuel Level". If return level < pickup level, show fuel deficit section with optional `fuelDeficitCharge` input (number) and a "Skip" toggle that requires `skipReason` text input | | |
| TASK-093 | If `frozenChargeConfig.fastagModuleEnabled = true AND vehicle.hasFastag = true`: show "Fastag Charges" section with `fastagAmount` input and optional `fastagNotes` | | |
| TASK-094 | If `frozenChargeConfig.gracePolicyEnabled = true AND graceType = MANUAL`: show "Apply Grace Period" checkbox/toggle that passes `applyGrace: true` | | |
| TASK-095 | Create `apps/frontend/src/components/return/ChargeBreakdownReview.tsx`: displays all computed `ChargeEntry` records as a table (label, quantity, unit rate, original amount, final amount, override indicator). Shows totals row. | | |
| TASK-096 | If `frozenChargeConfig.employeeOverrideEnabled = true`: for each applicable `ChargeEntry` in the breakdown, show an "Override" button. Clicking opens `ChargeOverrideModal.tsx` with `overriddenAmount` input (0 to originalAmount) and `reason` textarea (required). Shows pending/approved/rejected status badge after submission. | | |
| TASK-097 | Create `apps/frontend/src/components/return/ChargeOverrideModal.tsx`: modal with override amount slider/input (bounded 0–originalAmount), mandatory reason field, submit button. Disabled if override not permitted by `frozenChargeConfig`. | | |
| TASK-098 | Return flow steps: (1) Input return data → (2) View computed charge breakdown (ChargeBreakdownReview) → (3) Submit overrides if needed → (4) Confirm and proceed to settlement | | |

---

### Implementation Phase 18 — Frontend: Settlement UI

- **GOAL-018**: Build the settlement summary and payment collection UI.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-099 | Create `apps/frontend/src/components/settlement/SettlementSummary.tsx`: displays `SettlementOutcome` — outcome type badge (FULL_REFUND / PARTIAL_REFUND / ADDITIONAL_PAYMENT), deposit paid, total charges, net amount due or refundable | | |
| TASK-100 | For `ADDITIONAL_PAYMENT_REQUIRED`: show existing payment collection UI (cash/online/split), wired to `POST /bookings/:id/settlement/confirm` | | |
| TASK-101 | For `FULL_REFUND` or `PARTIAL_REFUND`: show refund initiation UI following the existing refund approval flow (already implemented in payment system) | | |
| TASK-102 | Include `chargeConfigVersion` in the settlement confirmation request body (read from booking state) for optimistic concurrency guard | | |

---

### Implementation Phase 19 — Frontend: Branch Manager Override & Deposit Approval UI

- **GOAL-019**: Build manager approval queues for pending charge overrides and safety deposit requests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-103 | Create `apps/frontend/src/pages/branch-manager/PendingOverridesPage.tsx`: list of pending `ChargeOverride` records with booking reference, employee name, charge type, original/override amounts, reason. Approve/Reject action buttons. | | |
| TASK-104 | Create `apps/frontend/src/pages/branch-manager/PendingSafetyDepositPage.tsx`: list of pending `SafetyDepositRequest` records. Approve (with editable approved amount) / Reject (with rejection reason) actions. | | |
| TASK-105 | Add notification badge to branch manager dashboard for pending override approvals and pending safety deposit requests (count badges) | | |

---

## 3. Alternatives

- **ALT-001**: **Single JSON charge config on Booking instead of frozen snapshot** — Rejected. A direct reference to `BranchChargeConfig` would mean config changes mid-booking could silently alter charge behavior. The frozen snapshot (stored as `frozenChargeConfig Json` on `Booking`) ensures deterministic lifecycle behavior.
- **ALT-002**: **Storing charge modules as individual boolean columns on `Booking`** — Rejected. The number of module flags would grow with feature additions. A single JSON snapshot is more extensible and mirrors the existing `BranchDiscountConfig` pattern.
- **ALT-003**: **Implementing charge override as direct `ChargeEntry` mutation** — Rejected. A separate `ChargeOverride` model preserves the original calculated amount for full audit, anomaly detection, and rollback capability. The `ChargeEntry` stores both `originalAmount` and `finalAmount`.
- **ALT-004**: **Adding `hasFastag` as a `VehicleFeatureFlag` entry instead of a model field** — Rejected. `VehicleFeatureFlag` is a generic toggle system. Fastag needs a specific `fastagNumber` string value, which a boolean feature flag cannot capture. Direct model fields are more type-safe and queryable.
- **ALT-005**: **Replacing existing `settlement-engine.service.ts` entirely** — Rejected. The existing service handles payment transaction orchestration correctly. The plan preserves it while removing any charge-computation logic that should live in the Charge Engine.

---

## 4. Dependencies

- **DEP-001**: Prisma migration `add_charge_engine` must be applied before any Phase 3–19 tasks can be executed.
- **DEP-002**: `BranchChargeConfig` must be created (via API or seed) for a branch before bookings on that branch can freeze charge configs. The `freezeChargeConfig` service must return safe defaults if no config exists.
- **DEP-003**: Existing `VehicleCustomPricing` records must be populated for vehicles — `BasePricingModule` reads these. No new vehicle custom pricing schema changes are required.
- **DEP-004**: Existing `DamageReport` approval flow must be verified operational before `DamageModule` can include charges in settlement.
- **DEP-005**: Existing `PaymentTransaction` and `RefundRequest` models and services must remain unchanged — the Settlement Engine integration (Phase 13) calls into them without modification.
- **DEP-006**: `pnpm` workspace structure — all schema changes in `packages/db`, all validation schemas in `packages/schemas`, all backend logic in `apps/backend`, all UI in `apps/frontend`.

---

## 5. Files

### New Files

- **FILE-001**: `packages/db/prisma/schema.prisma` — Extended with `BranchChargeConfig`, `ChargeEntry`, `ChargeOverride`, `FuelRecord`, `SafetyDepositRequest` models and `ChargeType`, `GraceType`, `FuelLevel`, `OverrideStatus`, `SafetyDepositStatus` enums; `Vehicle.fastagNumber`, `Vehicle.hasFastag`, `Booking.frozenChargeConfig`, `Booking.chargeConfigVersion` fields
- **FILE-002**: `apps/backend/src/types/charge-engine.types.ts` — `ChargeContext`, `ChargeResult`, `ChargeBreakdown`, `SettlementOutcome`, `ChargeModuleInterface` TypeScript types
- **FILE-003**: `packages/schemas/src/charge-config.schema.ts` — Zod schemas for `BranchChargeConfig`
- **FILE-004**: `packages/schemas/src/charge-entry.schema.ts` — Zod schemas for override input, fuel record, fastag input, safety deposit request
- **FILE-005**: `apps/backend/src/services/charges/charge-engine.service.ts` — Charge Engine orchestrator
- **FILE-006**: `apps/backend/src/services/charges/charge-config.service.ts` — `BranchChargeConfig` CRUD + freeze logic
- **FILE-007**: `apps/backend/src/services/charges/return-charge.service.ts` — Return charge computation coordinator
- **FILE-008**: `apps/backend/src/services/charges/modules/base-pricing.module.ts` — Base price calculation plug-in
- **FILE-009**: `apps/backend/src/services/charges/modules/extra-km.module.ts` — Extra kilometer charge plug-in
- **FILE-010**: `apps/backend/src/services/charges/modules/extra-time.module.ts` — Extra time charge plug-in
- **FILE-011**: `apps/backend/src/services/charges/modules/grace-policy.module.ts` — Grace period adjustment plug-in
- **FILE-012**: `apps/backend/src/services/charges/modules/fuel-deficit.module.ts` — Fuel deficit charge plug-in
- **FILE-013**: `apps/backend/src/services/charges/modules/fastag.module.ts` — Fastag expense plug-in
- **FILE-014**: `apps/backend/src/services/charges/modules/damage.module.ts` — Approved damage charge plug-in
- **FILE-015**: `apps/backend/src/services/charges/modules/override-adjuster.module.ts` — Override application plug-in
- **FILE-016**: `apps/backend/src/controller/branchManager/charge-config.controller.ts` — Branch manager charge config endpoints
- **FILE-017**: `apps/backend/src/controller/admin/charge-config.controller.ts` — Admin charge config endpoints
- **FILE-018**: `apps/backend/src/controller/branchManager/safety-deposit-request.controller.ts` — Safety deposit approval endpoints
- **FILE-019**: `apps/backend/src/controller/branchManager/charge-override.controller.ts` — Override approval endpoints
- **FILE-020**: `apps/backend/src/controller/employee/charge-override.controller.ts` — Override submission endpoint
- **FILE-021**: `apps/backend/src/controller/employee/settlement.controller.ts` — Settlement initiation and confirmation
- **FILE-022**: `apps/frontend/src/pages/branch-manager/ChargeConfigPage.tsx` — Charge module configuration UI
- **FILE-023**: `apps/frontend/src/components/charge-config/ChargeModuleToggle.tsx` — Reusable toggle with sub-config
- **FILE-024**: `apps/frontend/src/components/pickup/FuelLevelSelector.tsx` — Fuel level dropdown
- **FILE-025**: `apps/frontend/src/components/return/ChargeBreakdownReview.tsx` — Charge breakdown table
- **FILE-026**: `apps/frontend/src/components/return/ChargeOverrideModal.tsx` — Override input modal
- **FILE-027**: `apps/frontend/src/components/settlement/SettlementSummary.tsx` — Settlement outcome display
- **FILE-028**: `apps/frontend/src/pages/branch-manager/PendingOverridesPage.tsx` — Override approval queue
- **FILE-029**: `apps/frontend/src/pages/branch-manager/PendingSafetyDepositPage.tsx` — Safety deposit approval queue

### Modified Files

- **FILE-030**: `packages/db/prisma/schema.prisma` — (same as FILE-001, extended in-place)
- **FILE-031**: `apps/backend/src/services/pricing/pricing-engine.service.ts` — Stripped to base-price utility only; settlement/extra-charge logic removed
- **FILE-032**: `apps/backend/src/services/payment/settlement-engine.service.ts` — Refactored to consume `ChargeEntry` records; charge-computation logic removed
- **FILE-033**: `apps/backend/src/controller/employee/pickup.controller.ts` (or equivalent) — Extended for odometer, fuel record, safety deposit request
- **FILE-034**: `apps/backend/src/controller/employee/return.controller.ts` (or equivalent) — Extended for return charge computation via `ReturnChargeService`
- **FILE-035**: `apps/backend/src/routes/branchManager/branchManager.routes.ts` — New charge config, override, safety deposit routes added
- **FILE-036**: `apps/backend/src/routes/employee/employee.routes.ts` — New override submission, settlement routes added
- **FILE-037**: `apps/backend/src/routes/admin/admin.routes.ts` — New admin charge config routes added
- **FILE-038**: `packages/schemas/src/vehicle.schema.ts` — `fastagNumber` and `hasFastag` fields added
- **FILE-039**: `apps/frontend/src/pages/employee/PickupPage.tsx` (or equivalent) — Fuel level, odometer, safety deposit sections added
- **FILE-040**: `apps/frontend/src/pages/employee/ReturnPage.tsx` (or equivalent) — Full return flow with charge breakdown review steps
- **FILE-041**: `apps/frontend/src/pages/branch-manager/VehicleDetailPage.tsx` (or equivalent) — Fastag configuration section added

---

## 6. Testing

- **TEST-001**: Unit test `BasePricingModule.compute()` — verify correct plan selection for 1h, 12h, 24h, and monthly durations; verify `baseTotal` matches `VehicleCustomPricing` rates
- **TEST-002**: Unit test `ExtraKmModule.compute()` — verify 0 charge when km ≤ freeKmLimit; verify correct charge when km > freeKmLimit; verify `isApplicable = false` when `extraKmEnabled = false`
- **TEST-003**: Unit test `ExtraTimeModule.compute()` — verify 0 charge when no overtime; verify correct extra hour computation; verify `isApplicable = false` when `extraTimeEnabled = false`
- **TEST-004**: Unit test `GracePolicyModule.compute()` — verify grace minutes subtracted before extra-time calculation in AUTOMATIC mode; verify no effect when `gracePolicyEnabled = false`; verify MANUAL mode requires `applyGrace = true` in context
- **TEST-005**: Unit test `FuelDeficitModule.compute()` — verify deficit detected when return < pickup; verify 0 charge when levels equal; verify `isApplicable = false` when `fuelModuleEnabled = false`; verify validation error if deficit present and neither charge nor skip reason provided
- **TEST-006**: Unit test `FastagModule.compute()` — verify `isApplicable = false` when `fastagModuleEnabled = false`; verify `isApplicable = false` when `vehicle.hasFastag = false`; verify amount passed through when applicable
- **TEST-007**: Unit test `DamageModule.compute()` — verify only `status = APPROVED` damage reports are included; verify 0 when no approved reports
- **TEST-008**: Unit test `OverrideAdjusterModule.compute()` — verify waived amounts reduce `ChargeEntry.finalAmount`; verify `isOverridden = true` set on affected entries; verify `isApplicable = false` when `employeeOverrideEnabled = false`
- **TEST-009**: Integration test `ChargeEngineService.computeCharges()` — full booking scenario with all modules enabled; verify execution order; verify `ChargeBreakdown` totals match sum of individual results
- **TEST-010**: Integration test `freezeChargeConfig()` — verify snapshot is stored as JSON on booking at creation; verify booking update calls do not mutate `frozenChargeConfig`
- **TEST-011**: Integration test override flow — submit override → auto-approved path (below threshold) → verify `ChargeEntry.finalAmount` updated; submit override → pending-approval path (above threshold) → verify status = PENDING
- **TEST-012**: Integration test settlement — ADDITIONAL_PAYMENT scenario: verify `PaymentTransaction` created with correct `purpose` and amount; FULL_REFUND scenario: verify refund transaction created; PARTIAL_REFUND scenario: verify `RefundRequest` created
- **TEST-013**: Integration test concurrent update guard — submit two simultaneous settlement confirmations for same booking; verify second returns HTTP 409
- **TEST-014**: Integration test anomaly detection — create >N overrides by same employee; verify `StaffActivityLog` entry with `actionType: FLAGGED` is created
- **TEST-015**: Integration test `SafetyDepositRequest` approval flow — create request → manager approves → verify `PaymentTransaction` created with `purpose: SAFETY_DEPOSIT` and `booking.safetyDeposit` updated
- **TEST-016**: E2E test full rental lifecycle — booking creation → pickup (with fuel capture) → return (with all charges) → override → settlement → invoice — verify `ChargeEntry` records, `AuditLog` entries, and `Invoice` line items all consistent

---

## 7. Risks & Assumptions

- **RISK-001**: Existing `pricing-engine.service.ts` may have undiscovered callers that depend on charge computation logic. Refactoring it (TASK-035) requires a full codebase search (`grep -r "pricing-engine" apps/backend/src`) before modification.
- **RISK-002**: The existing employee pickup/return controllers may be a single monolithic controller file. Extending them (Phase 8, 10) without breaking existing functionality requires careful scoping.
- **RISK-003**: Prisma migration may require downtime if the production database has many existing booking records. Plan for a non-blocking migration (all new fields are nullable or have defaults).
- **RISK-004**: If `frozenChargeConfig` is null for existing bookings (pre-migration), the Charge Engine must handle this gracefully — default to all modules disabled or branch's current live config with a warning log.
- **RISK-005**: Anomaly detection threshold (TASK-067) is hardcoded initially. If not configurable, it may trigger false positives for high-volume branches. Recommendation: make it a `SystemSetting` or `BranchChargeConfig` field in a follow-up.

- **ASSUMPTION-001**: `VehicleCustomPricing` records already exist and are populated for all vehicles in production before this feature goes live.
- **ASSUMPTION-002**: The existing booking creation flow is a single transactional operation; `frozenChargeConfig` can be added to it without requiring a separate API call.
- **ASSUMPTION-003**: The frontend stack uses React with TypeScript, and the existing component patterns (form pages, modal dialogs, toggle switches) can be reused or extended for the new charge config and return flow UIs.
- **ASSUMPTION-004**: The `PaymentTransaction.purpose` enum values (`SAFETY_DEPOSIT`, `DAMAGE_FEE`) already exist in the schema (confirmed from codebase exploration) and do not require new migration entries.
- **ASSUMPTION-005**: Branch charge config is per-branch; there is no per-vehicle-category charge config in this iteration. Category-level overrides are out of scope.

---

## 8. Related Specifications / Further Reading

- [Discount System Implementation Plan](./feature-discount-system-1.md)
- [Payment & Cash Management Implementation Plan](./feature-payment-cash-management-1.md)
- [Rental Extension System Implementation Plan](./feature-rental-extension-system-1.md)
- [Staff Activity Log Implementation Plan](./feature-staff-activity-log-1.md)
- [Payment Cash Management UI Flows](./ui-payment-cash-management-flows.md)
