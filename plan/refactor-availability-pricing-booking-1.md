---
goal: Optimize Vehicle Listing, Availability, Pricing & Booking Flow
version: 1.0
date_created: 2026-03-24
last_updated: 2026-03-24
owner: VRMS Backend Team
status: 'Planned'
tags: [refactor, performance, architecture, bug]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan optimizes the vehicle listing, availability checking, pricing calculation, and booking creation flow in the VRMS backend. The primary goals are: eliminate N+1 database queries by batching all booking lookups into a single query; centralize availability logic (including Redis holds) into one reusable utility function; fix the pricing slab bug where 13-hour durations map incorrectly; refactor pricing to return only minimal data on listing and full data on details/booking; implement targeted cache invalidation keyed by vehicleId; and ensure all three APIs (listing, details, booking) share the same core utility functions to prevent discrepancies.

---

## 1. Requirements & Constraints

- **REQ-001**: The correct booking overlap condition is `requestedStart < bookingEnd AND requestedEnd > bookingStart`. The current `checkAvailability.ts` uses `startAt: { lte: end }, endAt: { gte: start }` which is equivalent — it must remain so.
- **REQ-002**: Only bookings with status `CONFIRMED`, `ACTIVE`, or `PICKED_UP` block availability. The current implementation incorrectly includes `HOLD` status — this must be corrected to exclude `HOLD`.
- **REQ-003**: `actualReturnTime` on a booking (if present) must be used as the effective `endAt` when evaluating availability. An early return must free the vehicle.
- **REQ-004**: All three APIs (listing `getPublicVehicles`, details `getPublicVehiclesDetails`, booking `createEmployeeBooking`) must use the same centralized availability check function.
- **REQ-005**: The listing API must not run full `calculateBookingPrice` per vehicle. It must call `calculateListingPrice` (already exists) or only return `price24Hour` base slab price — no discount evaluation per vehicle in listing.
- **REQ-006**: The pricing bug must be fixed: durations between 12–24 hours (e.g., 13 hours) must correctly map to `FULL_DAY` — the `DurationCalculatorService` already handles this correctly (lines 74–77), but `calcMultiDayPrice.ts` used in `createEmployeeBooking` uses calendar-day logic instead of hour-based logic. Booking must use `DurationCalculatorService` and `PricingEngineService`, not `calcMultiDayPrice`.
- **REQ-007**: Redis holds must be checked within the same availability function using a structured key pattern `hold:vehicle:{vehicleId}:{timestamp}` or a set `holds:vehicle:{vehicleId}`.
- **REQ-008**: Cache invalidation must be targeted: use `vehicle:{id}:availability` and `vehicle:{id}:pricing` keys and invalidate only the affected vehicle(s) on booking create/update/delete — not a SCAN/DEL of all `public:vehicles:*` keys.
- **REQ-009**: Availability cache TTL must be short (≤ 30 seconds) due to dynamic nature. Pricing cache TTL can be longer (300 seconds) since it changes only on config updates.
- **REQ-010**: IST-based time handling via `TimezoneService` and Luxon must remain the single source of truth for all datetime operations. No raw `new Date()` or UTC normalization inside availability/pricing logic.
- **CON-001**: No changes to Prisma schema — all fixes must work with the existing database models.
- **CON-002**: No changes to `TimezoneService` — it is already correct.
- **CON-003**: No changes to the `DurationCalculatorService` — it is already correct. The bug is in downstream callers.
- **CON-004**: No changes to the Charge Engine or Discount Engine internal logic.
- **CON-005**: Backward-compatible response shapes — the existing API response fields must remain present for all consumers.
- **GUD-001**: All new shared utility functions must be placed in `apps/backend/src/utils/availability/` or `apps/backend/src/utils/pricing/` as appropriate.
- **GUD-002**: Logging must be added via `console.warn` / `console.error` (existing pattern) around slow or critical paths.
- **PAT-001**: Use existing `prisma` client import from `@repo/database/client`. No new ORM patterns.
- **PAT-002**: Use existing `redis` import from `../../lib/redisconfig.js` for all Redis operations.
- **PAT-003**: All datetime comparisons must use `TimezoneService.toPrisma()` before passing to Prisma queries.

---

## 2. Implementation Steps

### Implementation Phase 1 — Centralize & Fix Availability Logic

- GOAL-001: Create a single reusable `checkAvailabilityBatch` utility that: (a) accepts multiple vehicleIds and a date range; (b) fetches all overlapping bookings in ONE query; (c) maps results by vehicleId in memory; (d) checks active Redis holds; (e) respects `actualReturnTime`; (f) uses correct statuses (`CONFIRMED`, `ACTIVE`, `PICKED_UP` — excluding `HOLD`).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `apps/backend/src/utils/availability/availabilityBatch.ts`. Export `async function fetchConflictingBookingsByRange(vehicleIds: number[], start: Date, end: Date): Promise<Map<number, boolean>>`. Single Prisma query: `prisma.booking.findMany({ where: { status: { in: ["CONFIRMED", "ACTIVE", "PICKED_UP"] }, startAt: { lt: end }, endAt: { gt: start }, items: { some: { vehicleId: { in: vehicleIds } } } }, select: { startAt: true, endAt: true, actualReturnTime: true, items: { select: { vehicleId: true } } } })`. Loop results — for each booking item, compute effective end as `actualReturnTime ?? endAt`. Re-check overlap with effective end. Mark `vehicleId` as unavailable in the map. | | |
| TASK-002 | In the same file, export `async function checkHoldsForVehicles(vehicleIds: number[], start: Date, end: Date): Promise<Set<number>>`. Use `redis.keys("hold:vehicle:*")` or scan a Redis Set `holds:active` to find hold keys. For each hold key, parse the stored JSON `{ vehicleId, startAt, endAt }`. Check overlap: `holdStart < end && holdEnd > start`. Collect vehicleIds with conflicting holds into a Set and return it. | | |
| TASK-003 | In the same file, export `async function getUnavailableVehicleIds(vehicleIds: number[], start: Date, end: Date): Promise<Set<number>>`. Call `fetchConflictingBookingsByRange` and `checkHoldsForVehicles`. Union both result sets. Return final `Set<number>` of unavailable vehicleIds. | | |
| TASK-004 | Keep `checkVehicleAvailability` in `checkAvailability.ts` for backward compatibility but rewrite its internals to call `getUnavailableVehicleIds([vehicleId], start, end)`. Correct the status list from `["CONFIRMED", "PICKED_UP", "HOLD"]` to `["CONFIRMED", "ACTIVE", "PICKED_UP"]`. | | |
| TASK-005 | Add database index hint comment in `availabilityBatch.ts` referencing that `Booking.startAt`, `Booking.endAt`, and `BookingItem.vehicleId` should be indexed. Verify in `packages/db/prisma/schema.prisma` that `@@index([startAt, endAt])` exists on `Booking` model and `@@index([vehicleId])` exists on `BookingItem`. Add migration note if missing. | | |

### Implementation Phase 2 — Fix N+1 in Listing API

- GOAL-002: Refactor `getPublicVehicles` in `apps/backend/src/controller/public/vehicles.controller.ts` to use a single batch availability query instead of per-vehicle `checkVehicleAvailability` calls in a loop.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | In `getPublicVehicles`, after fetching the `vehicles` array (and applying in-memory `search`/`make`/`model` filters), collect all `vehicleId` values. If `startDate && endDate`, call `getUnavailableVehicleIds(vehicleIds, startPrisma, endPrisma)` once. Filter `filteredVehicles` by excluding any vehicleId present in the returned unavailable Set. Remove the per-vehicle `checkVehicleAvailability` call from the `for` loop. | | |
| TASK-007 | Refactor pricing in the listing loop: replace the per-vehicle `pricingEngine.calculateListingPrice(v.id, ...)` call (which runs `getVehiclePricing` + `determineBasePrice` + `discountEvaluation` per vehicle — 3+ DB queries each) with a batch pricing fetch. Create `apps/backend/src/utils/pricing/batchListingPrice.ts` that accepts an array of vehicle records (already in memory from the `findMany`) and computes only the `price24Hour` from `customPricing` or `branchPricingDefaults` via a single `findMany` query for each. Return a `Map<number, number>` of vehicleId → dailyPrice. | | |
| TASK-008 | In `batchListingPrice.ts`: (1) Query `prisma.vehicleCustomPricing.findMany({ where: { vehicleId: { in: vehicleIds }, enabled: true } })` to get all custom pricing in one call. (2) For vehicles without custom pricing, group by `branchId + categoryId` pairs and query `prisma.branchPricingDefaults.findMany({ where: { OR: [...pairs] } })` in one call. (3) Build and return the `Map<number, number>`. | | |
| TASK-009 | Update the `for` loop in `getPublicVehicles` to use the pre-built pricing map from TASK-008 instead of per-vehicle async calls. The `pricing.daily` value is `price24Hour` from the map. Remove `calculatePricingForVehicle` (fallback) call — use the map value directly as the fallback. | | |

### Implementation Phase 3 — Fix Pricing Bug in Booking API

- GOAL-003: Migrate `createEmployeeBooking` away from `calcMultiDayPrice` + `calculatePricingForVehicleFromRecord` + `getDiscountForDays` (legacy chain) to `PricingEngineService.calculateBookingPrice` (Phase 2 engine) so that duration classification is based on actual hours (via `DurationCalculatorService`) rather than calendar-day math.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | In `apps/backend/src/controller/employee/booking.controller.ts`, replace the per-vehicle pricing block (lines 254–311) inside `createEmployeeBooking`. For each vehicle `v`, call `await pricingEngine.calculateBookingPrice(v.id, startDateDt, endDateDt, v.branchId, customer.customerProfile!.id)` where `startDateDt`/`endDateDt` are the already-parsed Luxon `DateTime` objects. Remove imports of `calculatePricingForVehicleFromRecord`, `calculateMultiDayTotalPrice`, `getDiscountForDays`, `getDepositAmount`. | | |
| TASK-011 | Map the `PricingResult` fields to the existing `items` array fields: `baseTotal` ← `pricingResult.basePrice`, `discountAmount` ← `pricingResult.discountAmount`, `discountPercent` ← `pricingResult.discountPercent`, `deposit` ← `pricingResult.deposit`, `taxAmount` ← `pricingResult.taxAmount`, `cgstAmount` ← `pricingResult.cgstAmount`, `sgstAmount` ← `pricingResult.sgstAmount`, `taxRate` ← `pricingResult.taxRate`, `finalTotal` ← `pricingResult.finalTotal`, `days` ← `pricingResult.pricingBreakdown.duration.days`. Remove the separate `gstRule` fetch since `PricingEngineService.calculateTax` handles it internally. | | |
| TASK-012 | Add a final availability revalidation step before `prisma.$transaction` in `createEmployeeBooking`. After computing all pricing, call `getUnavailableVehicleIds(vehicleIds, startDate, endDate)` again. If any vehicleId is in the result, return 409 CONFLICT before creating the booking. This prevents race conditions between availability check and DB write. | | |
| TASK-013 | Add `PricingEngineService` import and instantiation at top of `booking.controller.ts` (same pattern as `vehicles.controller.ts` line 15). | | |

### Implementation Phase 4 — Integrate Redis Holds Into Availability

- GOAL-004: Define a structured Redis hold schema and integrate it into `getUnavailableVehicleIds` so that holds are checked atomically alongside DB bookings.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Define hold key schema: `hold:vehicle:{vehicleId}` as a Redis Hash with fields `startAt` (ISO string), `endAt` (ISO string), `bookingId` (string), `createdAt` (ISO string). TTL = 300 seconds (hold expiry). Document this schema in a comment at the top of `availabilityBatch.ts`. | | |
| TASK-015 | In `checkHoldsForVehicles` (TASK-002), use `redis.mget(...vehicleIds.map(id => \`hold:vehicle:\${id}\`))` to fetch all hold data in one round-trip. Parse each non-null result as `{ startAt, endAt }`. Check overlap and add to the returned Set. | | |
| TASK-016 | Wherever booking holds are currently set (identify by searching for `redis.set` with `HOLD` status or `hold:` key pattern in `createEmployeeBooking` or any other booking creation path), ensure the hold is written using the schema from TASK-014: `redis.set(\`hold:vehicle:\${vehicleId}\`, JSON.stringify({ startAt, endAt, bookingId, createdAt }), "EX", 300)`. | | |
| TASK-017 | When a booking transitions from `HOLD` to `CONFIRMED` or is cancelled/expired, delete the hold key: `redis.del(\`hold:vehicle:\${vehicleId}\`)`. Add this in any booking status-update controller or the `bookingExpiry.worker.ts`. | | |

### Implementation Phase 5 — Targeted Cache Invalidation

- GOAL-005: Replace the SCAN-based `public:vehicles:*` cache wipe (current pattern in `createEmployeeBooking` lines 425–439) with targeted per-vehicle key invalidation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Define cache key helpers in a new file `apps/backend/src/utils/cache/vehicleCacheKeys.ts`: `vehicleAvailabilityKey(vehicleId: number) => \`vehicle:\${vehicleId}:availability\`` and `vehiclePricingKey(vehicleId: number) => \`vehicle:\${vehicleId}:pricing\``. | | |
| TASK-019 | In `createEmployeeBooking`, after the `$transaction` succeeds, replace the SCAN loop with: `await redis.del(...vehiclesData.map(v => vehicleAvailabilityKey(v.id)))`. Add `await redis.del(...vehiclesData.map(v => vehiclePricingKey(v.id)))` if pricing cache is added. | | |
| TASK-020 | In `getPublicVehicles`, cache the final result using a short TTL (30 seconds) and also cache individual availability results using `vehicleAvailabilityKey`. When checking availability in the listing, check `vehicleAvailabilityKey` first in Redis before querying DB — but only if no active holds exist for that vehicle. | | |
| TASK-021 | Wherever vehicle pricing config is updated (admin controllers for `branchPricingDefaults` or `vehicleCustomPricing`), invalidate `vehiclePricingKey(vehicleId)` for the affected vehicles. Search `apps/backend/src/controller/admin/` for pricing update handlers and add invalidation calls. | | |
| TASK-022 | Set TTL policy: `vehicle:{id}:availability` → 30 seconds. `vehicle:{id}:pricing` → 300 seconds. `public:vehicles:{filters}` → 30 seconds (down from current 60 seconds). Update the `redis.set(..., "EX", 60)` call at the bottom of `getPublicVehicles` to use 30 seconds. | | |

### Implementation Phase 6 — Consistency Audit & Shared Utility Enforcement

- GOAL-006: Ensure no API path duplicates availability or pricing logic. Audit and consolidate.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | Audit `apps/backend/src/controller/public/vehicles.controller.ts` (`getPublicVehiclesDetails`) to confirm it uses `checkVehicleAvailability` (which now delegates to `getUnavailableVehicleIds`) and `pricingEngine.calculateBookingPrice`. Verify no duplicate pricing fetch paths. | | |
| TASK-024 | Audit `apps/backend/src/services/extension/extension-availability.service.ts`. Confirm it either reuses `checkVehicleAvailability` or calls `getUnavailableVehicleIds` directly. If it has its own DB query for availability, replace with the shared utility. | | |
| TASK-025 | Search codebase for any remaining direct `prisma.booking.findFirst/findMany` calls that implement availability logic (pattern: `status: { in: [...] }, startAt: ..., endAt: ...`). Enumerate all occurrences. Replace each with a call to the shared utility. | | |
| TASK-026 | Deprecate `apps/backend/src/utils/pricing/calcMultiDayPrice.ts` — add a `@deprecated` JSDoc comment and a `console.warn` at runtime: `"calcMultiDayPrice is deprecated; use PricingEngineService.calculateBookingPrice"`. Do not delete (may be referenced elsewhere). | | |
| TASK-027 | Deprecate `apps/backend/src/utils/pricing/calcPricing.ts` the same way — it creates a new `PricingEngineService()` on every call with a 24-hour baseline, which is wasteful. Add deprecation notice. In `getPublicVehicles`, remove the call to `calculatePricingForVehicle` (replaced by batch pricing in TASK-009). | | |

### Implementation Phase 7 — Logging & Monitoring

- GOAL-007: Add structured logging around slow/critical paths for observability.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-028 | In `getPublicVehicles`, add `console.time` / `console.timeEnd` around: (1) the Prisma `findMany` vehicles query, (2) the `getUnavailableVehicleIds` call, (3) the batch pricing call. Log with label format `[perf] listing:{branchId}:{phase}`. | | |
| TASK-029 | In `getUnavailableVehicleIds`, log the number of vehicleIds queried and the number of conflicting bookings found: `console.log(\`[availability] queried \${vehicleIds.length} vehicles, found \${conflictCount} conflicts\`)`. | | |
| TASK-030 | In `createEmployeeBooking`, log the revalidation step outcome: `console.log(\`[booking] revalidation: \${unavailable.size} conflicts found before DB write\`)`. | | |

---

## 3. Alternatives

- **ALT-001**: Use a reservation/slot table instead of query-time availability checks. Rejected — requires schema change (violates CON-001) and would be a major architectural change beyond scope.
- **ALT-002**: Move all availability checking to a dedicated microservice. Rejected — adds infrastructure complexity; the goal is in-process optimization.
- **ALT-003**: Use Prisma `groupBy` to get conflict counts instead of full booking fetch. Rejected — `actualReturnTime` fallback logic requires per-booking data.
- **ALT-004**: Cache the full vehicle list (with availability baked in) for each date range. Rejected — date ranges are continuous and unbounded; cache would have zero hit rate for unique queries. Short TTL + targeted invalidation is preferred.
- **ALT-005**: Replace `calcMultiDayPrice` with a direct hours-based formula instead of routing through `PricingEngineService`. Rejected — `PricingEngineService` already has the correct logic and discount integration; duplicating it creates the exact divergence problem we are solving.

---

## 4. Dependencies

- **DEP-001**: `@repo/database/client` — Prisma client with `Booking`, `BookingItem`, `Vehicle`, `VehicleCustomPricing`, `BranchPricingDefaults` models.
- **DEP-002**: `../../lib/redisconfig.js` — Redis client (ioredis), already connected.
- **DEP-003**: `PricingEngineService` from `../../services/pricing/pricing-engine.service.js` — must remain the single source for booking price calculation.
- **DEP-004**: `DurationCalculatorService` from `../../services/pricing/duration-calculator.service.js` — used internally by `PricingEngineService`; no direct calls needed from controllers.
- **DEP-005**: `TimezoneService` from `../../services/timezone/timezone.service.js` — all datetime parsing and conversion.
- **DEP-006**: Luxon `DateTime` — for all in-memory datetime arithmetic.

---

## 5. Files

- **FILE-001**: `apps/backend/src/utils/availability/checkAvailability.ts` — Existing file. TASK-004 updates internals to delegate to new batch utility.
- **FILE-002**: `apps/backend/src/utils/availability/availabilityBatch.ts` — **New file**. Core of Phase 1. Contains `fetchConflictingBookingsByRange`, `checkHoldsForVehicles`, `getUnavailableVehicleIds`.
- **FILE-003**: `apps/backend/src/utils/pricing/batchListingPrice.ts` — **New file**. Phase 2. Contains `getBatchListingPrices(vehicleIds, vehicles): Promise<Map<number, number>>`.
- **FILE-004**: `apps/backend/src/utils/cache/vehicleCacheKeys.ts` — **New file**. Phase 5. Cache key helpers.
- **FILE-005**: `apps/backend/src/controller/public/vehicles.controller.ts` — Modified in TASK-006, TASK-007, TASK-009, TASK-020, TASK-022, TASK-023.
- **FILE-006**: `apps/backend/src/controller/employee/booking.controller.ts` — Modified in TASK-010, TASK-011, TASK-012, TASK-013, TASK-019.
- **FILE-007**: `apps/backend/src/services/extension/extension-availability.service.ts` — Audit in TASK-024, potential modification.
- **FILE-008**: `apps/backend/src/utils/pricing/calcMultiDayPrice.ts` — Deprecated in TASK-026. No deletion.
- **FILE-009**: `apps/backend/src/utils/pricing/calcPricing.ts` — Deprecated in TASK-027. No deletion.
- **FILE-010**: `apps/backend/src/jobs/bookingExpiry.worker.ts` — Modified in TASK-017 to delete Redis hold keys on expiry.
- **FILE-011**: `packages/db/prisma/schema.prisma` — Audit only in TASK-005. No changes unless index is missing.

---

## 6. Testing

- **TEST-001**: Unit test `fetchConflictingBookingsByRange` with mocked Prisma: verify single query is issued; verify `actualReturnTime` overrides `endAt`; verify `HOLD` status is excluded; verify correct overlap condition (`startAt < end AND endAt > start`).
- **TEST-002**: Unit test `checkHoldsForVehicles` with mocked Redis: verify `mget` is called with correct keys; verify overlap detection is correct; verify expired holds (empty Redis response) return empty Set.
- **TEST-003**: Unit test `getUnavailableVehicleIds` with mocked sub-functions: verify union of DB conflicts and hold conflicts is returned.
- **TEST-004**: Integration test for `getPublicVehicles` with 50 vehicles: verify exactly ONE `Booking` query is made (not 50); verify pricing uses batch query (not per-vehicle calls).
- **TEST-005**: Unit test `getBatchListingPrices`: verify single `VehicleCustomPricing.findMany` and at most one `BranchPricingDefaults.findMany`; verify custom pricing takes precedence over branch defaults.
- **TEST-006**: Integration test for `createEmployeeBooking` with 13-hour duration: verify `PricingEngineService` is called; verify period type is `FULL_DAY` (not multi-day); verify price is `price24Hour` (not `price24Hour * 2`).
- **TEST-007**: Race condition test for `createEmployeeBooking`: create a booking for a vehicle; attempt to create a second overlapping booking simultaneously; verify the second booking returns 409 CONFLICT from the revalidation step (TASK-012).
- **TEST-008**: Cache invalidation test: create a booking for vehicleId 5; verify `vehicle:5:availability` is deleted from Redis after the transaction.
- **TEST-009**: Test early return scenario: vehicle booked from T to T+5h with `actualReturnTime` at T+3h; verify vehicle is available for query range T+3h to T+8h.
- **TEST-010**: Regression test for `getPublicVehiclesDetails`: verify `checkVehicleAvailability` is called (delegates to new utility); verify `pricingEngine.calculateBookingPrice` is called; verify response shape is unchanged.

---

## 7. Risks & Assumptions

- **RISK-001**: The `ACTIVE` booking status — the current `checkAvailability.ts` uses `CONFIRMED`, `PICKED_UP`, `HOLD`. The requirement states `CONFIRMED`, `ACTIVE`, `PICKED_UP`. Verify that `ACTIVE` is a valid `BookingStatus` enum value in `packages/db/prisma/schema.prisma` before adding it. If it does not exist, use only `CONFIRMED` and `PICKED_UP`.
- **RISK-002**: Redis hold keys may not currently follow the `hold:vehicle:{vehicleId}` schema defined in TASK-014. A codebase search for existing `redis.set` calls with `hold` in the key pattern must be performed before TASK-016 to avoid breaking existing hold logic.
- **RISK-003**: `mget` for hold keys (TASK-015) may return null for vehicles with no holds — null values must be filtered before JSON parsing to avoid exceptions.
- **RISK-004**: `getBatchListingPrices` (TASK-008) queries `branchPricingDefaults` grouped by `branchId + categoryId`. If the same branch+category pair appears many times in the vehicle list, one query covers all — this is safe. If Prisma does not support `OR` with composite conditions efficiently, a `findMany` with `branchId: { in: [...] }` filtered in memory is an acceptable fallback.
- **RISK-005**: The `calcMultiDayPrice` deprecation (TASK-026) may break other callers that have not been audited. Perform a grep for `calcMultiDayPrice` before adding the runtime warning to quantify impact.
- **RISK-006**: `PricingEngineService.calculateBookingPrice` makes multiple DB calls internally (vehicle, customPricing, branchDefaults, categoryId, deposit, GSTRule). In the booking flow (single vehicle at a time), this is acceptable. In listing (50 vehicles), this is NOT used — the batch pricing replaces it. Ensure TASK-007 does not inadvertently reintroduce per-vehicle pricing engine calls in listing.
- **ASSUMPTION-001**: The `BookingItem` table has a `vehicleId` foreign key that is indexed. If not, the batch availability query will be slow — TASK-005 must verify this.
- **ASSUMPTION-002**: The `Booking` table's `startAt` and `endAt` columns are indexed. If not, TASK-005 must create a migration to add the index.
- **ASSUMPTION-003**: Booking holds are currently managed as Redis keys somewhere in the codebase (possibly within the public booking flow, not the employee flow). The employee booking flow creates bookings with `status: HOLD` in the DB — it does not appear to set a Redis hold key currently. TASK-016 may be adding new behavior rather than fixing existing behavior.
- **ASSUMPTION-004**: The `ACTIVE` status referenced in requirements corresponds to `PICKED_UP` in the current schema. Verify enum values before implementation.

---

## 8. Related Specifications / Further Reading

- `apps/backend/src/utils/availability/checkAvailability.ts` — current availability implementation (3 status values, per-vehicle query)
- `apps/backend/src/controller/public/vehicles.controller.ts` — listing and detail endpoints with N+1 pattern
- `apps/backend/src/controller/employee/booking.controller.ts` — booking creation with legacy pricing chain
- `apps/backend/src/services/pricing/pricing-engine.service.ts` — Phase 2 pricing engine (correct slab logic)
- `apps/backend/src/services/pricing/duration-calculator.service.ts` — correct hour-based duration classification
- `apps/backend/src/utils/pricing/calcMultiDayPrice.ts` — legacy calendar-day pricing (source of 13-hour bug)
- `apps/backend/src/services/extension/extension-lock.service.ts` — existing Redis lock pattern (reference for hold key design)
- `packages/db/prisma/schema.prisma` — authoritative model definitions and index declarations
