---
goal: Group duplicate make/model vehicles on listing page with atomic per-user vehicle assignment
version: 1.0
date_created: 2026-04-25
last_updated: 2026-04-25
owner: manish076
status: 'In progress'
tags: [feature, ux, booking, race-condition, backend, frontend]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

A branch can have 3–4 vehicles with the same `make` and `model` but different registration numbers. The current listing page shows each physical vehicle as a separate card, causing visual clutter and forcing users to scroll through identical-looking entries. The fix must group these into a single card while safely resolving which specific vehicle each user receives at booking time — preventing two users from ever being assigned the same physical vehicle.

---

## 1. Requirements & Constraints

- **REQ-001**: The listing page must show one card per unique `make + model + category + branch` combination, not one card per physical vehicle.
- **REQ-002**: Each grouped card must display the count of currently available vehicles (`availableCount`).
- **REQ-003**: When a user selects a grouped card and proceeds to booking, the system must atomically assign one specific physical vehicle from the group, guaranteed unique per confirmed booking.
- **REQ-004**: If two users simultaneously request the last available vehicle in a group, exactly one must succeed; the other must receive a clear "no vehicles available" error rather than a silent double-assignment.
- **REQ-005**: The vehicle details page must show group-level information (make, model, category, representative images, pricing) with an `availableCount` indicator.
- **REQ-006**: The booking creation endpoint must accept either a specific `vehiclePublicId` (existing flow for admin/manager direct booking) OR a `groupKey` (new public flow), maintaining full backwards compatibility.
- **REQ-007**: Redis availability caches must be invalidated at group level when any vehicle in a group changes status or a hold is created/expired.
- **REQ-008**: Pricing displayed on the group card must reflect the lowest available base price within the group when vehicles have differing custom pricing.
- **UX-001**: If all vehicles in a group are unavailable for a requested date range, the group card must show a "Not available for selected dates" state rather than disappearing silently.
- **UX-002**: Single-vehicle groups must behave identically to the current flow — no UX regression for those branches.
- **CON-001**: No new Prisma model (no `VehicleGroup` table). Grouping is computed at query time using the existing `@@index([make, model])` and `@@index([branchId, categoryId, status])` compound indexes.
- **CON-002**: The atomic assignment must use a Prisma interactive transaction (`prisma.$transaction(async (tx) => {...})`) with a `SELECT ... FOR UPDATE` equivalent — achieved via `tx.vehicle.findFirst({ where: {...}, orderBy: {...} })` inside the transaction with row-level locking using Prisma's `$queryRawUnsafe` only if needed.
- **CON-003**: The existing `vehicle_holds:{vehiclePublicId}` Redis key structure must not change — new group-level cache keys are additive only.
- **PAT-001**: Follow the existing controller → service → utility pattern used by `vehicles.controller.ts` and `availabilityBatch.ts`.
- **PAT-002**: All new API routes must be registered in `apps/backend/src/routes/public/vehicle.routes.ts` following existing naming conventions.

---

## 2. Implementation Steps

### Implementation Phase 1 — Backend: Grouped Listing Endpoint

- GOAL-001: Modify the public vehicle listing API to return one entry per `make+model+category+branch` group instead of one entry per physical vehicle, with an `availableCount` and a stable `groupKey`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `apps/backend/src/controller/public/vehicles.controller.ts`, add a new internal helper function `buildGroupKey(make: string, model: string, categoryId: number, branchId: number): string` that returns the deterministic string `${make}__${model}__${categoryId}__${branchId}` (double-underscore separator to avoid collisions with spaces). | ✅ | 2026-04-25 |
| TASK-002 | In the same file, modify the `getPublicVehicles` controller function: after fetching the flat list of available vehicles from Prisma (lines ~23–270), add a post-query grouping step that uses a `Map<string, GroupedVehicle>` keyed by `groupKey`. For each vehicle, if the key is new, create an entry with fields: `groupKey`, `make`, `model`, `category`, `branch`, `availableCount: 1`, `minDailyPrice` (from the vehicle's resolved pricing), `imageUrl` (first thumbnail found). If the key already exists, increment `availableCount` and update `minDailyPrice` if the vehicle's price is lower. | ✅ | 2026-04-25 |
| TASK-003 | Update the response serialization in `getPublicVehicles` to return `Array.from(groupMap.values())` instead of the raw vehicle array. Each entry must include: `groupKey`, `make`, `model`, `category`, `branch`, `availableCount`, `imageUrl`, `pricing: { daily: minDailyPrice }`. Remove `publicId` and `regNo` from listing response — these are individual vehicle fields that must not leak at group level. | ✅ | 2026-04-25 |
| TASK-004 | Update the Redis cache key for the grouped listing from the existing format to `public:vehicles:grouped:{branchId}:{categoryId}:{searchTerm}:{limit}:{offset}` so the new grouped shape is cached separately from the old per-vehicle shape (prevents stale cache serving old format during rollout). Set the same 30-second TTL as the existing listing cache. | ✅ | 2026-04-25 |
| TASK-005 | In `apps/backend/src/routes/public/vehicle.routes.ts`, verify the existing `GET /public/vehicles` route still maps to `getPublicVehicles` — no route change needed, the response shape changes transparently. | ✅ | 2026-04-25 |

### Implementation Phase 2 — Backend: Group Details Endpoint

- GOAL-002: Create a new endpoint `GET /public/vehicles/group/:groupKey` that returns all information a user needs to see on the vehicle details page for a grouped listing, including availability for a date range and representative pricing.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | In `apps/backend/src/controller/public/vehicles.controller.ts`, add a new controller function `getVehicleGroupDetails`. It must: (1) Parse `groupKey` from `req.params.groupKey` by splitting on `__` to extract `make`, `model`, `categoryId`, `branchId`. (2) Validate all four fields are present; return 400 if malformed. (3) Query all non-deleted vehicles matching `{ make, model, categoryId, branchId, deletedAt: null, insuranceExpiry: { gt: new Date() } }`. Return 404 if none exist. | ✅ | 2026-04-25 |
| TASK-007 | In `getVehicleGroupDetails`, if query params `startDate` and `endDate` are provided, call the existing `checkAvailabilityBatch(vehicleIds, startDate, endDate)` utility from `apps/backend/src/utils/availability/availabilityBatch.ts` to determine which vehicles in the group are free for that period. Set `availableCount` = count of vehicles NOT in the returned unavailable set. If no dates provided, `availableCount` = count of vehicles with `status === 'AVAILABLE'`. | ✅ | 2026-04-25 |
| TASK-008 | In `getVehicleGroupDetails`, compute `representativePricing` by calling `PricingEngineService.calculateBookingPrice()` for the first available vehicle in the group (or the vehicle with the lowest custom price). Return this as the `pricing` object. Include `pricingNote: "Price shown for the lowest-priced available vehicle"` if vehicles in the group have differing custom prices. | ✅ | 2026-04-25 |
| TASK-009 | Collect `images` across all vehicles in the group using `flatMap(v => v.images)`, deduplicate by `url`, and return up to 10 representative images. This gives the details page richer imagery even if individual vehicles have few photos. | ✅ | 2026-04-25 |
| TASK-010 | Register the new route in `apps/backend/src/routes/public/vehicle.routes.ts`: `router.get('/group/:groupKey', getVehicleGroupDetails)`. This route must be placed **before** the existing `router.get('/:id', getVehicleDetails)` route to prevent `:id` capturing the literal string `"group"`. | ✅ | 2026-04-25 |
| TASK-011 | Add Redis cache for group details: key `public:vehicles:group:{groupKey}:{startDate}:{endDate}`, TTL 30 seconds (same as listing). Invalidate this key alongside `vehicle_holds:{vehiclePublicId}` whenever a hold is created or released for any vehicle whose `groupKey` matches. | ✅ | 2026-04-25 |

### Implementation Phase 3 — Backend: Atomic Vehicle Assignment in Booking Creation

- GOAL-003: Modify the booking creation endpoint to accept a `groupKey` and atomically assign a specific uncontested vehicle from the group, eliminating the race condition where two users get the same vehicle.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | In `apps/backend/src/controller/booking/getBookInfo.controller.ts`, update the request body type to accept either `vehiclePublicId: string` (existing) OR `groupKey: string` per booking item. Add Zod (or existing validation library) discriminated union: `z.union([z.object({ vehiclePublicId: z.string() }), z.object({ groupKey: z.string() })])`. | ✅ | 2026-04-25 |
| TASK-013 | Add a new internal function `resolveVehicleFromGroup(groupKey: string, startDate: Date, endDate: Date, tx: PrismaTransactionClient): Promise<Vehicle>` inside `getBookInfo.controller.ts`. This function must: (1) Parse `groupKey` into `make`, `model`, `categoryId`, `branchId`. (2) Inside the transaction `tx`, fetch all vehicles matching the group with `status: 'AVAILABLE'`, ordered by `odo ASC` (prefer lower-mileage vehicles — gives fleet rotation). (3) For each candidate, call `checkAvailabilityBatch([vehicle.id], startDate, endDate)` within the transaction. (4) Return the first vehicle that has no conflicts. (5) Throw `AppError('NO_VEHICLE_AVAILABLE', 409)` if none found. | ✅ | 2026-04-25 |
| TASK-014 | Wrap the entire booking creation logic in `getBookInfo.controller.ts` in a Prisma interactive transaction (`prisma.$transaction(async (tx) => { ... }, { timeout: 10000 })`). This ensures that between `resolveVehicleFromGroup` finding a free vehicle and the `BookingItem` + `Booking` records being created, no concurrent transaction can assign the same vehicle. The existing Redis hold write must happen **after** the transaction commits — not inside it — to avoid distributed lock complexity. | ✅ | 2026-04-25 |
| TASK-015 | In the transaction, after `resolveVehicleFromGroup` returns a vehicle, immediately create the `Booking` (status: `HOLD`) and `BookingItem` records within the same transaction using `tx.booking.create(...)` and `tx.bookingItem.create(...)`. Because Prisma transactions are serializable at the row level for newly inserted rows, a second concurrent transaction attempting to create a `BookingItem` for the same vehicle and overlapping dates will either block or fail at the availability re-check inside `resolveVehicleFromGroup`. | ✅ | 2026-04-25 |
| TASK-016 | After the transaction commits successfully, write the Redis hold key `vehicle_holds:{vehicle.publicId}` (existing format, 10-min TTL) and invalidate the group listing cache keys: `public:vehicles:grouped:*` and `public:vehicles:group:{groupKey}:*` using Redis pattern delete (`KEYS` + `DEL` or a Lua script). This keeps the displayed `availableCount` accurate within 30 seconds. | ✅ | 2026-04-25 |
| TASK-017 | Update the error handler for `AppError('NO_VEHICLE_AVAILABLE', 409)` to return HTTP 409 with body `{ code: 'NO_VEHICLE_AVAILABLE', message: 'All vehicles of this type are currently unavailable for your selected dates. Please try again or choose different dates.' }`. This is the user-facing race condition error message. | ✅ | 2026-04-25 |

### Implementation Phase 4 — Frontend: Update Vehicle Listing Page

- GOAL-004: Update the frontend listing page to render grouped vehicle cards using the new API response shape, displaying `availableCount` and routing to the group details page.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | In `apps/frontend/src/services/vehicle.service.ts`, update the `fetchPublicVehicles()` return type. Replace the current per-vehicle type with a `GroupedVehicleListing` interface: `{ groupKey: string; make: string; model: string; category: {...}; branch: {...}; availableCount: number; imageUrl: string; pricing: { daily: number } }`. | ✅ | 2026-04-25 |
| TASK-019 | On the vehicle listing page component (locate via `Glob apps/frontend/src/**/*listing* or *vehicles*`), update the vehicle card to display an "Available: {availableCount}" badge. Use green badge for `availableCount >= 3`, yellow for `1–2`, and hide the card (or show greyed-out "Unavailable") for `availableCount === 0`. | ✅ | 2026-04-25 |
| TASK-020 | Update the listing page card's `onClick` / navigation link to route to `/vehicles/group/{groupKey}` instead of `/vehicles/{publicId}`. URL-encode the `groupKey` with `encodeURIComponent` since it contains double underscores and potentially spaces in make/model names. | ✅ | 2026-04-25 |
| TASK-021 | Update the booking item payload in the checkout/booking form. When coming from a group listing route (`/vehicles/group/:groupKey`), the booking request must send `{ groupKey }` instead of `{ vehiclePublicId }`. When coming from a direct vehicle link (admin path), send `{ vehiclePublicId }` as before. Detect the source from the route path or a route state flag. | ✅ | 2026-04-25 |

### Implementation Phase 5 — Frontend: Group Details Page

- GOAL-005: Add or update the vehicle details page to handle the group route (`/vehicles/group/:groupKey`), showing grouped information and the real-time available count.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | In `apps/frontend/src/services/vehicle.service.ts`, add a new function `fetchVehicleGroupDetails(groupKey: string, startDate?: string, endDate?: string): Promise<VehicleGroupDetails>` that calls `GET /public/vehicles/group/{encodeURIComponent(groupKey)}?startDate=...&endDate=...`. | ✅ | 2026-04-25 |
| TASK-023 | Create a route `/vehicles/group/:groupKey` in the frontend router pointing to a `VehicleGroupDetailsPage` component. This can reuse the existing `VehicleDetailsPage` layout — the difference is data source (`fetchVehicleGroupDetails` vs `fetchVehicleDetails`) and the booking payload shape. | ✅ | 2026-04-25 |
| TASK-024 | In the `VehicleGroupDetailsPage`, show: make, model, category name, branch name, representative images carousel (up to 10 images gathered across all group vehicles per TASK-009), pricing breakdown, and a prominent "Available now: {availableCount} vehicles" indicator. When date pickers change, re-fetch with the new date range to update `availableCount` dynamically. | ✅ | 2026-04-25 |
| TASK-025 | On the "Book Now" button in `VehicleGroupDetailsPage`, handle the HTTP 409 `NO_VEHICLE_AVAILABLE` response from TASK-017: show a toast/modal "All vehicles of this type are taken for your selected dates. Please choose different dates or try again shortly." Do not leave the user on a broken state. | ✅ | 2026-04-25 |

### Implementation Phase 6 — Cache Invalidation & Hold Expiry

- GOAL-006: Ensure that when a HOLD expires (10-minute timeout) or a booking is cancelled, the group's `availableCount` updates promptly so the listing reflects reality.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Locate the HOLD expiry job (search for `HOLD_EXPIRED` or the scheduled job that updates expired holds in the backend). In that job, after marking the booking as `HOLD_EXPIRED` and restoring vehicle availability, add a Redis invalidation step: delete `public:vehicles:group:{groupKey}:*` and `public:vehicles:grouped:*` cache keys for the affected vehicles' group keys. | | |
| TASK-027 | In `apps/backend/src/controller/payment/checkPayment.controller.ts` (around line 102 where vehicle status is updated post-payment), add the same group-level cache invalidation after any vehicle status change. | | |
| TASK-028 | `invalidateGroupListingCache` utility already added to `apps/backend/src/utils/cache/vehicleCacheKeys.ts` (SCAN-based, Redis Cluster safe). Called from booking creation (TASK-016). Wire into HOLD-expiry job and payment controller as follow-up (TASK-026, TASK-027). | ✅ | 2026-04-25 |

---

## 3. Alternatives

- **ALT-001: Show all vehicles but add a visual grouping header** — Keep the flat list but add a sticky group header ("Toyota Innova — 3 available") above each cluster. Rejected: still shows redundant cards; doesn't fix the scroll problem for large fleets. Simpler to implement but provides poor UX at scale.
- **ALT-002: Category-based booking (book a category, vehicle assigned at pickup)** — User books "SUV category", specific vehicle assigned by staff at counter. Rejected: too large a product change; removes user transparency over what they're getting; requires significant operational workflow changes.
- **ALT-003: Virtual `VehicleGroup` table in the database** — Add a `VehicleGroup` model to the Prisma schema that vehicles belong to, and store `groupKey` as a foreign key. Rejected: requires a schema migration with backfill for all existing vehicles; adds model complexity for something that can be computed from existing `make + model + categoryId + branchId` fields which already have an index (`@@index([make, model])`).
- **ALT-004: Pessimistic locking with a Redis distributed lock (Redlock)** — Use Redlock to lock `group:{groupKey}` for the duration of booking creation. Rejected: introduces Redlock dependency and distributed lock failure modes (lock holder crashes); the Prisma interactive transaction approach (TASK-014) already provides the necessary atomicity at the database level without an additional distributed lock.
- **ALT-005: Client-side deduplication** — Frontend deduplicates the flat list by `make+model` before rendering. Rejected: wastes bandwidth fetching all vehicles; doesn't fix the race condition; `availableCount` would require a second API call.

---

## 4. Dependencies

- **DEP-001**: Existing `checkAvailabilityBatch` utility in `apps/backend/src/utils/availability/availabilityBatch.ts` — must support being called inside a Prisma interactive transaction (pass the `tx` client). Verify it doesn't use the global `prisma` instance directly; if it does, refactor to accept an optional `prismaClient` parameter.
- **DEP-002**: Redis client instance — must support pattern-based key deletion for group cache invalidation (TASK-016, TASK-026, TASK-027, TASK-028). Verify the Redis client version supports `KEYS` + `DEL` or `SCAN`-based deletion. If on a Redis cluster, `KEYS` is unavailable — use `SCAN` instead.
- **DEP-003**: `PricingEngineService.calculateBookingPrice()` — used in TASK-008 for representative pricing. No changes needed; just called with the first available vehicle's ID.
- **DEP-004**: Prisma interactive transactions — requires `prisma.$transaction(fn, options)` with the callback form (not the array form). Confirm the Prisma version in `packages/db/package.json` supports this (available since Prisma 4.7).

---

## 5. Files

- **FILE-001**: `apps/backend/src/controller/public/vehicles.controller.ts` — Modified: `getPublicVehicles` (grouping logic, TASK-002–004), new `getVehicleGroupDetails` (TASK-006–009, TASK-011).
- **FILE-002**: `apps/backend/src/routes/public/vehicle.routes.ts` — Modified: add `GET /group/:groupKey` route before `GET /:id` (TASK-010).
- **FILE-003**: `apps/backend/src/controller/booking/getBookInfo.controller.ts` — Modified: request body accepts `groupKey`, new `resolveVehicleFromGroup` function, wrap in transaction (TASK-012–016).
- **FILE-004**: `apps/backend/src/utils/availability/availabilityBatch.ts` — Modified: accept optional `prismaClient` parameter so it can be called inside Prisma transactions (DEP-001).
- **FILE-005**: `apps/backend/src/utils/cache/invalidateGroupCache.ts` — New file: shared utility for group-level Redis cache invalidation (TASK-028).
- **FILE-006**: `apps/backend/src/controller/payment/checkPayment.controller.ts` — Modified: add group cache invalidation after vehicle status changes (TASK-027).
- **FILE-007**: Hold expiry job file (locate via `grep -r "HOLD_EXPIRED"`) — Modified: add group cache invalidation on hold expiry (TASK-026).
- **FILE-008**: `apps/frontend/src/services/vehicle.service.ts` — Modified: update `fetchPublicVehicles` return type, add `fetchVehicleGroupDetails` (TASK-018, TASK-022).
- **FILE-009**: Frontend vehicle listing page component (locate via `Glob apps/frontend/src/**/*[Vv]ehicle*[Ll]ist*`) — Modified: grouped card rendering, available count badge, updated navigation (TASK-019–020).
- **FILE-010**: Frontend vehicle details page or new `VehicleGroupDetailsPage` component — Modified/New: group route, group data fetching, 409 error handling (TASK-023–025).
- **FILE-011**: Frontend router configuration file — Modified: add `/vehicles/group/:groupKey` route (TASK-023).
- **FILE-012**: Frontend booking form/checkout component — Modified: send `groupKey` vs `vehiclePublicId` based on route (TASK-021).

---

## 6. Testing

- **TEST-001**: Unit test `buildGroupKey()` — verify deterministic output for same inputs, verify double-underscore separator doesn't collide with make/model names containing single underscores.
- **TEST-002**: Unit test `resolveVehicleFromGroup()` — mock Prisma tx, mock `checkAvailabilityBatch`. Verify: (a) returns lowest-odometer available vehicle, (b) skips vehicles with conflicting bookings, (c) throws `NO_VEHICLE_AVAILABLE` when all vehicles are conflicted.
- **TEST-003**: Integration test for `GET /public/vehicles` — seed 3 vehicles with same make/model/category/branch, call endpoint, assert response has exactly 1 entry for that group with `availableCount: 3`.
- **TEST-004**: Integration test for `GET /public/vehicles/group/:groupKey` — seed group, call with valid date range where 2 of 3 vehicles are booked, assert `availableCount: 1`.
- **TEST-005**: Race condition test for `POST /public/vehicles/booking` with `groupKey` — seed 1 available vehicle in a group, fire 2 simultaneous booking requests for the same group and date range, assert exactly 1 succeeds (HTTP 200) and 1 fails (HTTP 409 `NO_VEHICLE_AVAILABLE`).
- **TEST-006**: Backwards-compatibility test for `POST /public/vehicles/booking` with `vehiclePublicId` — verify existing flow still works without `groupKey`.
- **TEST-007**: Cache invalidation test — create a booking for a group vehicle, assert the group listing cache key for that group is deleted from Redis within the same request cycle.
- **TEST-008**: Frontend E2E (Playwright/Cypress) — navigate to listing, verify only one card per make/model group, click card, verify group details page loads, change dates to make all vehicles unavailable, verify "Not available" state shown.

---

## 7. Risks & Assumptions

- **RISK-001**: Prisma interactive transaction timeout — the 10-second timeout in TASK-014 may be hit if the `checkAvailabilityBatch` call inside `resolveVehicleFromGroup` is slow due to many conflicting bookings. Mitigation: add a DB index `@@index([vehicleId, startAt, endAt])` on `BookingItem` if not present; cap the candidate vehicle list to 10 in `resolveVehicleFromGroup`.
- **RISK-002**: Redis `KEYS` pattern deletion on production cluster — Redis Cluster does not support `KEYS` across slots. Mitigation: use `SCAN`-based iteration in `invalidateGroupCache.ts` (TASK-028), or prefix group cache keys with a hash tag `{group}:` to force all group keys to the same slot.
- **RISK-003**: Custom pricing divergence within a group — if vehicles in the same make/model group have very different custom prices, showing `minDailyPrice` could mislead users who receive a higher-priced vehicle. Mitigation: show price as "From ₹{minPrice}" in the listing card (REQ-008); show exact pricing on the group details page after vehicle is auto-assigned.
- **RISK-004**: Group key URL safety — `groupKey` contains `make` and `model` strings which may contain spaces, slashes, or special characters. Mitigation: always apply `encodeURIComponent` on the frontend (TASK-020) and `decodeURIComponent` on the backend route handler before splitting on `__`.
- **RISK-005**: Stale `availableCount` during the 30-second Redis TTL — a vehicle might be booked and a user on the listing page still sees `availableCount: 1`. Mitigation: the cache is invalidated immediately on booking creation (TASK-016); the 30-second TTL is only a fallback for edge cases. This is acceptable and industry-standard behaviour (e.g., airline seat counters).
- **ASSUMPTION-001**: All vehicles of the same `make + model + categoryId + branchId` are considered interchangeable from a customer perspective (same category, same branch, same type). If there are meaningful differences between vehicles in the same group (e.g., different year, fastag vs no fastag), those differences should be surfaced on the group details page but are not a blocker for grouping.
- **ASSUMPTION-002**: The existing `@@index([make, model])` and `@@index([branchId, categoryId, status])` indexes in `schema.prisma` are sufficient for the grouped listing query performance. No new indexes are needed.
- **ASSUMPTION-003**: The frontend router supports dynamic path segments with `:groupKey` and that `groupKey` values containing `__` are valid URL path segments after encoding.

---

## 8. Related Specifications / Further Reading

- `plan/refactor-availability-pricing-booking-1.md` — Availability and pricing engine refactor; `checkAvailabilityBatch` changes here must stay compatible with that plan.
- `apps/backend/src/utils/availability/availabilityBatch.ts` — Existing availability logic this plan extends.
- `apps/backend/src/controller/booking/getBookInfo.controller.ts` — Booking creation controller this plan modifies.
- Prisma Interactive Transactions docs: https://www.prisma.io/docs/orm/prisma-client/queries/transactions#interactive-transactions
