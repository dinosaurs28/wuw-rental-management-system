---
goal: Staff Activity Log Tracker — Rich Employee & Branch Manager Action Capture for VRMS
version: 1.0
date_created: 2026-03-22
last_updated: 2026-03-24
owner: Backend Team
status: 'Completed'
tags: [feature, staff, activity, audit, backend, database, migration]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

The current `StaffActivityLog` model captures only a staff member's internal user ID, an action string, and a basic entity reference. It has no human-readable name, no role, no branch context, no description, and uses internal IDs instead of public-facing identifiers. This makes the log unusable for branch managers and admins who need to inspect *who did what* in plain English.

This plan replaces the existing `StaffActivityLog` model with a fully de-normalised, richly structured activity tracker that captures: actor name, role, branch name, action type (enum), entity type (enum), the public-facing entity reference, and a human-readable description sentence. A centralised `StaffActivityService` with a `logFromRequest()` convenience method replaces all scattered inline `prisma.staffActivityLog.create()` calls and adds coverage to ~20 additional controller actions currently not tracked. Branch managers view their own branch; admins view all with a branch filter.

---

## 1. Requirements & Constraints

- **REQ-001**: Every `StaffActivityLog` entry must store `actorName` (human-readable full name, e.g. "Rahul Sharma") — never a bare user ID.
- **REQ-002**: Every entry must store `actorRole` using the existing Prisma `Role` enum (MANAGER or STAFF).
- **REQ-003**: Every entry must store `actorPublicId` — the public-facing string ID of the actor (from `req.public_Id`), NOT the internal integer ID.
- **REQ-004**: Every entry must store `branchId` (internal integer, for indexed filtering) AND `branchName` (human-readable, de-normalised for fast reads without joins).
- **REQ-005**: `actionType` must be a Prisma enum (`StaffActionType`) with values: CREATED, APPROVED, REJECTED, CANCELLED, CONFIRMED, UPDATED, DELETED, UPLOADED, SWAPPED, REFUNDED, ASSESSED, INITIATED, COMPLETED.
- **REQ-006**: `entityType` must be a Prisma enum (`StaffEntityType`) with values: BOOKING, INVOICE, PAYMENT, CUSTOMER, VEHICLE, KYC, DAMAGE_REPORT, DEPOSIT, EMPLOYEE, PRICING, CAPTURE_CONFIG.
- **REQ-007**: `entityRef` must always be the **public-facing** ID/code of the affected entity (e.g. `booking.publicId`, `vehicle.publicId`) — never an internal integer ID.
- **REQ-008**: `description` must be a complete human-readable sentence (e.g. "Rahul confirmed vehicle pickup for booking BK-2026-001").
- **REQ-009**: All `createdAt` timestamps must be stored in UTC.
- **REQ-010**: Branch managers may only retrieve activity logs where `branchId = req.branch_Id` (own branch only).
- **REQ-011**: Admins may retrieve activity logs across all branches with an optional `branchId` query filter.
- **REQ-012**: The `StaffActivityService.logFromRequest()` method must resolve actor name, role, and branch name from the DB using `req.public_Id` in a single query — callers must not make separate DB calls for this data.
- **REQ-013**: All existing `prisma.staffActivityLog.create()` inline calls must be replaced with `staffActivityService.logFromRequest()`.
- **REQ-014**: Activity logging must never block or throw errors visible to the client — wrap in fire-and-forget or silent catch.
- **SEC-001**: Branch managers must receive HTTP 403 if they attempt to access a log entry with a `branchId` different from their own.
- **SEC-002**: Admin endpoints must be protected by `AdminCheck` middleware.
- **SEC-003**: Branch manager endpoints must be protected by `ManagerCheck` middleware.
- **CON-001**: The Prisma migration must be additive where possible. The old `staffId` integer column is dropped; new columns use de-normalised strings for human-readable values (no FK joins required for reads).
- **CON-002**: The old `StaffActivityLog` relation on `Branch` (if any) must be updated to reflect the new model.
- **CON-003**: `StaffActionType` and `StaffEntityType` must be added to the explicit value export list in `packages/db/src/index.ts` (not just the `export type *` line) to avoid `isolatedModules` type-only errors — as learned from the AuditLog implementation.
- **GUD-001**: All activity log creation calls go through `StaffActivityService` — zero direct `prisma.staffActivityLog.create()` in controllers.
- **GUD-002**: Use `logFromRequest()` in all HTTP controllers. Use `log()` only in background jobs or services where no `req` object is available.
- **GUD-003**: `logFromRequest()` must be called after the main business operation succeeds — never before.
- **PAT-001**: Export service as a singleton: `export const staffActivityService = new StaffActivityService()`.
- **PAT-002**: Use `createID()` from `../../utils/nanoID.js` for `publicId` generation inside the service.
- **PAT-003**: Follow the same pattern established by `AuditService` — stateless class, singleton export, tx support.

---

## 2. Implementation Steps

### Implementation Phase 1 — Schema & Enum Updates

- **GOAL-001**: Add the two new Prisma enums and replace the `StaffActivityLog` model with the new rich model. Add Branch relation. Export new enums as runtime values.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `StaffActionType` enum to `packages/db/prisma/schema.prisma` with values: `CREATED`, `APPROVED`, `REJECTED`, `CANCELLED`, `CONFIRMED`, `UPDATED`, `DELETED`, `UPLOADED`, `SWAPPED`, `REFUNDED`, `ASSESSED`, `INITIATED`, `COMPLETED` | ✅ | 2026-03-24 |
| TASK-002 | Add `StaffEntityType` enum to `packages/db/prisma/schema.prisma` with values: `BOOKING`, `INVOICE`, `PAYMENT`, `CUSTOMER`, `VEHICLE`, `KYC`, `DAMAGE_REPORT`, `DEPOSIT`, `EMPLOYEE`, `PRICING`, `CAPTURE_CONFIG` | ✅ | 2026-03-24 |
| TASK-003 | Replace the existing `StaffActivityLog` model in `schema.prisma` with the new model (full schema block below). Remove `staffId Int` field. Add: `actorPublicId String`, `actorName String`, `actorRole Role`, `branchId Int`, `branchName String`, `actionType StaffActionType`, `entityType StaffEntityType`, `entityRef String`, `description String`, `metadata Json?`. Add relation `branch Branch @relation(fields: [branchId], references: [id])`. | ✅ | 2026-03-24 |
| TASK-004 | Update `Branch` model in `schema.prisma`: add `staffActivityLogs StaffActivityLog[]` relation. | ✅ | 2026-03-24 |
| TASK-005 | Add `StaffActionType` and `StaffEntityType` to the explicit `export { ... }` block in `packages/db/src/index.ts` (alongside existing enum exports like `Role`, `BookingStatus`, etc.) so they are available as runtime values, not just types. | ✅ | 2026-03-24 |
| TASK-006 | Run Prisma migration manually from `packages/db/` directory: `npx prisma migrate dev --name enhance_staff_activity_log`. Apply the migration. | ✅ | 2026-03-24 |
| TASK-007 | Run `npx prisma generate` from `packages/db/` to regenerate the Prisma client with updated types. | ✅ | 2026-03-24 |

**New StaffActivityLog schema block:**
```prisma
enum StaffActionType {
  CREATED
  APPROVED
  REJECTED
  CANCELLED
  CONFIRMED
  UPDATED
  DELETED
  UPLOADED
  SWAPPED
  REFUNDED
  ASSESSED
  INITIATED
  COMPLETED
}

enum StaffEntityType {
  BOOKING
  INVOICE
  PAYMENT
  CUSTOMER
  VEHICLE
  KYC
  DAMAGE_REPORT
  DEPOSIT
  EMPLOYEE
  PRICING
  CAPTURE_CONFIG
}

model StaffActivityLog {
  id            Int             @id @default(autoincrement())
  publicId      String          @unique

  // Actor (de-normalised — no join needed for reads)
  actorPublicId String
  actorName     String
  actorRole     Role

  // Branch (de-normalised)
  branchId      Int
  branchName    String

  // Action
  actionType    StaffActionType
  entityType    StaffEntityType
  entityRef     String
  description   String

  // Extra structured data
  metadata      Json?

  // UTC
  createdAt     DateTime        @default(now())

  branch        Branch          @relation(fields: [branchId], references: [id])

  @@index([branchId])
  @@index([actorPublicId])
  @@index([actionType])
  @@index([entityType])
  @@index([createdAt])
}
```

---

### Implementation Phase 2 — StaffActivityService

- **GOAL-002**: Create a centralised, reusable `StaffActivityService` with `log()` and `logFromRequest()`. All controllers will use `logFromRequest()` as the primary call site.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Create directory `apps/backend/src/services/staffActivity/`. Create `staffActivity.types.ts`. Export interface `CreateStaffActivityInput` with fields: `actorPublicId: string`, `actorName: string`, `actorRole: Role`, `branchId: number`, `branchName: string`, `actionType: StaffActionType`, `entityType: StaffEntityType`, `entityRef: string`, `description: string`, `metadata?: Record<string,any>`. | ✅ | 2026-03-24 |
| TASK-009 | Create `apps/backend/src/services/staffActivity/staffActivity.service.ts`. Implement class `StaffActivityService`. Implement `async log(input: CreateStaffActivityInput, tx?: PrismaTx): Promise<void>` — creates one row using `tx ?? prisma`. Implement `async logFromRequest(req: Request, input: Omit<CreateStaffActivityInput, 'actorPublicId'\|'actorName'\|'actorRole'\|'branchId'\|'branchName'>, tx?: PrismaTx): Promise<void>` — performs one DB call: `prisma.user.findUnique({ where: { publicId: req.public_Id }, select: { name: true, role: true, branch: { select: { name: true } } } })` then calls `this.log()`. Wrap entire `logFromRequest` in a try/catch that silently logs to `console.error` without rethrowing. Export singleton: `export const staffActivityService = new StaffActivityService()`. | ✅ | 2026-03-24 |
| TASK-010 | Inside `log()` in `staffActivity.service.ts`: generate `publicId` using `createID()`. Use `tx ?? prisma` for DB write. Set `branchId` and all de-normalised fields from input. | ✅ | 2026-03-24 |

---

### Implementation Phase 3 — Replace Existing Inline Calls (Employee Controllers)

- **GOAL-003**: Replace all existing `prisma.staffActivityLog.create()` inline calls in employee controllers with `staffActivityService.logFromRequest()`. Enrich each call with the new required fields.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Update `apps/backend/src/controller/employee/booking.controller.ts`: import `staffActivityService`. Replace existing `staffActivityLog.create({ action: 'CREATED_BOOKING' ... })` call with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CREATED, entityType: StaffEntityType.BOOKING, entityRef: booking.publicId, description: \`${actorName} created booking ${booking.publicId} for customer ${customerName}\` })`. Note: `actorName` and `customerName` are available from the DB response already fetched in the controller. | ✅ | 2026-03-24 |
| TASK-012 | Update `apps/backend/src/controller/employee/kyc.controller.ts`: Replace `KYC_APPROVED` log with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.APPROVED, entityType: StaffEntityType.KYC, entityRef: kyc.publicId, description: \`${actorName} approved KYC document for booking ${bookingRef}\` })`. Replace `KYC_REJECTED` log with same pattern using `StaffActionType.REJECTED` and description "rejected". | ✅ | 2026-03-24 |
| TASK-013 | Update `apps/backend/src/controller/employee/pickup.controller.ts`: Replace `VEHICLE_PICKUP` log with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CONFIRMED, entityType: StaffEntityType.BOOKING, entityRef: booking.publicId, description: \`${actorName} confirmed vehicle pickup for booking ${booking.publicId}\` })`. Replace `REQUESTED_MANAGER_CONFIRMATION` log with `StaffActionType.INITIATED` and description "requested manager approval for pickup of booking {ref}". | ✅ | 2026-03-24 |
| TASK-014 | Update `apps/backend/src/controller/employee/returnAction.controller.ts`: Replace `VEHICLE_RETURN` log with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.COMPLETED, entityType: StaffEntityType.BOOKING, entityRef: booking.publicId, description: \`${actorName} completed vehicle return for booking ${booking.publicId}\` })`. Replace `REQUESTED_MANAGER_CONFIRMATION_RETURN` log with `StaffActionType.INITIATED` and description "requested manager approval for return of booking {ref}". | ✅ | 2026-03-24 |
| TASK-015 | Update `apps/backend/src/controller/employee/damage.controller.ts`: Replace `CREATE_DAMAGE_REPORT` log with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CREATED, entityType: StaffEntityType.DAMAGE_REPORT, entityRef: damageReport.publicId, description: \`${actorName} created damage report for booking ${bookingRef}\`, metadata: { amount: damageReport.amount } })`. | ✅ | 2026-03-24 |
| TASK-016 | Update `apps/backend/src/controller/employee/walkin/initiate.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.INITIATED, entityType: StaffEntityType.CUSTOMER, entityRef: customer.publicId, description: \`${actorName} initiated walk-in for customer ${phone}\` })` after successful walkin initiation. | ✅ | 2026-03-24 |
| TASK-017 | Update `apps/backend/src/controller/employee/walkin/kyc.controller.ts`: Replace `WALKIN_KYC_UPLOAD` / `WALKIN_KYC_UPDATE` log with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.UPLOADED, entityType: StaffEntityType.KYC, entityRef: kyc.publicId, description: \`${actorName} uploaded KYC document for walk-in customer ${customerRef}\` })`. Replace `WALKIN_KYC_APPROVED` / `WALKIN_KYC_REJECTED` logs with `StaffActionType.APPROVED` / `StaffActionType.REJECTED` and appropriate description. | ✅ | 2026-03-24 |

---

### Implementation Phase 4 — Add New Tracking to Branch Manager Controllers

- **GOAL-004**: Replace existing inline `staffActivityLog.create()` calls in branch manager controllers and add new `staffActivityService.logFromRequest()` calls to all currently-untracked manager actions.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Update `apps/backend/src/controller/branchManager/bookings.controller.ts`: Replace `MANAGER_CONFIRMED_PICKUP` log with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CONFIRMED, entityType: StaffEntityType.BOOKING, entityRef: booking.publicId, description: \`${actorName} confirmed vehicle pickup for booking ${booking.publicId}\` })`. | ✅ | 2026-03-24 |
| TASK-019 | Update `apps/backend/src/controller/branchManager/bookings.controller.ts`: Replace `MANAGER_CONFIRMED_RETURN` log with `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CONFIRMED, entityType: StaffEntityType.BOOKING, entityRef: booking.publicId, description: \`${actorName} confirmed vehicle return for booking ${booking.publicId}\` })`. | ✅ | 2026-03-24 |
| TASK-020 | Update `apps/backend/src/controller/branchManager/bookings.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CANCELLED, entityType: StaffEntityType.BOOKING, entityRef: booking.publicId, description: \`${actorName} cancelled booking ${booking.publicId} due to no-show\`, metadata: { reason } })` in `CancelNoShow` handler. | ✅ | 2026-03-24 |
| TASK-021 | Update `apps/backend/src/controller/branchManager/bookings.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CREATED, entityType: StaffEntityType.DEPOSIT, entityRef: booking.publicId, description: \`${actorName} collected safety deposit of ₹${amount} for booking ${booking.publicId}\`, metadata: { amount, method } })` in `CollectSafetyDeposit` handler. | ✅ | 2026-03-24 |
| TASK-022 | Update `apps/backend/src/controller/branchManager/bookings.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.REFUNDED, entityType: StaffEntityType.DEPOSIT, entityRef: booking.publicId, description: \`${actorName} processed deposit refund for booking ${booking.publicId}\`, metadata: { amount, method } })` in `RefundDeposit` handler. | ✅ | 2026-03-24 |
| TASK-023 | Update `apps/backend/src/controller/branchManager/bookings.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.ASSESSED, entityType: StaffEntityType.PAYMENT, entityRef: booking.publicId, description: \`${actorName} calculated final billing for booking ${booking.publicId}\`, metadata: { totalBill } })` in `CalculateFinalBilling` handler. | ✅ | 2026-03-24 |
| TASK-024 | Update `apps/backend/src/controller/branchManager/vehicle-swap.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.SWAPPED, entityType: StaffEntityType.VEHICLE, entityRef: booking.publicId, description: \`${actorName} swapped vehicle in booking ${booking.publicId} — reason: ${reason}\`, metadata: { originalVehicleId, newVehicleId, reason } })` in `SwapVehicle` handler after successful swap. | ✅ | 2026-03-24 |
| TASK-025 | Update `apps/backend/src/controller/branchManager/damage.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.COMPLETED, entityType: StaffEntityType.DAMAGE_REPORT, entityRef: damageReport.publicId, description: \`${actorName} closed damage report ${damageReport.publicId}\` })` in `CloseDamageReport` handler. | ✅ | 2026-03-24 |
| TASK-026 | Update `apps/backend/src/controller/branchManager/damage.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.UPDATED, entityType: StaffEntityType.DAMAGE_REPORT, entityRef: damageReport.publicId, description: \`${actorName} updated charge type on damage report ${damageReport.publicId}\`, metadata: { chargeType } })` in `UpdateDamageChargeType` handler. | ✅ | 2026-03-24 |
| TASK-027 | Update `apps/backend/src/controller/branchManager/employee.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CREATED, entityType: StaffEntityType.EMPLOYEE, entityRef: employee.publicId, description: \`${actorName} created employee account for ${employee.name}\` })` in `CreateEmployee` handler. | ✅ | 2026-03-24 |
| TASK-028 | Update `apps/backend/src/controller/branchManager/employee.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.UPDATED, entityType: StaffEntityType.EMPLOYEE, entityRef: employee.publicId, description: \`${actorName} updated employee ${employee.name}\` })` in `UpdateEmployee` handler. | ✅ | 2026-03-24 |
| TASK-029 | Update `apps/backend/src/controller/branchManager/employee.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.DELETED, entityType: StaffEntityType.EMPLOYEE, entityRef: employee.publicId, description: \`${actorName} deactivated employee ${employee.name}\` })` in `DeleteEmployee` handler. | ✅ | 2026-03-24 |
| TASK-030 | Update `apps/backend/src/controller/branchManager/vehicle.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.CREATED, entityType: StaffEntityType.VEHICLE, entityRef: vehicle.publicId, description: \`${actorName} added vehicle ${make} ${model} (${plate})\`, metadata: { make, model, plate } })` in `AddVehicle` handler. | ✅ | 2026-03-24 |
| TASK-031 | Update `apps/backend/src/controller/branchManager/vehicle.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.UPDATED, entityType: StaffEntityType.VEHICLE, entityRef: vehicle.publicId, description: \`${actorName} updated vehicle ${make} ${model}\` })` in `EditVehicle` handler. | ✅ | 2026-03-24 |
| TASK-032 | Update `apps/backend/src/controller/branchManager/vehicle.controller.ts`: Add `staffActivityService.logFromRequest(req, { actionType: StaffActionType.DELETED, entityType: StaffEntityType.VEHICLE, entityRef: vehiclePublicId, description: \`${actorName} removed vehicle ${vehiclePublicId}\` })` in `DeleteVehicle` handler. | ✅ | 2026-03-24 |
| TASK-033 | Update `apps/backend/src/controller/branchManager/pricing.controller.ts`: Add `logFromRequest` calls in `CreateDiscount` (CREATED/PRICING), `UpdateDiscount` (UPDATED/PRICING), `DeleteDiscount` (DELETED/PRICING). Use `slab.publicId` as `entityRef`. Description: "{name} created/updated/deleted pricing rule". | ✅ | 2026-03-24 |
| TASK-034 | Update `apps/backend/src/controller/branchManager/deposit.controller.ts`: Add `logFromRequest` calls in `CreateDepositRule` (CREATED/DEPOSIT), `UpdateDepositRule` (UPDATED/DEPOSIT), `DeleteDepositRule` (DELETED/DEPOSIT). Use `rule.publicId` as `entityRef`. Description: "{name} created/updated/deleted deposit rule". | ✅ | 2026-03-24 |
| TASK-035 | Update `apps/backend/src/controller/branchManager/captureConfig.controller.ts`: Add `logFromRequest` calls in `CreateCaptureConfig` (CREATED/CAPTURE_CONFIG), `UpdateCaptureConfig` (UPDATED/CAPTURE_CONFIG), `DeleteCaptureConfig` (DELETED/CAPTURE_CONFIG). Use `config.publicId` as `entityRef`. Description: "{name} created/updated/deleted photo capture config". | ✅ | 2026-03-24 |

---

### Implementation Phase 5 — API Endpoints

- **GOAL-005**: Create branch manager and admin endpoints to retrieve, filter, and paginate staff activity logs. Remove old retrieval endpoint backed by `staffActivityLog.findMany({ where: { staffId } })`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-036 | Create `apps/backend/src/controller/branchManager/staffActivity.controller.ts`. Implement `GetBranchStaffActivity`: query `StaffActivityLog` where `branchId = req.branch_Id`. Support query params: `page` (default 1), `limit` (default 20), `startDate` (UTC ISO string → `new Date()`), `endDate` (UTC ISO string → `new Date()`), `actorPublicId`, `actionType` (validate against `StaffActionType` enum values), `entityType` (validate against `StaffEntityType` enum values). Return `{ message, data, pagination: { total, page, limit, totalPages } }`. Cache with Redis key `staff_activity:branch:${branchId}:${md5(JSON.stringify(req.query))}` TTL 60s. | ✅ | 2026-03-24 |
| TASK-037 | Implement `GetBranchStaffActivityById` in the same file: fetch single `StaffActivityLog` by `publicId`, verify `log.branchId === req.branch_Id`, return HTTP 403 if mismatch. | ✅ | 2026-03-24 |
| TASK-038 | Create `apps/backend/src/controller/admin/staffActivity.controller.ts`. Implement `GetAdminStaffActivity`: no branch restriction. Support all filters from TASK-036 plus `branchId` (maps to `whereCondition.branchId = parseInt(branchId)`). Return paginated response. | ✅ | 2026-03-24 |
| TASK-039 | Implement `GetAdminStaffActivityById` in the same admin controller file: fetch single log by `publicId` with no branch restriction. | ✅ | 2026-03-24 |
| TASK-040 | Create `apps/backend/src/routes/admin/staffActivity.routes.ts`. Define: `GET /logs` → `AdminCheck`, `GetAdminStaffActivity`; `GET /logs/:publicId` → `AdminCheck`, `GetAdminStaffActivityById`. Export default router. | ✅ | 2026-03-24 |
| TASK-041 | Register staff activity router in `apps/backend/src/routes/admin/admin.routes.ts`: add `import staffActivityRouter from './staffActivity.routes.js'` and `router.use('/staff-activity', staffActivityRouter)`. | ✅ | 2026-03-24 |
| TASK-042 | Update `apps/backend/src/routes/branchManger/branchManager.routes.ts`: import `GetBranchStaffActivity`, `GetBranchStaffActivityById` from `../../controller/branchManager/staffActivity.controller.js`. Add routes: `GET /dashboard/staff/activity` → `ManagerCheck`, `GetBranchStaffActivity`; `GET /dashboard/staff/activity/:publicId` → `ManagerCheck`, `GetBranchStaffActivityById`. Keep old `GET /dashboard/staff/activity-logs` pointing to `GetStaffAuditLogs` (AuditLog endpoint) for backward compatibility — do NOT remove it. | ✅ | 2026-03-24 |

---

### Implementation Phase 6 — Validation & Cleanup

- **GOAL-006**: Verify TypeScript compiles cleanly, confirm no remaining direct `prisma.staffActivityLog.create()` calls exist, and ensure all controller imports are correct.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-043 | Run `npx tsc --noEmit` from `apps/backend/` and fix any type errors introduced by this implementation. Pre-existing errors in `captureConfig.controller.ts`, `remainingPayment.controller.ts`, `invoice-data-transformer.ts` are known and are not in scope. | ✅ | 2026-03-24 |
| TASK-044 | Run `grep -r "prisma.staffActivityLog.create" apps/backend/src/` to verify zero remaining inline calls. All must be replaced. | ✅ | 2026-03-24 |
| TASK-045 | Verify Redis cache key prefix `staff_activity:branch:*` does not conflict with existing `audit_logs:*` or `audit:branch:*` keys used by `AuditLog` endpoints. | ✅ | 2026-03-24 |
| TASK-046 | Test `GET /dashboard/staff/activity` with no filters — verify paginated response includes `actorName`, `actorRole`, `branchName`, `actionType`, `entityType`, `entityRef`, `description`, `createdAt` (UTC). | | |
| TASK-047 | Test `GET /dashboard/staff/activity?actionType=CONFIRMED&entityType=BOOKING` — verify only matching records returned, all with `branchId = req.branch_Id`. | | |
| TASK-048 | Test `GET /dashboard/staff/activity?startDate=2026-01-01T00:00:00Z&endDate=2026-01-31T23:59:59Z` — verify `createdAt` on all returned records falls within UTC range. | | |
| TASK-049 | Test `GET /admin/staff-activity/logs?branchId=2` — verify only logs from branch 2 are returned, accessible by admin only. | | |
| TASK-050 | Test `GET /dashboard/staff/activity/:publicId` where `publicId` belongs to a different branch — verify HTTP 403 response. | | |

---

## 3. Alternatives

- **ALT-001**: **Keep `staffId` FK, join on read** — keep the existing integer `staffId` reference and join to `User` + `Branch` at query time to get name and branch name. Rejected because it adds two joins to every read query and the audit log table will grow large. De-normalising name + branch name at write time is standard for audit/activity tables.
- **ALT-002**: **Add actor name/role to JWT** — embed `name` and `role` into the JWT so middleware can populate `req.name` and `req.role` without a DB lookup. Partially viable but rejected because (a) names can change and stale JWTs would log wrong names, (b) it changes the auth contract and requires frontend token refresh. The single DB lookup in `logFromRequest()` is acceptable.
- **ALT-003**: **Async queue for activity logging** — fire logs to a Redis queue and process them with a background worker to avoid any latency impact. Rejected as over-engineered for current scale; the silent try/catch in `logFromRequest()` already ensures logging never blocks the HTTP response.
- **ALT-004**: **Extend AuditLog instead of separate StaffActivityLog** — merge all tracking into the AuditLog table with `category = STAFF`. Rejected because AuditLog is designed for system-wide security auditing with before/after diffs. StaffActivityLog is an operational activity feed for managers to monitor their team — different audience, different schema needs, different retention/display requirements.
- **ALT-005**: **Store `actorId` (internal integer) alongside `actorPublicId`** — keep both IDs. Rejected to avoid bloat; `actorPublicId` is sufficient for all UI display and cross-reference needs, and `actorName` removes the need to ever look up the actor for display.

---

## 4. Dependencies

- **DEP-001**: `@prisma/client` — provides auto-generated `StaffActivityLog`, `StaffActionType`, `StaffEntityType` types after migration and `prisma generate`.
- **DEP-002**: `packages/db/src/index.ts` — must export `StaffActionType` and `StaffEntityType` as runtime values (not just types) to avoid `isolatedModules` compilation errors.
- **DEP-003**: `prisma` singleton from `packages/db/src/index.ts` — used by `StaffActivityService` for DB writes.
- **DEP-004**: `createID()` from `apps/backend/src/utils/nanoID.ts` — used inside `StaffActivityService.log()` to generate `publicId`.
- **DEP-005**: `ioredis` / `redis` client from `apps/backend/src/lib/redisconfig.ts` — used in retrieval controllers for response caching.
- **DEP-006**: Express `Request` type with `req.public_Id: string` and `req.branch_Id: number` — set by `EmployeeCheck` and `ManagerCheck` middlewares and declared globally in existing middleware files.

---

## 5. Files

**New files to create:**
- **FILE-001**: `apps/backend/src/services/staffActivity/staffActivity.types.ts` — `CreateStaffActivityInput` interface.
- **FILE-002**: `apps/backend/src/services/staffActivity/staffActivity.service.ts` — `StaffActivityService` class with `log()` and `logFromRequest()`. Singleton export `staffActivityService`.
- **FILE-003**: `apps/backend/src/controller/branchManager/staffActivity.controller.ts` — `GetBranchStaffActivity`, `GetBranchStaffActivityById`.
- **FILE-004**: `apps/backend/src/controller/admin/staffActivity.controller.ts` — `GetAdminStaffActivity`, `GetAdminStaffActivityById`.
- **FILE-005**: `apps/backend/src/routes/admin/staffActivity.routes.ts` — Admin staff activity routes.

**Files to modify:**
- **FILE-006**: `packages/db/prisma/schema.prisma` — Add `StaffActionType`, `StaffEntityType` enums. Replace `StaffActivityLog` model. Add `Branch` relation.
- **FILE-007**: `packages/db/src/index.ts` — Add `StaffActionType`, `StaffEntityType` to explicit value exports.
- **FILE-008**: `apps/backend/src/controller/employee/booking.controller.ts` — Replace inline log, import `staffActivityService`.
- **FILE-009**: `apps/backend/src/controller/employee/kyc.controller.ts` — Replace inline logs.
- **FILE-010**: `apps/backend/src/controller/employee/pickup.controller.ts` — Replace inline logs.
- **FILE-011**: `apps/backend/src/controller/employee/returnAction.controller.ts` — Replace inline logs.
- **FILE-012**: `apps/backend/src/controller/employee/damage.controller.ts` — Replace inline log.
- **FILE-013**: `apps/backend/src/controller/employee/walkin/initiate.controller.ts` — Add new log call.
- **FILE-014**: `apps/backend/src/controller/employee/walkin/kyc.controller.ts` — Replace inline logs.
- **FILE-015**: `apps/backend/src/controller/branchManager/bookings.controller.ts` — Replace + add 6 log calls.
- **FILE-016**: `apps/backend/src/controller/branchManager/vehicle-swap.controller.ts` — Add log call.
- **FILE-017**: `apps/backend/src/controller/branchManager/damage.controller.ts` — Add 2 log calls.
- **FILE-018**: `apps/backend/src/controller/branchManager/employee.controller.ts` — Add 3 log calls.
- **FILE-019**: `apps/backend/src/controller/branchManager/vehicle.controller.ts` — Add 3 log calls.
- **FILE-020**: `apps/backend/src/controller/branchManager/pricing.controller.ts` — Add 3 log calls.
- **FILE-021**: `apps/backend/src/controller/branchManager/deposit.controller.ts` — Add 3 log calls.
- **FILE-022**: `apps/backend/src/controller/branchManager/captureConfig.controller.ts` — Add 3 log calls.
- **FILE-023**: `apps/backend/src/routes/branchManger/branchManager.routes.ts` — Add 2 new activity routes.
- **FILE-024**: `apps/backend/src/routes/admin/admin.routes.ts` — Register `staffActivityRouter`.

---

## 6. Testing

- **TEST-001**: Call `staffActivityService.log()` with all required fields. Verify a `StaffActivityLog` row is created with correct `actorName`, `actorPublicId`, `actorRole`, `branchName`, `actionType`, `entityType`, `entityRef`, `description`, and UTC `createdAt`.
- **TEST-002**: Call `staffActivityService.logFromRequest()` with a mock `req` where `req.public_Id` matches a known User in DB. Verify the row's `actorName` and `branchName` are correctly resolved from the DB lookup.
- **TEST-003**: Call `staffActivityService.logFromRequest()` where `req.public_Id` does not match any User. Verify the call does NOT throw and does NOT crash the caller — error is silently caught.
- **TEST-004**: `GET /dashboard/staff/activity` with no filters — verify response shape has `data[]` with `actorName`, `branchName`, `actionType`, `entityType`, `entityRef`, `description`, `createdAt`. Verify `pagination.total` matches DB count.
- **TEST-005**: `GET /dashboard/staff/activity?actionType=CONFIRMED` — verify all returned records have `actionType: "CONFIRMED"`.
- **TEST-006**: `GET /dashboard/staff/activity?entityType=BOOKING&actorPublicId=<id>` — verify all records match both filters and all have `branchId` matching the requesting manager's branch.
- **TEST-007**: `GET /dashboard/staff/activity/:publicId` where `publicId` belongs to a different branch — verify HTTP 403.
- **TEST-008**: `GET /admin/staff-activity/logs?branchId=2` — verify only logs with `branchId = 2` are returned and the endpoint returns HTTP 403 for non-admin callers.
- **TEST-009**: Trigger `CreateEmployee` in a branch manager controller. Verify a `StaffActivityLog` row is created with `actionType: CREATED`, `entityType: EMPLOYEE`, `entityRef: employee.publicId`, and `actorName` matching the manager's name.
- **TEST-010**: Trigger `ConfirmPickupWithDeposit` in a branch manager controller. Verify both a `StaffActivityLog` row (CONFIRMED/BOOKING) and any existing `AuditLog` row are created — confirm the two systems are independent.
- **TEST-011**: Run `npx tsc --noEmit` from `apps/backend/` — verify zero type errors introduced by this implementation (pre-existing errors excluded).
- **TEST-012**: Run `grep -r "prisma.staffActivityLog.create" apps/backend/src/` — verify zero results (all inline calls replaced).

---

## 7. Risks & Assumptions

- **RISK-001**: The `logFromRequest()` DB lookup (one `user.findUnique` per request) adds a small DB read on every tracked action. Mitigation: the query uses a unique index on `publicId` so it is O(1). If high-frequency actions become a bottleneck, the actor context can be added to the JWT claims in a future iteration (ALT-002 above).
- **RISK-002**: The `StaffActivityLog` migration drops the `staffId Int` column. Any existing rows will lose this FK. Mitigation: these are dev/seed rows only; the column is not user-visible data. Accept data loss for this column during migration.
- **RISK-003**: `StaffActionType` and `StaffEntityType` are new enums. If not added to the `export {}` block in `packages/db/src/index.ts`, they will be type-only and runtime enum usage (`StaffActionType.CREATED`) will fail at compile time with TS1362. This is the same issue encountered during the AuditLog implementation. Mitigation: TASK-005 explicitly covers this.
- **RISK-004**: Redis cache at TTL 60s may serve stale activity logs if a new entry is written and the manager immediately refreshes. Mitigation: this is acceptable for an activity feed (near-real-time is sufficient). If real-time is needed later, set TTL to 10s or implement cache invalidation on write.
- **RISK-005**: `logFromRequest()` is fire-and-forget (silent catch). If the DB write fails, the activity is silently lost. Mitigation: log the error to `console.error` for observability. A dead-letter retry queue can be added in a future iteration if data completeness is critical.
- **ASSUMPTION-001**: `req.public_Id` is always set (non-null) by the time any employee or manager controller function is reached, because `EmployeeCheck` / `ManagerCheck` middleware runs first.
- **ASSUMPTION-002**: `req.branch_Id` is always set and corresponds to a valid `Branch` row in the DB (enforced by middleware token validation).
- **ASSUMPTION-003**: The `User` model's `branch` relation is already loaded or loadable via `prisma.user.findUnique({ where: { publicId }, select: { name, role, branch: { select: { name } } } })` — the `Branch` relation exists on `User` via the `branchId` FK.
- **ASSUMPTION-004**: All controllers have access to the relevant `publicId` of the entity they operate on (booking.publicId, vehicle.publicId, etc.) at the point where `logFromRequest()` is called — either from the DB response or from request params.
- **ASSUMPTION-005**: The old `GET /dashboard/staff/activity-logs` endpoint (backed by `AuditLog`) remains for backward compatibility and is not removed by this plan.

---

## 8. Related Specifications / Further Reading

- Enhanced Audit Logs plan: `plan/feature-audit-logs-enhanced-1.md`
- Prisma schema: `packages/db/prisma/schema.prisma`
- DB package exports: `packages/db/src/index.ts`
- AuditService reference implementation: `apps/backend/src/services/audit/audit.service.ts`
- EmployeeCheck middleware: `apps/backend/src/middlewares/employeeCheck.middlewares.ts`
- ManagerCheck middleware: `apps/backend/src/middlewares/managerCheck.middlewares.ts`
- [Prisma Indexes Documentation](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes)
