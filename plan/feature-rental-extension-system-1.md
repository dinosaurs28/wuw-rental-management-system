---
goal: Controlled Rebooking-Based Vehicle Rental Extension System
version: 1.0
date_created: 2026-03-22
last_updated: 2026-03-22
owner: Backend
status: 'Planned'
tags: [feature, extension, booking, vehicle-allocation, conflict-resolution, payment, audit]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan implements a controlled rebooking-based vehicle rental extension system for the VRMS platform. Every extension request — whether customer-initiated (before or after pickup) or employee-initiated — is treated as a full re-evaluation of availability, vehicle allocation, pricing, and payment rather than a simple date update. The system is concurrency-safe (Redis-based locking), audit-safe (dual AuditLog + StaffActivityLog), and payment-enforced (uses existing `PaymentTransaction` with `purpose=EXTENSION`). It integrates with the existing booking lifecycle, discount system, vehicle swap infrastructure, and payment/cash management modules without duplicating logic.

The three extension entry points are: **(1)** customer-initiated before pickup, **(2)** customer-initiated after pickup (active rental), and **(3)** employee-initiated at pickup or during rental. All three share a common evaluation pipeline: availability check → conflict resolution → pricing recalculation → payment → booking commit.

---

## 1. Requirements & Constraints

- **REQ-001**: Every extension must create a `BookingExtension` record capturing: triggeredBy, extensionTrigger, oldEndAt, newEndAt, additionalAmount, extensionStatus, resolutionType, vehicleSwapOccurred, swapType, affectedBookingIds, and actorId.
- **REQ-002**: Booking must gain fields: `originalEndAt` (set once on first extension), `currentEndAt` (updated on each extension), `extensionCount` (Int, default 0), `lastExtendedAt` (DateTime?).
- **REQ-003**: Availability check must be atomic and Redis-lock-protected per vehicle. Lock key: `ext-lock:vehicle:{vehicleId}`. TTL: 60 seconds. Lock must be released on success, failure, and timeout.
- **REQ-004**: `PaymentPurpose.EXTENSION` already exists in the schema — use it directly. No new enum values needed for payment purpose.
- **REQ-005**: Extension payment is mandatory before status transitions to `CONFIRMED`. Extension remains in `PENDING_PAYMENT` until payment is CONFIRMED (or COLLECTED in relaxed mode).
- **REQ-006**: Pricing recalculation must apply duration-based discounts and revalidate coupons based on the new total duration (originalStartAt to newEndAt). Additional amount = new totalFinal − previously confirmed total payments.
- **REQ-007**: Conflict resolution must evaluate four options in order: SAME_VEHICLE → SWAP_CURRENT → SWAP_FUTURE → PARTIAL → REJECTED. The system computes and ranks all options; the employee selects and executes.
- **REQ-008**: No vehicle swap must result in a category downgrade. Equivalent or higher-category vehicles only.
- **REQ-009**: Customer-initiated extensions must expose only safe options (SAME_VEHICLE, SWAP_CURRENT, PARTIAL) — never internal booking conflicts or other customers' publicIds.
- **REQ-010**: Post-pickup extensions requiring a vehicle swap must enforce an operational constraint flag: `requiresPhysicalReturn`. If the branch does not support field swaps, the customer must return the current vehicle before collecting the replacement.
- **REQ-011**: Extension after RETURNED status initiation (i.e., booking status is RETURNED or CANCELLED) is strictly forbidden. Return 409 CONFLICT.
- **REQ-012**: Repeated extensions (extensionCount > 0) must rebase pricing on the full new duration (startAt to newEndAt), not just the additional days.
- **REQ-013**: All extension actions must log to both `AuditLog` (via `auditService.log()`) and `StaffActivityLog` (via `staffActivityService.log()`).
- **REQ-014**: Employee-initiated extensions at pickup must be processed before the `ConfirmPickupWithDeposit` call completes, i.e., extension is confirmed before PICKED_UP transition.
- **REQ-015**: If payment fails or times out, all Redis locks must be released and the booking must revert to its state before the extension attempt. No partial commits.
- **REQ-016**: Future bookings whose vehicle is swapped due to another customer's extension must receive a notification flag (`extensionDisplacedAt`, `displacedByExtensionId`) so they can be surfaced in the manager dashboard.

- **SEC-001**: Customer-initiated extension routes must authenticate via customer JWT and use only `publicId` in URL params. Internal `id` must never appear in customer-facing responses.
- **SEC-002**: Employee-initiated extensions must authenticate via employee JWT. Employee role is sufficient; manager role not required for extension execution (employee is empowered for this flow).
- **SEC-003**: Conflict resolution swaps affecting future bookings require MANAGER or EMPLOYEE role with explicit confirmation payload — cannot be executed silently by the system.
- **SEC-004**: Redis lock acquisition must use SET NX EX (atomic set-if-not-exists with TTL). No busy-wait polling; return 409 immediately if lock cannot be acquired.

- **CON-001**: `Booking.endAt` is the existing field tracking booking end time. `currentEndAt` mirrors it after each extension. Both must be kept in sync. `originalEndAt` is set only once — on the first extension.
- **CON-002**: `BookingItem.days` and pricing snapshot must be updated atomically with the booking extension commit.
- **CON-003**: The existing `VehicleSwap` model and `vehicleSwapService` must be reused for vehicle swaps triggered by extensions. Do not create a parallel swap model.
- **CON-004**: The existing `discountApplicationService.record()` must be called to upsert the discount application with the new pricing values during extension recalculation.
- **CON-005**: `BookingStatus` enum has no EXTENSION_PENDING value — do not add one. Extension status is tracked on `BookingExtension.extensionStatus` only. The booking itself stays in its current status (CONFIRMED or PICKED_UP) until payment confirms the extension.
- **CON-006**: `StaffEntityType` does not include `BOOKING_EXTENSION`. Extend it with `BOOKING_EXTENSION`. Also extend `StaffActionType` with `EXTENDED`.
- **CON-007**: Do not modify `ConfirmPickupWithDeposit` to embed extension logic. Extension at pickup is a separate pre-pickup API call that modifies the booking's endAt before pickup is confirmed.
- **CON-008**: Customer routes live in the existing customer/public routing layer, not under `/branchManager/` or `/employee/`.

- **GUD-001**: All async service methods must have explicit return type annotations (required by `declaration: true` in tsconfig).
- **GUD-002**: Use `Decimal.js` for all monetary arithmetic. Never use native `number` for financial calculations.
- **GUD-003**: All services are singleton instances: `export const xyzService = new XyzService()`.
- **GUD-004**: `createID()` from `apps/backend/src/utils/nanoID.ts` for all `publicId` generation.
- **GUD-005**: `redis` client from `apps/backend/src/lib/redisconfig.ts` for locking operations.
- **GUD-006**: Internal `id` (Int) is used for all DB relations and locking keys. `publicId` (String) is used for all API params and response payloads.

- **PAT-001**: Extension evaluation pipeline is stateless and idempotent — safe to re-run given the same inputs.
- **PAT-002**: Lock-eval-pay-commit: acquire lock → evaluate → collect payment → commit in DB transaction → release lock.
- **PAT-003**: Rollback pattern: if any step after lock acquisition fails, the `finally` block in the service must release the lock and the Prisma transaction auto-rolls back.
- **PAT-004**: Config-first: every service method reads `BranchPaymentConfig` to determine cash vs. confirmed payment requirements before proceeding.

---

## 2. Implementation Steps

### Implementation Phase 1 — Schema & Migration

- GOAL-001: Extend the Prisma schema with new enums, new models, new fields on existing models, and run migration.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `ExtensionStatus` enum to `packages/db/prisma/schema.prisma`: values `PENDING_PAYMENT \| PAYMENT_COLLECTED \| CONFIRMED \| REJECTED \| CANCELLED`. `PENDING_PAYMENT` = awaiting payment. `PAYMENT_COLLECTED` = cash collected, pending manager confirmation. `CONFIRMED` = payment confirmed, extension committed. `REJECTED` = conflict unresolvable or employee rejected. `CANCELLED` = payment failed/timed out, booking reverted. | | |
| TASK-002 | Add `ExtensionTrigger` enum: values `CUSTOMER_BEFORE_PICKUP \| CUSTOMER_AFTER_PICKUP \| EMPLOYEE_AT_PICKUP \| EMPLOYEE_DURING_RENTAL`. Determines entry point and allowed resolution options. | | |
| TASK-003 | Add `ExtensionResolutionType` enum: values `SAME_VEHICLE \| SWAP_CURRENT_TO_OTHER \| SWAP_FUTURE_BOOKING \| PARTIAL_EXTENSION \| NO_RESOLUTION`. Tracks which resolution path was selected and committed. | | |
| TASK-004 | Extend `StaffEntityType` enum with `BOOKING_EXTENSION`. Extend `StaffActionType` enum with `EXTENDED`. | | |
| TASK-005 | Add `BookingExtension` model: `id Int @id @default(autoincrement())`, `publicId String @unique`, `bookingId Int` (FK to Booking.id), `branchId Int` (FK to Branch.id), `extensionTrigger ExtensionTrigger`, `extensionStatus ExtensionStatus @default(PENDING_PAYMENT)`, `oldEndAt DateTime`, `requestedEndAt DateTime`, `actualNewEndAt DateTime?` (set on CONFIRMED — may differ from requested if partial), `additionalAmount Decimal @db.Decimal(10,2)`, `newTotalFinal Decimal @db.Decimal(10,2)`, `resolutionType ExtensionResolutionType?`, `vehicleSwapOccurred Boolean @default(false)`, `swappedVehicleId Int?` (FK to Vehicle.id — the new vehicle assigned), `affectedBookingIds Int[]` (internal IDs of future bookings whose vehicle was swapped), `paymentTransactionId Int?` (FK to PaymentTransaction.id — links to the EXTENSION payment), `vehicleSwapId Int?` (FK to VehicleSwap.id — if current booking's vehicle was swapped), `actorId Int` (FK to User.id — employee or system), `actorPublicId String`, `actorRole String`, `rejectionReason String?`, `notes String?`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`. Indexes: `@@index([bookingId])`, `@@index([branchId, extensionStatus])`, `@@index([createdAt])`. | | |
| TASK-006 | Add fields to `Booking` model: `originalEndAt DateTime?` (set once on first extension, never updated again), `extensionCount Int @default(0)`, `lastExtendedAt DateTime?`, `activeExtensionId Int?` (FK to BookingExtension.id, null when no pending extension). | | |
| TASK-007 | Add back-relations: to `Booking`: `extensions BookingExtension[]`, `activeExtension BookingExtension? @relation("ActiveExtension", fields: [activeExtensionId], references: [id])`; to `Branch`: `extensions BookingExtension[]`; to `User`: `initiatedExtensions BookingExtension[] @relation("ExtensionActor")`; to `Vehicle`: `extensionSwaps BookingExtension[] @relation("ExtensionSwappedVehicle")`; to `PaymentTransaction`: `extension BookingExtension?`; to `VehicleSwap`: `bookingExtension BookingExtension?`. | | |
| TASK-008 | Add `displacedByExtensionId Int?` and `extensionDisplacedAt DateTime?` to `Booking` model. Used to flag future bookings whose vehicle was reassigned due to another booking's extension conflict resolution. Add back-relation `displacingExtension BookingExtension?` on `Booking`. | | |
| TASK-009 | Run migration: `pnpm --filter @repo/db prisma migrate dev --name add_rental_extension_system`. | | |

---

### Implementation Phase 2 — Zod Validation Schemas

- GOAL-002: Create all Zod schemas for extension requests and responses in `packages/schemas/src/extension.schema.ts`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Create `packages/schemas/src/extension.schema.ts`. Add `requestExtensionSchema`: `{ bookingPublicId: z.string().min(1), newEndAt: z.string().datetime(), notes: z.string().max(500).optional() }`. Validates ISO 8601 datetime string. | | |
| TASK-011 | Add `evaluateExtensionSchema` (internal, employee-facing): extends `requestExtensionSchema` with no additional fields. Used to get pricing and conflict resolution options before committing. | | |
| TASK-012 | Add `commitExtensionSchema`: `{ extensionPublicId: z.string().min(1), resolutionType: z.enum(['SAME_VEHICLE','SWAP_CURRENT_TO_OTHER','SWAP_FUTURE_BOOKING','PARTIAL_EXTENSION']), selectedVehicleId: z.string().optional() (publicId of alternate vehicle, required if resolutionType is SWAP_CURRENT_TO_OTHER), affectedBookingSwaps: z.array(z.object({ bookingPublicId: z.string(), newVehiclePublicId: z.string() })).optional() (required if resolutionType is SWAP_FUTURE_BOOKING), partialNewEndAt: z.string().datetime().optional() (required if resolutionType is PARTIAL_EXTENSION), paymentMethod: z.enum(['CASH','ONLINE','SPLIT']), cashAmount: z.number().min(0).optional(), onlineAmount: z.number().min(0).optional(), onlineTransactionRef: z.string().optional(), onlineGateway: z.string().optional(), idempotencyKey: z.string().min(1).max(64) }`. Add refinements: validate cashAmount/onlineAmount based on paymentMethod (same rules as `recordPaymentSchema`). | | |
| TASK-013 | Add `customerRequestExtensionSchema`: `{ newEndAt: z.string().datetime(), notes: z.string().max(500).optional() }`. No bookingPublicId (comes from URL param). No resolutionType (customer cannot pick resolution). | | |
| TASK-014 | Add `customerCommitExtensionSchema`: `{ extensionPublicId: z.string().min(1), paymentMethod: z.enum(['ONLINE']), onlineTransactionRef: z.string().min(1), onlineGateway: z.string().optional(), idempotencyKey: z.string().min(1).max(64) }`. Customer-initiated extensions only support ONLINE payment. Cash is handled by employees. | | |
| TASK-015 | Add `listExtensionsSchema`: `{ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), status: z.enum(['PENDING_PAYMENT','PAYMENT_COLLECTED','CONFIRMED','REJECTED','CANCELLED']).optional(), bookingPublicId: z.string().optional() }`. | | |
| TASK-016 | Export `extension.schema.ts` from `packages/schemas/src/index.ts` via `export * from "./extension.schema.js"`. | | |

---

### Implementation Phase 3 — Core Extension Services

- GOAL-003: Implement all extension service modules in `apps/backend/src/services/extension/`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | Create `apps/backend/src/services/extension/extension-lock.service.ts`. Class `ExtensionLockService`. Method `acquireVehicleLock(vehicleId: number): Promise<boolean>` — executes `SET ext-lock:vehicle:{vehicleId} 1 NX EX 60` via ioredis, returns true if acquired. Method `releaseVehicleLock(vehicleId: number): Promise<void>` — executes `DEL ext-lock:vehicle:{vehicleId}`. Method `acquireMultipleLocks(vehicleIds: number[]): Promise<{ acquired: number[]; failed: number[] }>` — attempts all locks atomically using pipeline, releases all if any fail. Export singleton `extensionLockService`. | | |
| TASK-018 | Create `apps/backend/src/services/extension/extension-availability.service.ts`. Class `ExtensionAvailabilityService`. Method `checkVehicleAvailability(vehicleId: number, fromAt: DateTime, toAt: DateTime, excludeBookingId: number): Promise<AvailabilityResult>` where `AvailabilityResult = { available: boolean; conflictingBookings: ConflictingBooking[] }` and `ConflictingBooking = { bookingId: number; bookingPublicId: string; startAt: Date; endAt: Date; vehicleId: number }`. Queries `BookingItem` joined with `Booking` where `vehicleId = vehicleId AND bookingId != excludeBookingId AND booking.status IN [CONFIRMED, PICKED_UP] AND NOT (booking.endAt <= fromAt OR booking.startAt >= toAt)`. Method `findAlternativeVehicles(branchId: number, categoryId: number, fromAt: DateTime, toAt: DateTime, excludeVehicleIds: number[]): Promise<Vehicle[]>` — finds AVAILABLE vehicles of same or higher category not booked in window. Export singleton `extensionAvailabilityService`. | | |
| TASK-019 | Create `apps/backend/src/services/extension/extension-pricing.service.ts`. Class `ExtensionPricingService`. Method `recalculate(bookingId: number, newEndAt: DateTime): Promise<ExtensionPricingResult>` where `ExtensionPricingResult = { newDays: number; newTotalBase: Decimal; newTotalDiscount: Decimal; newTotalTax: Decimal; newTotalFinal: Decimal; additionalAmount: Decimal; updatedPricingSnapshot: object }`. Logic: (1) fetch booking with items, existing discountApplication, gst rule; (2) compute new duration in days from `booking.startAt` to `newEndAt`; (3) fetch vehicle pricing (VehiclePricingOverride or VehicleCustomPricing or category default); (4) compute newTotalBase = dailyRate × newDays per item; (5) apply duration-based discount rules (call existing discount evaluation logic); (6) revalidate coupon if `booking.couponCode` exists — if still valid apply, else remove; (7) compute tax using branch GSTRule; (8) additionalAmount = max(0, newTotalFinal - totalCollectedConfirmed from financialStateService). Export singleton `extensionPricingService`. | | |
| TASK-020 | Create `apps/backend/src/services/extension/extension-conflict-resolver.service.ts`. Class `ExtensionConflictResolverService`. Method `resolve(booking: BookingWithItems, newEndAt: DateTime, branchId: number): Promise<ConflictResolutionOptions>` where `ConflictResolutionOptions = { options: ResolutionOption[]; recommendedOption: ExtensionResolutionType }`. Logic: (1) call `extensionAvailabilityService.checkVehicleAvailability()` for each vehicle in booking.items; (2) if all available → return SAME_VEHICLE option; (3) find alternative vehicles for current booking via `findAlternativeVehicles()` → if found → add SWAP_CURRENT_TO_OTHER option with vehicle list; (4) for each conflicting future booking, check if alternative vehicles exist for that booking's duration → if found for all conflicts → add SWAP_FUTURE_BOOKING option with per-conflict vehicle maps; (5) compute max available window before first conflict → if > 0 days → add PARTIAL_EXTENSION option with `partialNewEndAt`; (6) always include NO_RESOLUTION as fallback. Rank options: SAME_VEHICLE > SWAP_CURRENT_TO_OTHER > SWAP_FUTURE_BOOKING > PARTIAL_EXTENSION > NO_RESOLUTION. Export singleton `extensionConflictResolverService`. | | |
| TASK-021 | Create `apps/backend/src/services/extension/extension-vehicle-allocator.service.ts`. Class `ExtensionVehicleAllocatorService`. Method `swapCurrentBookingVehicle(bookingId: number, newVehiclePublicId: string, branchId: number, actor: ActorContext, tx: PrismaTx): Promise<VehicleSwap>` — reuses existing `vehicleSwapService.performVehicleSwap()` with reason `CUSTOMER_REQUEST` and marks swap as extension-driven. Method `swapFutureBookingVehicle(affectedBookingId: number, newVehiclePublicId: string, actor: ActorContext, tx: PrismaTx): Promise<void>` — updates `BookingItem.vehicleId` for the affected booking, marks that booking with `extensionDisplacedAt = now()` and `displacedByExtensionId`, logs audit for both affected booking and the extension. Method `validateNoDowngrade(currentVehicle: Vehicle, newVehicle: Vehicle): void` — throws if `newVehicle.category.pricePerDay < currentVehicle.category.pricePerDay`. Export singleton `extensionVehicleAllocatorService`. | | |
| TASK-022 | Create `apps/backend/src/services/extension/extension.service.ts`. Class `ExtensionService`. This is the orchestration service. Methods: (a) `evaluate(bookingPublicId: string, newEndAt: Date, actor: ActorContext): Promise<ExtensionEvaluation>` — loads booking, validates status (not RETURNED/CANCELLED), calls availabilityService, pricingService, conflictResolverService, creates `BookingExtension` record with status `PENDING_PAYMENT`, returns evaluation with options and pricing; (b) `commit(extensionPublicId: string, commitInput: CommitExtensionInput, actor: ActorContext): Promise<BookingExtension>` — acquires Redis locks, validates extension still PENDING_PAYMENT, executes chosen resolution (swap or same-vehicle), records PaymentTransaction with purpose EXTENSION, updates Booking (endAt, currentEndAt, extensionCount, lastExtendedAt), updates BookingItem pricing, upserts DiscountApplication, updates ExtensionStatus to CONFIRMED (or PAYMENT_COLLECTED if cash in strict mode), releases locks, logs audit + staff activity; (c) `cancel(extensionPublicId: string, actor: ActorContext): Promise<void>` — sets ExtensionStatus to CANCELLED, releases locks if held, reverts booking.endAt, logs audit; (d) `getByPublicId(publicId: string): Promise<BookingExtension | null>`; (e) `listForBranch(branchId: number, filters: ListExtensionFilters): Promise<PaginatedExtensions>`. Export singleton `extensionService`. | | |
| TASK-023 | Create `apps/backend/src/services/extension/index.ts` barrel: `export * from './extension-lock.service.js'`, `export * from './extension-availability.service.js'`, `export * from './extension-pricing.service.js'`, `export * from './extension-conflict-resolver.service.js'`, `export * from './extension-vehicle-allocator.service.js'`, `export * from './extension.service.js'`. | | |

---

### Implementation Phase 4 — Controllers

- GOAL-004: Implement controllers for employee, branch manager, and customer extension endpoints.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | Create `apps/backend/src/controller/employee/extension.controller.ts`. Exports: `EvaluateExtension` (POST — employee calls with bookingPublicId and newEndAt, returns pricing + resolution options), `CommitExtension` (POST — employee selects resolution and provides payment, returns confirmed extension or payment-pending extension), `CancelExtension` (POST /:extensionPublicId/cancel — cancels pending extension). Build `actorContext` from `req.public_Id` and `req.branch_Id`. All methods have explicit return types `Promise<void>`. | | |
| TASK-025 | Create `apps/backend/src/controller/branchManager/extension.controller.ts`. Exports: `EvaluateExtension` (same as employee), `CommitExtension` (same as employee), `CancelExtension`, `ListBranchExtensions` (GET — paginated list of all extensions for branch with filters), `GetExtensionDetail` (GET /:publicId). Manager can additionally confirm cash payments for extension via the existing cash-confirmation flow (`/payment/cash/:publicId/confirm`). | | |
| TASK-026 | Create `apps/backend/src/controller/customer/extension.controller.ts`. Exports: `CustomerEvaluateExtension` (POST — customer calls with booking publicId from JWT claim or URL, returns only safe options: SAME_VEHICLE, SWAP_CURRENT_TO_OTHER, PARTIAL_EXTENSION — never exposes other customers' publicIds), `CustomerCommitExtension` (POST — customer provides online payment only), `CustomerGetExtensionStatus` (GET /:extensionPublicId — returns status and amount paid). All responses strip internal IDs. Validate that the booking belongs to the authenticated customer. | | |

---

### Implementation Phase 5 — Routes

- GOAL-005: Register all extension routes with correct middleware and role guards.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | Create `apps/backend/src/routes/employee/extension.routes.ts`. Apply `EmployeeCheck` middleware. Routes: `POST /evaluate → EvaluateExtension`, `POST /commit → CommitExtension`, `POST /:extensionPublicId/cancel → CancelExtension`. Export default router. | | |
| TASK-028 | Create `apps/backend/src/routes/branchManger/extension.routes.ts`. Apply `ManagerCheck` middleware. Routes: `POST /evaluate → EvaluateExtension`, `POST /commit → CommitExtension`, `POST /:extensionPublicId/cancel → CancelExtension`, `GET / → ListBranchExtensions`, `GET /:publicId → GetExtensionDetail`. Export default router. | | |
| TASK-029 | Create `apps/backend/src/routes/customer/extension.routes.ts` (or equivalent customer routing file). Apply customer auth middleware. Routes: `POST /bookings/:bookingPublicId/extension/evaluate → CustomerEvaluateExtension`, `POST /extension/commit → CustomerCommitExtension`, `GET /extension/:extensionPublicId → CustomerGetExtensionStatus`. Export default router. | | |
| TASK-030 | Register employee extension router in `apps/backend/src/routes/employee/employee.routes.ts`: add `import extensionRouter from "./extension.routes.js"` and `router.use("/extension", extensionRouter)`. | | |
| TASK-031 | Register manager extension router in `apps/backend/src/routes/branchManger/branchManager.routes.ts`: add `import extensionRouter from "./extension.routes.js"` and `router.use("/extension", extensionRouter)`. | | |
| TASK-032 | Register customer extension router in the appropriate customer/public route file. Identify the correct customer routing file first by grepping for existing customer routes in `apps/backend/src/routes/`. | | |

---

### Implementation Phase 6 — Booking Lifecycle Integration

- GOAL-006: Integrate extension status checks into the existing booking lifecycle without modifying existing controller logic.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-033 | In `extensionService.evaluate()`: validate `booking.status` is `CONFIRMED` or `PICKED_UP`. Reject with descriptive error if `RETURNED`, `CANCELLED`, or `HOLD_EXPIRED`. Reject if `booking.activeExtensionId` is not null (an unresolved pending extension already exists — prevent concurrent extensions on the same booking). | | |
| TASK-034 | In `extensionService.commit()`: execute all DB updates in a single `prisma.$transaction()` block. Updates inside the transaction: `Booking.endAt`, `Booking.currentEndAt`, `Booking.extensionCount += 1`, `Booking.lastExtendedAt`, `Booking.originalEndAt` (set only if `extensionCount === 0`), `Booking.activeExtensionId = null` (clear on CONFIRMED), `BookingItem.days`, `BookingItem.baseTotal`, `BookingItem.discountAmount`, `BookingItem.finalTotal`, `BookingItem.taxAmount`, `BookingExtension.extensionStatus`, `BookingExtension.actualNewEndAt`. All within the same transaction. | | |
| TASK-035 | Add `extensionCount`, `originalEndAt`, `currentEndAt`, and `lastExtendedAt` to the booking response shape wherever booking details are returned. Modify `GetConfirmationDetails` in `apps/backend/src/controller/branchManager/bookings.controller.ts` to include these fields by selecting them from the booking query. Do NOT modify business logic — only add fields to SELECT clause. | | |
| TASK-036 | In `ConfirmPickupWithDeposit` (existing function in `bookings.controller.ts`): add a check that `booking.activeExtensionId === null` before allowing pickup. If a pending extension exists, return 409 CONFLICT with message: `"Cannot confirm pickup while a pending extension payment is unresolved. Complete or cancel the extension first."` | | |

---

### Implementation Phase 7 — Vehicle Swap Integration for Extensions

- GOAL-007: Ensure vehicle swaps triggered by extensions use the existing VehicleSwap infrastructure and correctly flag displaced future bookings.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-037 | In `extensionVehicleAllocatorService.swapCurrentBookingVehicle()`: call `vehicleSwapService.performVehicleSwap()` with `reason = SwapReason.CUSTOMER_REQUEST` and `reasonNotes = "Extension vehicle swap — booking extended beyond vehicle availability"`. The VehicleSwap record links to the existing `VehicleSwap` model. Store the returned `vehicleSwap.id` in `BookingExtension.vehicleSwapId`. | | |
| TASK-038 | In `extensionVehicleAllocatorService.swapFutureBookingVehicle()`: do NOT use `vehicleSwapService` (that service operates on the current booking's vehicle). Instead, directly update `BookingItem.vehicleId` for the affected future booking inside the commit transaction. Then create a `VehicleSwap` record for that future booking with `reason = SwapReason.OTHER` and `reasonNotes = "Displaced by extension of booking {extensionPublicId}"`. Mark the affected booking with `displacedByExtensionId` and `extensionDisplacedAt`. | | |
| TASK-039 | Add a manager dashboard query: `GET /branchManager/extension/displaced-bookings` — returns all bookings in the branch with `extensionDisplacedAt IS NOT NULL` and `status IN [CONFIRMED, PICKED_UP]` so managers can review and notify affected customers. Implement this in `apps/backend/src/controller/branchManager/extension.controller.ts` as `GetDisplacedBookings`. Register route in the extension routes file. | | |

---

### Implementation Phase 8 — Audit & Activity Logging

- GOAL-008: Ensure every extension action produces structured audit and staff activity log entries.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-040 | In `extensionService.evaluate()`: log `auditService.log({ category: AuditCategory.BOOKING, severity: AuditSeverity.INFO, action: "Extension evaluated", entityType: "BookingExtension", entityId: extension.publicId, actorId, before: null, after: { requestedEndAt, additionalAmount, resolutionOptions } })`. Log `staffActivityService.log({ actionType: StaffActionType.INITIATED, entityType: StaffEntityType.BOOKING_EXTENSION, entityRef: extension.publicId, description: "Extension evaluation initiated for booking {bookingPublicId}" })`. | | |
| TASK-041 | In `extensionService.commit()` on CONFIRMED: log `auditService.log({ category: AuditCategory.BOOKING, severity: AuditSeverity.INFO, action: "Extension confirmed", before: { endAt: oldEndAt, totalFinal: oldTotalFinal }, after: { endAt: newEndAt, totalFinal: newTotalFinal } })`. Log `staffActivityService.log({ actionType: StaffActionType.EXTENDED, entityType: StaffEntityType.BOOKING_EXTENSION, entityRef: extension.publicId })`. | | |
| TASK-042 | In `extensionService.commit()` when vehicle swap occurs: log a separate audit entry for each swap (current booking and any affected future booking). Use `AuditCategory.VEHICLE`, `StaffActionType.SWAPPED`, `StaffEntityType.BOOKING_EXTENSION`. Include swappedFromVehicleId and swappedToVehicleId in the `after` field. | | |
| TASK-043 | In `extensionService.cancel()`: log `auditService.log({ severity: AuditSeverity.WARNING, action: "Extension cancelled — booking reverted" })` and `staffActivityService.log({ actionType: StaffActionType.CANCELLED, entityType: StaffEntityType.BOOKING_EXTENSION })`. | | |

---

### Implementation Phase 9 — Stale Data & Concurrent Request Handling

- GOAL-009: Implement all concurrency-safe patterns and stale data guards.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-044 | In `extensionService.commit()`: after acquiring locks but before DB transaction, re-run `extensionAvailabilityService.checkVehicleAvailability()` for the chosen vehicle(s). If availability changed since `evaluate()` was called (stale data scenario), return 409 CONFLICT: `"Vehicle availability changed during extension — please re-evaluate"`. Do not proceed with commit. | | |
| TASK-045 | In `extensionService.evaluate()`: check `booking.activeExtensionId !== null` and return 409 if a pending extension already exists. Message: `"A pending extension already exists for this booking. Complete or cancel it before creating a new one."` | | |
| TASK-046 | In `extensionLockService.acquireMultipleLocks()`: if any lock cannot be acquired (returns null from SET NX), immediately release all already-acquired locks via pipeline DEL and return `{ acquired: [], failed: [vehicleId] }`. Caller returns 409 CONFLICT: `"Vehicle is currently being processed by another request. Please try again in a moment."` | | |
| TASK-047 | Implement lock auto-expiry safety: `extensionLockService` sets 60-second TTL on all locks. If the commit transaction exceeds 60 seconds, the lock auto-expires. To detect this, after the DB transaction completes, check if lock still exists before releasing. If expired, log a WARNING audit entry (lock expired mid-transaction — investigate for race condition). | | |

---

### Implementation Phase 10 — Payment Integration for Extensions

- GOAL-010: Wire extension payments into the existing PaymentTransaction system with purpose=EXTENSION.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-048 | In `extensionService.commit()`: after all availability and resolution checks pass but before the booking update, call `paymentTransactionService.record()` with `{ bookingPublicId, purpose: "EXTENSION", method, totalAmount: additionalAmount, cashAmount?, onlineAmount?, onlineTransactionRef?, idempotencyKey, notes: "Extension payment for new end date {newEndAt}" }`. Store the returned `paymentTransaction.id` in `BookingExtension.paymentTransactionId`. | | |
| TASK-049 | If payment transaction status is `COLLECTED` (cash in strict mode), set `BookingExtension.extensionStatus = PAYMENT_COLLECTED` and do NOT update booking dates yet. The booking update (endAt, currentEndAt, etc.) must only happen when payment moves to CONFIRMED. | | |
| TASK-050 | In `paymentTransactionService.confirmCash()` (existing method): after confirming the cash payment, check if the associated `BookingExtension.paymentTransactionId` matches this transaction. If so, call `extensionService.finalizeAfterPayment(extensionPublicId, actor)`. Implement `finalizeAfterPayment()` in `extensionService`: updates Booking dates, BookingItem pricing, DiscountApplication, sets ExtensionStatus to CONFIRMED, logs audit. | | |
| TASK-051 | Add rollback handler: if `paymentTransactionService.record()` throws (e.g., idempotency conflict, excess payment, cash limit), catch the error in `extensionService.commit()`, set `BookingExtension.extensionStatus = CANCELLED`, release all locks, and rethrow with a user-friendly message. The Prisma transaction has not been committed at this point so no booking fields are changed. | | |

---

## 3. Alternatives

- **ALT-001**: Simple date update approach — just overwrite `Booking.endAt` and recalculate pricing. Rejected — does not handle vehicle availability conflicts, race conditions, concurrent requests, or partial extensions. No audit trail of what was the original end date.
- **ALT-002**: Create a new `Booking` record for the extension period (full rebooking). Rejected — breaks booking continuity for customers, complicates payment reconciliation, and makes the audit trail harder to follow. The existing booking context (KYC, vehicle assignment, damage reports) would be lost.
- **ALT-003**: Manager-only extension (no employee or customer self-service). Rejected — creates unnecessary bottleneck. The system requirements explicitly empower employees to handle extensions.
- **ALT-004**: Use database-level locking (SELECT FOR UPDATE) instead of Redis locks. Rejected — SELECT FOR UPDATE holds a DB connection for the duration, creates connection exhaustion risk under concurrent load. Redis NX locks are lighter-weight and release independently of the DB transaction.
- **ALT-005**: Store conflict resolution as a separate `ConflictResolution` model. Rejected — `BookingExtension` already captures `resolutionType`, `vehicleSwapOccurred`, `swappedVehicleId`, and `affectedBookingIds`. A separate model adds no value and increases join complexity.
- **ALT-006**: Auto-select the best resolution without employee confirmation. Rejected — the system requirements explicitly state that the employee must select and confirm the resolution. Automatic execution without human confirmation is a fraud and operational risk.

---

## 4. Dependencies

- **DEP-001**: `@repo/database/client` — Prisma client with new models. Migration (TASK-009) must run before any service implementation.
- **DEP-002**: `@repo/schemas` — Zod schemas from Phase 2 must be built before controllers import them.
- **DEP-003**: `decimal.js` — already installed; all monetary calculations use Decimal.js.
- **DEP-004**: `ioredis` — already installed via `apps/backend/src/lib/redisconfig.ts`. Used for extension locks.
- **DEP-005**: Existing `vehicleSwapService` (`apps/backend/src/services/booking/vehicle-swap.service.ts`) — reused by `extensionVehicleAllocatorService` for current-booking swaps.
- **DEP-006**: Existing `paymentTransactionService` (`apps/backend/src/services/payment/payment-transaction.service.ts`) — used to record EXTENSION payments.
- **DEP-007**: Existing `financialStateService` — used by `extensionPricingService` to compute `totalCollectedConfirmed` for the `additionalAmount` calculation.
- **DEP-008**: Existing `discountApplicationService` — called during pricing recalculation to upsert the discount application with new amounts.
- **DEP-009**: Existing `auditService` and `staffActivityService` — called by all extension service methods.
- **DEP-010**: Existing `branchPaymentConfigService` — read by `extensionService.commit()` to determine cash confirmation mode.
- **DEP-011**: `ManagerCheck` and `EmployeeCheck` middlewares — applied to respective route files.

---

## 5. Files

**New Files:**
- **FILE-001**: `packages/db/prisma/schema.prisma` — add 3 new enums, 1 new model (`BookingExtension`), new fields on `Booking`, extended `StaffActionType` and `StaffEntityType`.
- **FILE-002**: `packages/schemas/src/extension.schema.ts` — all Zod schemas for extension system.
- **FILE-003**: `apps/backend/src/services/extension/extension-lock.service.ts`
- **FILE-004**: `apps/backend/src/services/extension/extension-availability.service.ts`
- **FILE-005**: `apps/backend/src/services/extension/extension-pricing.service.ts`
- **FILE-006**: `apps/backend/src/services/extension/extension-conflict-resolver.service.ts`
- **FILE-007**: `apps/backend/src/services/extension/extension-vehicle-allocator.service.ts`
- **FILE-008**: `apps/backend/src/services/extension/extension.service.ts`
- **FILE-009**: `apps/backend/src/services/extension/index.ts`
- **FILE-010**: `apps/backend/src/controller/employee/extension.controller.ts`
- **FILE-011**: `apps/backend/src/controller/branchManager/extension.controller.ts`
- **FILE-012**: `apps/backend/src/controller/customer/extension.controller.ts`
- **FILE-013**: `apps/backend/src/routes/employee/extension.routes.ts`
- **FILE-014**: `apps/backend/src/routes/branchManger/extension.routes.ts`
- **FILE-015**: `apps/backend/src/routes/customer/extension.routes.ts`

**Modified Files:**
- **FILE-016**: `packages/schemas/src/index.ts` — add `export * from "./extension.schema.js"`.
- **FILE-017**: `apps/backend/src/routes/employee/employee.routes.ts` — register extension router.
- **FILE-018**: `apps/backend/src/routes/branchManger/branchManager.routes.ts` — register extension router.
- **FILE-019**: `apps/backend/src/routes/customer/` (identify and register customer extension router).
- **FILE-020**: `apps/backend/src/controller/branchManager/bookings.controller.ts` — add `activeExtensionId` check in `ConfirmPickupWithDeposit` (TASK-036) and add new extension fields to `GetConfirmationDetails` select (TASK-035).
- **FILE-021**: `apps/backend/src/services/payment/payment-transaction.service.ts` — add hook in `confirmCash()` to call `extensionService.finalizeAfterPayment()` when payment is linked to an extension (TASK-050).

---

## 6. Testing

- **TEST-001**: Unit test `extensionAvailabilityService.checkVehicleAvailability()` — seed overlapping bookings, assert `available=false` and `conflictingBookings` list is populated correctly.
- **TEST-002**: Unit test `extensionPricingService.recalculate()` — extend a 3-day booking to 7 days, assert `additionalAmount = newTotalFinal − confirmedTotal`, assert duration discount is applied.
- **TEST-003**: Integration test `extensionService.evaluate()` — vehicle available → returns SAME_VEHICLE option with pricing.
- **TEST-004**: Integration test `extensionService.evaluate()` — vehicle not available, alternatives exist → returns SWAP_CURRENT_TO_OTHER with alternative vehicle list.
- **TEST-005**: Integration test `extensionService.commit()` with SAME_VEHICLE — assert booking.endAt updated, BookingItem.days updated, PaymentTransaction created with purpose=EXTENSION.
- **TEST-006**: Integration test `extensionService.commit()` with SWAP_CURRENT_TO_OTHER — assert VehicleSwap record created, BookingItem.vehicleId updated, old vehicle status AVAILABLE.
- **TEST-007**: Concurrency test — two simultaneous `evaluate()` + `commit()` calls on the same vehicle. Assert only one succeeds, second returns 409.
- **TEST-008**: Stale data test — `evaluate()` succeeds, then another booking is created for the same vehicle and period, then `commit()` is called. Assert 409 conflict on stale data detection.
- **TEST-009**: Payment failure rollback test — `commit()` where payment throws. Assert booking.endAt is unchanged, extensionStatus=CANCELLED, Redis lock released.
- **TEST-010**: Test `ConfirmPickupWithDeposit` with `activeExtensionId` set — assert 409 is returned.
- **TEST-011**: Test customer extension endpoint — assert response never includes other customers' booking details or internal IDs.
- **TEST-012**: Test repeated extension (extensionCount > 0) — assert pricing is rebased on full new duration, not incremental.

---

## 7. Risks & Assumptions

- **RISK-001**: `vehicleSwapService.performVehicleSwap()` internals may need review to ensure it works within an existing Prisma transaction (accepts `tx` parameter). If not, the swap must be done manually inside the extension commit transaction.
- **RISK-002**: The `extensionPricingService` must correctly replicate the original pricing logic used during booking creation. Any discrepancy in rate calculation between booking creation and extension recalculation will produce incorrect `additionalAmount`. Mitigate by extracting shared pricing logic into a utility.
- **RISK-003**: If a customer extension payment (ONLINE) is processed but the booking commit fails (DB error after payment), money is collected but dates not updated. Mitigate: use `prisma.$transaction()` to ensure payment record and booking update are atomic. PaymentTransaction is created inside the same transaction.
- **RISK-004**: Redis lock TTL of 60s may be insufficient for slow DB transactions under load. Mitigate: monitor p95 transaction duration. Increase TTL to 120s if needed.
- **RISK-005**: `affectedBookingIds Int[]` on `BookingExtension` uses a Prisma scalar list. This is PostgreSQL-native (`integer[]`) and not supported on all DB engines. Assumption: the project uses PostgreSQL (Neon) — confirmed by existing schema usage of `@db.Decimal` and array fields elsewhere.
- **RISK-006**: Customer-facing extension routes require identifying the customer auth middleware. Assumption: a customer JWT middleware exists. If not, it must be created before TASK-029 and TASK-032.

- **ASSUMPTION-001**: The project uses PostgreSQL (Neon) — confirmed by existing `@db.Decimal`, `String[]` fields in schema.
- **ASSUMPTION-002**: `VehicleSwap` model has a `tx` parameter in `performVehicleSwap()` or equivalent mechanism to run inside a Prisma transaction.
- **ASSUMPTION-003**: `booking.totalFinal` is the authoritative total-due figure at any point in time and is updated by the extension commit.
- **ASSUMPTION-004**: Branch-level vehicle category pricing is accessible via `VehiclePricingOverride` or `VehicleCustomPricing` models already in the schema — used by `extensionPricingService`.
- **ASSUMPTION-005**: `EXTENSION` purpose in `PaymentPurpose` enum correctly flows through all existing payment infra (cash confirmation, financial state, settlement) without modification.

---

## 8. Related Specifications / Further Reading

- `plan/feature-payment-cash-management-1.md` — Payment transaction, cash shift, and financial state engine specifications.
- `plan/ui-payment-cash-management-flows.md` — UI/UX flows for cash confirmation, settlements, and refunds (also applies to extension payments).
- `plan/feature-discount-system-1.md` — Discount rule evaluation logic reused by `extensionPricingService`.

---

## Appendix — UI/UX Flow Reference (Developer Reference Only)

> This section documents the expected UI flows for frontend developers building the extension feature. No frontend code is included. All IDs in API paths are `publicId` strings. Currency values are `Decimal` strings (e.g., `"1500.00"`).

---

### UI Flow A — Employee: Extension at Pickup or During Rental

**Entry point:** Booking detail screen → `[Extend Booking]` button.
Visible when `booking.status` is `CONFIRMED` or `PICKED_UP`.

#### Step 1 — Select New End Date

```
┌─────────────────────────────────────────────────────────────┐
│  Extend Booking — BK-20250322                                │
│                                                              │
│  Current end date:    25 Mar 2026, 06:00 PM                 │
│  New end date:        [  Date Picker  ]  [  Time Picker  ]  │
│  Notes (optional):   [_______________________________]      │
│                                                              │
│              [Cancel]       [Check Availability →]          │
└─────────────────────────────────────────────────────────────┘
```

**Validation:** New end date must be > current `booking.endAt`.

---

#### Step 2 — Availability & Pricing Result

**API call:** `POST /api/employee/extension/evaluate`
```json
{
  "bookingPublicId": "abc123...",
  "newEndAt": "2026-03-28T18:00:00.000Z"("use date-fns to get the current time and date and add the extension duration to it always send in ist formaat")
}
```

**Response includes:** `extensionPublicId`, `additionalAmount`, `newTotalFinal`, `resolutionOptions[]`, `pricing`.

**Case A — No conflict (SAME_VEHICLE option only):**

```
┌─────────────────────────────────────────────────────────────┐
│  Extension Available ✓                                       │
│                                                              │
│  Current vehicle (MH-12-AB-3456) is available for           │
│  the extended duration.                                      │
│                                                              │
│  Duration:       3 days → 7 days  (+4 days)                 │
│  Original total: ₹  6,000                                   │
│  New total:      ₹ 12,500                                   │
│  Additional due: ₹  6,500                                   │
│                                                              │
│  Payment Method: ○ Cash   ○ Online   ○ Split                │
│  Amount:         [₹ 6,500]  (pre-filled, not editable)      │
│                                                              │
│  [← Back]           [Confirm & Collect Payment]             │
└─────────────────────────────────────────────────────────────┘
```

---

**Case B — Conflict: Choose Resolution:**

```
┌─────────────────────────────────────────────────────────────┐
│  Vehicle Conflict — Choose Resolution                        │
│                                                              │
│  ⚠ MH-12-AB-3456 is booked from 27 Mar onwards.            │
│                                                              │
│  Resolution Options:                                         │
│                                                              │
│  ○ Swap current vehicle to an available equivalent           │
│    → Available: [Honda Activa MH-01-XY-5678 ▾]             │
│                                                              │
│  ○ Reassign the conflicting future booking's vehicle         │
│    → Future booking (BK-20250327) will be moved to          │
│      Honda City MH-14-CD-9012                               │
│                                                              │
│  ○ Extend partially (up to 26 Mar only)                     │
│    → Additional 1 day / ₹ 1,800 additional                 │
│                                                              │
│               [← Back]    [Proceed with Selected →]         │
└─────────────────────────────────────────────────────────────┘
```

> **UX note:** Never show the future customer's name. Show only the internal booking reference (not customer PII). The employee can see this but it should be a booking reference, not the customer's name, to minimize accidental disclosure.

---

#### Step 3 — Payment Collection

Same payment collection UI as the main payment flow (Cash / Online / Split). Idempotency key is auto-generated from the `extensionPublicId` + timestamp.

**API call:** `POST /api/employee/extension/commit`
```json
{
  "extensionPublicId": "ext_abc...",
  "resolutionType": "SWAP_CURRENT_TO_OTHER",
  "selectedVehicleId": "veh_xyz...",
  "paymentMethod": "CASH",
  "cashAmount": 6500,
  "idempotencyKey": "auto-generated"
}
```

**Response states:**

| `extensionStatus` | UI toast |
|-------------------|----------|
| `CONFIRMED` | "Booking extended to 28 Mar. Payment confirmed." |
| `PAYMENT_COLLECTED` | "Cash collected — awaiting manager confirmation to finalize extension." |

---

### UI Flow B — Customer: Pre-Pickup Extension (Self-Service)

**Entry point:** Customer booking detail page → `[Request Extension]` button.
Only visible if `booking.status === CONFIRMED`.

#### Step 1 — Select New Date

```
┌─────────────────────────────────────────────────────────────┐
│  Extend Your Booking                                         │
│                                                              │
│  Current end date:    25 Mar 2026                           │
│  New end date:        [  Date Picker  ]                     │
│                                                              │
│              [Cancel]      [Check →]                        │
└─────────────────────────────────────────────────────────────┘
```

**API call:** `POST /api/customer/bookings/{bookingPublicId}/extension/evaluate`
```json
{ "newEndAt": "2026-03-28T18:00:00.000Z" }
```

#### Step 2 — Customer-Safe Result

Show only ONE of these views — never show the resolution picker or conflict details:

**Vehicle available:**
```
Extension available for the full duration.
Additional charge: ₹ 6,500  [Pay Online →]
```

**Vehicle swapped internally (customer sees a seamless message):**
```
Extension confirmed with an equivalent vehicle.
Additional charge: ₹ 6,500  [Pay Online →]
```

**Partial extension only:**
```
Full extension not available. We can extend until 26 Mar.
Additional charge: ₹ 1,800  [Accept Partial →]  [Cancel]
```

**No extension available:**
```
Sorry, no extension is available for the requested dates.
Please contact the branch for assistance.
```

> **UX principle:** The customer never sees conflict details, other bookings, or vehicle swap logic. The system picks the best safe resolution automatically for customer flows.

---

### UI Flow C — Manager: Cash-Pending Extension Dashboard

Extension payments that are `PAYMENT_COLLECTED` (cash collected but not confirmed) appear in the existing **Cash Confirmations** dashboard (`GET /payment/cash/pending`). The transaction purpose will show as `EXTENSION`.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Pending Cash Confirmations                                            │
│                                                                        │
│  Booking     │ Purpose    │ Employee  │ Amount    │ Collected │ Action │
│ ───────────  │ ─────────  │ ──────── │ ──────── │ ───────── │ ─────  │
│  BK-20250322 │ Extension  │ Raj K.   │ ₹ 6,500  │ 10 min ago│ [Review]│
└───────────────────────────────────────────────────────────────────────┘
```

On confirming the cash payment via `POST /payment/cash/{publicId}/confirm`, the system automatically calls `extensionService.finalizeAfterPayment()` which updates the booking dates. The manager does not need to take a separate "confirm extension" action.

---

### UI Flow D — Booking Detail: Extension History

On any booking detail screen (employee or manager view), show the extension history:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Extension History  (2 extensions)                                    │
│                                                                       │
│  #  │ Extended To    │ Additional  │ Resolution         │ Status      │
│ ─── │ ───────────── │ ─────────── │ ─────────────────  │ ──────────  │
│  1  │ 25 Mar → 28 Mar│ ₹ 6,500   │ Same vehicle       │ [Confirmed] │
│  2  │ 28 Mar → 30 Mar│ ₹ 3,200   │ Vehicle swapped    │ [Confirmed] │
└──────────────────────────────────────────────────────────────────────┘
```

**API call:** `GET /api/branchManager/extension?bookingPublicId={publicId}`

---

### UI Flow E — Displaced Booking Indicator

If a booking's vehicle was swapped because another customer extended their rental, the booking detail screen shows a banner:

```
┌──────────────────────────────────────────────────────────────┐
│  ℹ Vehicle Reassigned                                        │
│  This booking's vehicle was changed to accommodate an        │
│  extension request. New vehicle: Honda City MH-14-CD-9012.  │
│  Reassigned on: 22 Mar 2026, 11:30 AM                       │
└──────────────────────────────────────────────────────────────┘
```

**Data source:** `booking.extensionDisplacedAt !== null && booking.displacedByExtensionId !== null`

---

### State Badge Reference — Extension Status

| `extensionStatus` | Badge Label | Color |
|-------------------|-------------|-------|
| `PENDING_PAYMENT` | Awaiting Payment | Orange |
| `PAYMENT_COLLECTED` | Cash Collected | Yellow |
| `CONFIRMED` | Confirmed | Green |
| `REJECTED` | Rejected | Red |
| `CANCELLED` | Cancelled | Grey |

### API Quick Reference — Extension Endpoints

| Role | Method | Path | Description |
|------|--------|------|-------------|
| Employee | `POST` | `/api/employee/extension/evaluate` | Evaluate extension options |
| Employee | `POST` | `/api/employee/extension/commit` | Commit extension with payment |
| Employee | `POST` | `/api/employee/extension/:publicId/cancel` | Cancel pending extension |
| Manager | `POST` | `/api/branchManager/extension/evaluate` | Evaluate extension options |
| Manager | `POST` | `/api/branchManager/extension/commit` | Commit extension with payment |
| Manager | `POST` | `/api/branchManager/extension/:publicId/cancel` | Cancel pending extension |
| Manager | `GET` | `/api/branchManager/extension` | List all branch extensions |
| Manager | `GET` | `/api/branchManager/extension/:publicId` | Get extension detail |
| Manager | `GET` | `/api/branchManager/extension/displaced-bookings` | Bookings displaced by extensions |
| Customer | `POST` | `/api/customer/bookings/:bookingPublicId/extension/evaluate` | Customer evaluate |
| Customer | `POST` | `/api/customer/extension/commit` | Customer commit (online only) |
| Customer | `GET` | `/api/customer/extension/:extensionPublicId` | Customer get status |
