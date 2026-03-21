---
goal: Enhanced Audit Logs System for VRMS — Full Actor, Action, Context, Data & Metadata Capture
version: 1.0
date_created: 2026-03-22
last_updated: 2026-03-22
owner: Backend Team
status: 'In progress'
tags: [feature, audit, backend, database, migration, security]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

The current audit log system in VRMS captures only a minimal snapshot of activity — actor ID, action name, entity type, entity ID, and optional before/after JSON. It was built as a stopgap when the project had no formal audit requirements. Now that admins and branch managers need to inspect both customer and employee activity with accountability, the system must be redesigned.

This plan upgrades the `AuditLog` model and its surrounding infrastructure to capture six structured dimensions on every event: **Identity & Actor**, **Action Details**, **Context**, **Data Changes**, **Metadata**, and **UTC Timestamps**. A centralized `AuditService` replaces all scattered inline `prisma.auditLog.create()` calls, ensuring consistency. New API endpoints expose filtered, paginated audit data to branch managers and admins.

---

## 1. Requirements & Constraints

- **REQ-001**: Every audit log entry must capture actor identity: `actorId`, `actorName`, `actorRole`, `actorBranchId`.
- **REQ-002**: For customer-initiated actions processed by staff, the system must capture the approving staff member via `approverId`, `approverName`, `approverRole`.
- **REQ-003**: Every entry must have a human-readable `description` string alongside the machine-readable `action` enum.
- **REQ-004**: Every entry must belong to a domain `category` (BOOKING, PAYMENT, VEHICLE, CUSTOMER, EMPLOYEE, BRANCH, AUTH, SYSTEM).
- **REQ-005**: Every entry must have a `severity` level (INFO, WARNING, CRITICAL) defaulting to INFO.
- **REQ-006**: Context fields `ipAddress`, `userAgent`, `requestId` must be captured on all HTTP-triggered audit events.
- **REQ-007**: `before` and `after` JSON fields must be retained. A `changedFields` string array must list the top-level keys that differ between before and after states.
- **REQ-008**: All `createdAt` timestamps must be stored in UTC (Prisma default behaviour with `@default(now())`).
- **REQ-009**: An `entityLabel` field must provide a human-readable label for the entity (e.g., booking number, vehicle plate).
- **REQ-010**: The `AuditService` must support Prisma transaction clients (`tx`) so audit log creation is atomic with the business operation.
- **REQ-011**: Branch managers can view audit logs scoped to their branch only.
- **REQ-012**: Admins can view audit logs across all branches with cross-branch filtering.
- **REQ-013**: Audit logs must never be deleted or mutated after creation (append-only).
- **SEC-001**: Branch managers must not be able to query audit logs from other branches.
- **CON-001**: The migration must be additive — existing `AuditLog` rows must not be deleted or break. New required columns must have safe defaults or be nullable.
- **CON-002**: The existing `userId` column on `AuditLog` is replaced by `actorId`. A migration must rename/re-map this column without data loss.
- **CON-003**: No breaking changes to the existing branch manager audit endpoint URL (`/dashboard/staff/activity-logs`) until frontend is updated.
- **GUD-001**: All audit creation calls must go through `AuditService.log()` — no direct `prisma.auditLog.create()` in controllers or services.
- **GUD-002**: `AuditService` must be stateless and importable from any service, controller, or background job.
- **PAT-001**: Follow existing service file pattern — class-based service exported as a singleton instance.
- **PAT-002**: Use `createID()` utility for `publicId` generation, consistent with the rest of the codebase.

---

## 2. Implementation Steps

### Implementation Phase 1 — Schema & Migration

- **GOAL-001**: Update the Prisma schema with the enhanced `AuditLog` model and run a non-destructive migration.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `AuditCategory` enum to `packages/db/prisma/schema.prisma` with values: `BOOKING`, `PAYMENT`, `VEHICLE`, `CUSTOMER`, `EMPLOYEE`, `BRANCH`, `AUTH`, `SYSTEM` | | |
| TASK-002 | Add `AuditSeverity` enum to `packages/db/prisma/schema.prisma` with values: `INFO`, `WARNING`, `CRITICAL` | | |
| TASK-003 | Replace the existing `AuditLog` model in `schema.prisma` with the new model (see schema below). Keep `before`, `after` as nullable `Json`. Add new fields: `actorId`, `actorName`, `actorRole`, `actorBranchId`, `approverId`, `approverName`, `approverRole`, `category`, `severity`, `description`, `entityLabel`, `ipAddress`, `userAgent`, `requestId`, `changedFields`. Remove old `userId` field and replace with `actorId`. | | |
| TASK-004 | Update `User` model in `schema.prisma` to add two named relations for the new `AuditLog` relations: `actorAuditLogs AuditLog[] @relation("ActorAuditLogs")` and `approverAuditLogs AuditLog[] @relation("ApproverAuditLogs")`. Remove the old unnamed `auditLogs` relation. | | |
| TASK-005 | Update `Branch` model in `schema.prisma` to add relation: `auditLogs AuditLog[]` | | |
| TASK-006 | Run `npx prisma migrate dev --name enhance_audit_logs` from `packages/db/` to generate and apply the migration. Verify migration file is created in `packages/db/prisma/migrations/`. | | |
| TASK-007 | Run `npx prisma generate` to regenerate the Prisma client with updated types. | | |

**New AuditLog schema block:**
```prisma
enum AuditCategory {
  BOOKING
  PAYMENT
  VEHICLE
  CUSTOMER
  EMPLOYEE
  BRANCH
  AUTH
  SYSTEM
}

enum AuditSeverity {
  INFO
  WARNING
  CRITICAL
}

model AuditLog {
  id            Int           @id @default(autoincrement())
  publicId      String        @unique

  // Identity & Actor
  actorId       Int
  actorName     String
  actorRole     Role
  actorBranchId Int?

  // Approver (staff who processed a customer-initiated action)
  approverId    Int?
  approverName  String?
  approverRole  Role?

  // Action Details
  action        String
  category      AuditCategory
  severity      AuditSeverity @default(INFO)
  description   String

  // Entity
  entity        String
  entityId      String
  entityLabel   String?

  // Context (HTTP request info)
  ipAddress     String?
  userAgent     String?
  requestId     String?

  // Data Changes
  before        Json?
  after         Json?
  changedFields String[]

  // Domain-specific extra data
  metadata      Json?

  // Timestamps (UTC)
  createdAt     DateTime      @default(now())

  actor         User          @relation("ActorAuditLogs", fields: [actorId], references: [id])
  approver      User?         @relation("ApproverAuditLogs", fields: [approverId], references: [id])
  actorBranch   Branch?       @relation(fields: [actorBranchId], references: [id])
}
```

---

### Implementation Phase 2 — AuditService

- **GOAL-002**: Create a centralized, reusable `AuditService` that all callers use to create audit log entries.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Create `apps/backend/src/services/audit/audit.types.ts`. Define and export: `CreateAuditLogInput` interface (all fields from the schema), `AuditCategory` re-export from `@prisma/client`, `AuditSeverity` re-export from `@prisma/client`. | | |
| TASK-009 | Create `apps/backend/src/services/audit/audit.service.ts`. Implement class `AuditService` with: (1) `async log(input: CreateAuditLogInput, tx?: PrismaTransactionClient): Promise<void>` — creates one audit log using `tx ?? prisma`; (2) `async logBatch(inputs: CreateAuditLogInput[], tx?: PrismaTransactionClient): Promise<void>` — creates many using `createMany`; (3) `private computeChangedFields(before?: Record<string,any>, after?: Record<string,any>): string[]` — returns keys where values differ between before and after objects. Export singleton: `export const auditService = new AuditService()`. | | |
| TASK-010 | In `audit.service.ts`, auto-compute `changedFields` inside `log()`: if caller does not supply `changedFields` but supplies both `before` and `after`, call `computeChangedFields(before, after)` and set it. | | |
| TASK-011 | In `audit.service.ts`, generate `publicId` using `createID()` inside `log()` so callers never need to supply it. | | |

**AuditService interface reference:**
```typescript
// audit.types.ts
export interface CreateAuditLogInput {
  actorId: number
  actorName: string
  actorRole: Role
  actorBranchId?: number
  approverId?: number
  approverName?: string
  approverRole?: Role
  action: string
  category: AuditCategory
  severity?: AuditSeverity       // defaults to INFO
  description: string
  entity: string
  entityId: string
  entityLabel?: string
  ipAddress?: string
  userAgent?: string
  requestId?: string
  before?: Record<string, any>
  after?: Record<string, any>
  changedFields?: string[]       // auto-computed if omitted
  metadata?: Record<string, any>
}
```

---

### Implementation Phase 3 — Migrate Existing Inline Audit Calls

- **GOAL-003**: Replace all scattered `prisma.auditLog.create()` calls with `auditService.log()`. Enrich each call with the new required fields.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Update `apps/backend/src/services/booking/advance-deposit.service.ts` — replace `RECORD_ADVANCE_PAYMENT` audit call. Add: `actorName`, `actorRole`, `actorBranchId`, `category: AuditCategory.PAYMENT`, `description: "Advance payment of ₹{amount} recorded for booking {bookingId}"`, `after: { advanceAmount, advancePaidAt, status }`. Fetch actor user details from DB before creating the log. | | |
| TASK-013 | Update `apps/backend/src/services/booking/advance-deposit.service.ts` — replace `RECORD_SAFETY_DEPOSIT`, `REFUND_SAFETY_DEPOSIT`, `CANCEL_BOOKING_NO_SHOW`, `REMAINING_PAYMENT_COLLECTED_AT_PICKUP`, `REMAINING_PAYMENT_COLLECTED_AT_RETURN` audit calls using `AuditCategory.PAYMENT` or `AuditCategory.BOOKING` as appropriate. | | |
| TASK-014 | Update `apps/backend/src/controller/payment/checkPayment.controller.ts` — replace `BOOKING_CONFIRMED` and `BOOKING_CONFIRMED_ADVANCE` audit calls. Category: `PAYMENT`. Add `ipAddress: req.ip`, `userAgent: req.headers['user-agent']`. | | |
| TASK-015 | Update `apps/backend/src/controller/payment/checkPaymentForCash.controller.ts` — replace audit calls. Category: `PAYMENT`. Add IP and user agent from `req`. | | |
| TASK-016 | Update `apps/backend/src/services/vehicle-swap/vehicle-swap.service.ts` — replace `VEHICLE_SWAP` audit call. Category: `AuditCategory.VEHICLE`. Keep `metadata: { originalVehicleId, newVehicleId, reason, markOriginalForMaintenance }`. Add `description: "Vehicle swapped from {originalVehicleId} to {newVehicleId} for booking {bookingId}"`. | | |
| TASK-017 | Update `apps/backend/src/jobs/bookingExpiry.worker.ts` — replace `HOLD_EXPIRED` audit call. Category: `AuditCategory.SYSTEM`. Actor: use a system user ID (define `SYSTEM_USER_ID` constant) or the booking's `createdById`. Set `severity: AuditSeverity.WARNING`. | | |

---

### Implementation Phase 4 — New Audit Events

- **GOAL-004**: Add audit log entries for business events that are currently not logged at all.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Add `BOOKING_CREATED` audit log in the booking creation controller/service. Category: `BOOKING`. Actor: customer. Description: "Booking created for vehicle {vehicleId} from {startDate} to {endDate}". | | |
| TASK-019 | Add `BOOKING_CHECKED_IN` audit log when vehicle is handed over to customer at pickup. Category: `BOOKING`. Actor: staff who performed check-in. Severity: `INFO`. | | |
| TASK-020 | Add `BOOKING_CHECKED_OUT` audit log when vehicle is returned by customer. Category: `BOOKING`. Actor: staff who processed return. Include `metadata: { odometerReturn, fuelLevelReturn }` if available. | | |
| TASK-021 | Add `BOOKING_CANCELLED` audit log wherever booking cancellation is handled. Category: `BOOKING`. Include `metadata: { reason, cancelledBy }`. Severity: `WARNING`. | | |
| TASK-022 | Add `DAMAGE_COST_ASSESSED` audit log in the damage cost service/controller. Category: `PAYMENT`. Include `metadata: { damageDescription, amount }`. Severity: `WARNING`. | | |
| TASK-023 | Add `LOGIN_SUCCESS` and `LOGIN_FAILED` audit logs in the auth controller. Category: `AUTH`. `LOGIN_FAILED` severity: `WARNING`. For `LOGIN_FAILED`, set `actorId` to 0 or a system placeholder if user not found; include `metadata: { attemptedEmail }`. | | |
| TASK-024 | Add `CUSTOMER_DOCUMENT_VERIFIED` audit log wherever KYC documents are approved or rejected. Category: `CUSTOMER`. Actor: staff. Include `metadata: { documentType, status: 'APPROVED'|'REJECTED' }`. | | |
| TASK-025 | Add `EMPLOYEE_CREATED` and `EMPLOYEE_ROLE_CHANGED` audit logs in employee management controllers. Category: `EMPLOYEE`. | | |

---

### Implementation Phase 5 — API Endpoints

- **GOAL-005**: Create new filtered, paginated audit log retrieval endpoints for branch managers and admins.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Create `apps/backend/src/controller/branchManager/audit.controller.ts` (replace existing). Implement `GetBranchAuditLogs`: query `AuditLog` where `actorBranchId = req.branch_Id`. Support query params: `page`, `limit`, `startDate` (UTC), `endDate` (UTC), `staffId` (maps to `actorId`), `customerId` (maps to `actorId` for customer role), `category`, `action`, `severity`, `entityId`. Return paginated response with `data`, `pagination`. Cache with Redis key `audit:branch:{branchId}:{hash_of_query_params}` TTL 60s. | | |
| TASK-027 | Implement `GetBranchAuditLogById` in `apps/backend/src/controller/branchManager/audit.controller.ts`: fetch single log by `publicId`, verify `actorBranchId === req.branch_Id`, return 403 if mismatch. | | |
| TASK-028 | Implement `GetCustomerAuditLogs` in `apps/backend/src/controller/branchManager/audit.controller.ts`: fetch logs where `actorId = customerId` AND `actorBranchId = req.branch_Id`. | | |
| TASK-029 | Create `apps/backend/src/controller/admin/audit.controller.ts`. Implement `GetAdminAuditLogs`: no branch restriction. Support all filters from TASK-026 plus `branchId`. | | |
| TASK-030 | Implement `GetAdminAuditStats` in `apps/backend/src/controller/admin/audit.controller.ts`: return aggregated counts grouped by `category`, `severity`, and top 10 `action` values. Query: `prisma.auditLog.groupBy(...)`. Support optional `branchId` and date range filters. | | |
| TASK-031 | Implement `GetAdminAuditLogById` in `apps/backend/src/controller/admin/audit.controller.ts`: fetch single log by `publicId` with no branch restriction. | | |
| TASK-032 | Update `apps/backend/src/routes/branchManger/branchManager.routes.ts`: add routes `GET /audit/logs`, `GET /audit/logs/:publicId`, `GET /audit/logs/customer/:customerId`. Keep old `/dashboard/staff/activity-logs` route pointing to updated handler (backward compat). | | |
| TASK-033 | Create `apps/backend/src/routes/admin/audit.routes.ts` with routes: `GET /logs`, `GET /logs/stats`, `GET /logs/:publicId`. Apply admin auth middleware. | | |
| TASK-034 | Register audit routes in `apps/backend/src/routes/admin/admin.routes.ts`: `router.use('/audit', auditRoutes)`. | | |

---

### Implementation Phase 6 — Validation & Cleanup

- **GOAL-006**: Verify the implementation end-to-end and remove dead code.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-035 | Run `npx tsc --noEmit` in `apps/backend/` to verify zero TypeScript errors after all changes. | | |
| TASK-036 | Search codebase for any remaining direct `prisma.auditLog.create(` calls using grep and replace with `auditService.log(`. | | |
| TASK-037 | Verify Redis cache keys for the new audit endpoints do not conflict with old `audit_logs:*` keys. Update old cache key pattern if reused. | | |
| TASK-038 | Test `GET /branch/audit/logs` with filters: no filters, `category=PAYMENT`, `startDate`+`endDate`, `staffId`. Verify paginated response shape matches frontend expectations. | | |
| TASK-039 | Test `GET /admin/audit/logs/stats` returns counts by category and severity. | | |
| TASK-040 | Verify that background job (`bookingExpiry.worker.ts`) audit log creation uses a valid `actorId` — define a sentinel system user or use `booking.createdById` as fallback. | | |

---

## 3. Alternatives

- **ALT-001**: **Event-sourcing / outbox pattern** — emit domain events and process audit logs asynchronously via a queue. Rejected because it adds significant infrastructure complexity (message broker, consumer service) that is disproportionate to the current project scale. The synchronous service approach is simpler and keeps audit logs transactionally consistent.
- **ALT-002**: **Prisma middleware interceptor** — use Prisma's `$use` middleware to auto-capture all mutations. Rejected because it cannot capture HTTP context (IP, user agent, actor name/role) without complex context-passing, and produces noisy low-level DB operation logs rather than meaningful business events.
- **ALT-003**: **Separate audit database / table per entity** — create dedicated tables per domain (BookingAuditLog, PaymentAuditLog, etc.). Rejected because it multiplies schema complexity and makes cross-domain queries (e.g., "all activity for customer X") harder. A single table with a `category` discriminator achieves the same filtering without schema sprawl.
- **ALT-004**: **Keep `userId` field name** — rename `actorId` back to `userId` to avoid migration effort. Rejected because `actorId` + `approverId` dual-actor model is the core of this redesign and the semantic rename is necessary for clarity.

---

## 4. Dependencies

- **DEP-001**: `@prisma/client` — provides auto-generated `AuditLog`, `AuditCategory`, `AuditSeverity` types after schema migration.
- **DEP-002**: `prisma` singleton from `packages/db/src/index.ts` — used by `AuditService` for DB writes.
- **DEP-003**: `createID()` utility from existing codebase — used in `AuditService.log()` to generate `publicId`.
- **DEP-004**: `ioredis` / `redis` client — used in retrieval controllers for caching audit log query results.
---

## 5. Files

**New files to create:**
- **FILE-001**: `apps/backend/src/services/audit/audit.types.ts` — `CreateAuditLogInput` interface and re-exports of Prisma enums.
- **FILE-002**: `apps/backend/src/services/audit/audit.service.ts` — `AuditService` class with `log()`, `logBatch()`, `computeChangedFields()`. Exported as singleton `auditService`.
- **FILE-003**: `apps/backend/src/controller/admin/audit.controller.ts` — `GetAdminAuditLogs`, `GetAdminAuditStats`, `GetAdminAuditLogById`.
- **FILE-004**: `apps/backend/src/routes/admin/audit.routes.ts` — Admin audit route definitions.

**Files to modify:**
- **FILE-005**: `packages/db/prisma/schema.prisma` — Add `AuditCategory`, `AuditSeverity` enums. Replace `AuditLog` model. Update `User` and `Branch` relations.
- **FILE-006**: `apps/backend/src/controller/branchManager/audit.controller.ts` — Full rewrite to use new schema fields and new query shape.
- **FILE-007**: `apps/backend/src/services/booking/advance-deposit.service.ts` — Replace inline audit calls with `auditService.log()`.
- **FILE-008**: `apps/backend/src/controller/payment/checkPayment.controller.ts` — Replace inline audit calls with `auditService.log()`.
- **FILE-009**: `apps/backend/src/controller/payment/checkPaymentForCash.controller.ts` — Replace inline audit calls with `auditService.log()`.
- **FILE-010**: `apps/backend/src/services/vehicle-swap/vehicle-swap.service.ts` — Replace inline audit call with `auditService.log()`.
- **FILE-011**: `apps/backend/src/jobs/bookingExpiry.worker.ts` — Replace inline audit call with `auditService.log()`.
- **FILE-012**: `apps/backend/src/routes/branchManger/branchManager.routes.ts` — Add new audit routes, retain backward-compat route.
- **FILE-013**: `apps/backend/src/routes/admin/admin.routes.ts` — Register new audit router under `/audit`.

---

## 6. Testing

- **TEST-001**: Call `auditService.log()` with all required fields and verify a row is created in `AuditLog` with correct `actorId`, `actorName`, `actorRole`, `category`, `severity`, `description`, and UTC `createdAt`.
- **TEST-002**: Call `auditService.log()` with `before: { status: 'HOLD' }` and `after: { status: 'CONFIRMED' }` without supplying `changedFields`. Verify the persisted row has `changedFields: ['status']`.
- **TEST-003**: Call `auditService.log()` inside a Prisma transaction that is later rolled back. Verify no audit log row is persisted.
- **TEST-004**: `GET /branch/audit/logs` with `category=PAYMENT` — verify only PAYMENT category logs are returned and all returned logs have `actorBranchId` matching the requesting branch.
- **TEST-005**: `GET /branch/audit/logs` with `startDate=2026-01-01T00:00:00Z&endDate=2026-01-31T23:59:59Z` — verify `createdAt` on all returned rows falls within the UTC range.
- **TEST-006**: `GET /branch/audit/logs/{publicId}` where `publicId` belongs to a different branch — verify HTTP 403 response.
- **TEST-007**: `GET /admin/audit/logs/stats` — verify response contains `byCategory` and `bySeverity` aggregation keys with numeric counts.
- **TEST-008**: Trigger a booking hold expiry via `bookingExpiry.worker.ts` in a test environment. Verify a `HOLD_EXPIRED` audit log row is created with `category: SYSTEM`, `severity: WARNING`.
- **TEST-009**: Trigger a `LOGIN_FAILED` event. Verify an audit log row with `category: AUTH`, `severity: WARNING`, and `action: LOGIN_FAILED` is created.
- **TEST-010**: Run `npx tsc --noEmit` in `apps/backend/` — verify zero type errors after all schema and service changes.

---

## 7. Risks & Assumptions

- **RISK-001**: The migration renames `userId` to `actorId`. If any raw SQL queries or external tools reference the old column name, they will break. Mitigation: search entire codebase for `"userId"` references within audit log context before running migration.
- **RISK-002**: Fetching actor name and role to populate `actorName`/`actorRole` on every audit log creation adds an extra DB read per audited event. Mitigation: callers who already have the user object in scope should pass the data directly to avoid redundant queries. The `AuditService` interface accepts these as explicit fields.
- **RISK-003**: `LOGIN_FAILED` events where the user does not exist cannot set a valid `actorId` (FK to `User`). Mitigation: make `actorId` nullable in the schema for AUTH/SYSTEM events, or create a sentinel system user row (ID = 0 or a dedicated "system" user).
- **RISK-004**: Background jobs (e.g., `bookingExpiry.worker.ts`) have no HTTP request context — `ipAddress` and `userAgent` will always be null for system-triggered events. This is expected and acceptable.
- **RISK-005**: Redis cache invalidation — adding new query filter params (`category`, `severity`, etc.) to the branch manager endpoint may return stale cached results if cache keys are not updated. Mitigation: include all query params in the cache key hash (TASK-026).
- **ASSUMPTION-001**: The Prisma `Role` enum already exists in the schema and covers all actor roles (ADMIN, BRANCH_MANAGER, STAFF, CUSTOMER, etc.).
- **ASSUMPTION-002**: `createID()` is available via a shared utility import in `apps/backend/src/`.
- **ASSUMPTION-003**: The `Branch` model has an `id` field of type `Int` that can be used as the FK for `actorBranchId`.
- **ASSUMPTION-004**: The frontend consuming the branch manager audit endpoint can be updated independently and the backward-compat route will be maintained until the frontend is migrated.

---

## 8. Related Specifications / Further Reading

- Prisma schema file: `packages/db/prisma/schema.prisma`
- Current branch manager audit controller: `apps/backend/src/controller/branchManager/audit.controller.ts`
- Existing audit call locations: `apps/backend/src/services/booking/advance-deposit.service.ts`, `apps/backend/src/controller/payment/checkPayment.controller.ts`, `apps/backend/src/services/vehicle-swap/vehicle-swap.service.ts`, `apps/backend/src/jobs/bookingExpiry.worker.ts`
- [Prisma Transactions Documentation](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
