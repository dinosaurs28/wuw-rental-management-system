---
goal: Eliminate PricingEngine Sequential DB Queries & Cache Config Lookups
version: 1.0
date_created: 2026-03-24
last_updated: 2026-03-25
owner: VRMS Backend Team
status: 'Completed'
tags: [performance, refactor, caching, architecture]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

The details and listing endpoints currently take 5+ seconds to respond. Root cause analysis reveals
that `PricingEngineService.calculateBookingPrice` makes **9 sequential database queries per vehicle**,
many of which are redundant lookups of the same `vehicle.categoryId`. Additionally, the listing
endpoint fetches large `Branch` and `Category` objects when only their `name` and `id` are needed.
This plan eliminates the redundant queries (reducing from 9 to 3–4 per call), adds Redis caching for
all stable pricing configuration data, and reduces the listing payload size — targeting a response
time of < 500ms for listings and < 800ms for details.

---

## 1. Requirements & Constraints

- **REQ-001**: After this plan, `calculateBookingPrice` must make at most **3 DB queries** for a vehicle without a coupon (down from 9). Target: customPricing check (1) → branchDefaults (1) → GST (1), all others served from cache or in-memory.
- **REQ-002**: All pricing config caches must be invalidated when their source data changes: `vehicleCustomPricing` → `vehiclePricingKey`, `branchPricingDefaults` → branch category pricing key, `GSTRule` → GST cache key, `categoryDepositSetting` → deposit cache key, `branchDiscountConfig` → discount config key, `durationDiscountSlab` → slab cache key.
- **REQ-003**: Cache TTLs must be conservative: pricing config = 300s, GST rules = 600s, deposit settings = 300s, discount slabs = 300s. All invalidated immediately on write.
- **REQ-004**: `getVehicleCategoryId` and `getVehiclePricing` both query `vehicle.categoryId` — this must be merged into a single query, with `categoryId` threaded through as a parameter instead of re-fetched.
- **REQ-005**: The controller-level `getDepositAmount(branchId, categoryId)` call in `getPublicVehiclesDetails` is a duplicate of the one inside `PricingEngineService.getDepositAmount`. Eliminate the controller-level call; read deposit from `pricingResult.deposit` instead.
- **REQ-006**: The listing endpoint `findMany` must use `select` (not `include`) for `category` and `branch` — only fetch `id` and `name`, not all scalar fields. This reduces the JOIN result payload size.
- **REQ-007**: Pricing config queries that are currently sequential must be parallelised where possible using `Promise.all`.
- **CON-001**: No Prisma schema changes.
- **CON-002**: No changes to `TimezoneService` or `DurationCalculatorService`.
- **CON-003**: Cache key naming must use the `vehicleCacheKeys.ts` patterns established in the availability plan. New key helpers should be added to the same file.
- **CON-004**: `PricingEngineService` must remain backward-compatible — same input/output interface, only internal implementation changes.
- **GUD-001**: All cache reads must be wrapped in try/catch with fallback to direct DB query (non-fatal Redis failures).
- **GUD-002**: Log cache hit/miss for pricing config keys: `[pricing-cache] hit/miss for key`.
- **PAT-001**: Use `redis.mget` for fetching multiple cache keys in one round-trip when fetching pricing for several vehicles simultaneously.

---

## 2. Implementation Steps

### Implementation Phase 1 — Eliminate Redundant Vehicle Lookups in PricingEngine

- GOAL-001: Refactor `PricingEngineService` so that `vehicle.categoryId` is fetched exactly once per `calculateBookingPrice` call and threaded through all private methods as a parameter.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add optional `categoryId?: number` parameter to `calculateBookingPrice` signature. When provided, skip the `getVehicleCategoryId` DB call entirely. Update `getPublicVehiclesDetails` to pass `vehicleData.categoryId` (already in memory from the main vehicle query). Update `createEmployeeBooking` to pass `v.categoryId` (already in memory from `vehiclesData` fetch). | ✅ | 2026-03-25 |
| TASK-002 | Add optional `categoryId?: number` parameter to `getVehiclePricing`. When provided, skip the `prisma.vehicle.findUnique({ select: { categoryId } })` call inside the branch-default path (lines 268–271 of pricing-engine.service.ts). | ✅ | 2026-03-25 |
| TASK-003 | Add optional `categoryId?: number` parameter to `getDepositAmount` (private method inside `PricingEngineService`). When provided, skip the `prisma.vehicle.findUnique` call for categoryId. Thread the already-known `categoryId` from TASK-001 through to this method. | ✅ | 2026-03-25 |
| TASK-004 | Parallelize the two independent queries in `calculateBookingPrice`: `getVehiclePricing` and `getDepositAmount` currently run sequentially. Wrap them in `Promise.all([getVehiclePricing(...), getDepositAmount(...)])` since they have no dependency on each other. | ✅ | 2026-03-25 |
| TASK-005 | In `getPublicVehiclesDetails`, remove the standalone `await getDepositAmount(vehicleData.branchId, vehicleData.categoryId)` call (controller line ~311). After calling `pricingEngine.calculateBookingPrice`, read `deposit` from `pricingResult.deposit` (already computed by the engine). This eliminates 1 duplicate DB query. | ✅ | 2026-03-25 |

### Implementation Phase 2 — Redis Caching for Pricing Configuration

- GOAL-002: Add Redis caching to all stable pricing config reads inside `PricingEngineService` so that repeat calls (e.g., across listing iterations or repeated detail views) hit Redis instead of Postgres.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Add cache key helpers to `apps/backend/src/utils/cache/vehicleCacheKeys.ts`: `vehiclePricingConfigKey(vehicleId) => \`pricing-config:vehicle:\${vehicleId}\``, `branchPricingDefaultsKey(branchId, categoryId) => \`pricing-defaults:branch:\${branchId}:cat:\${categoryId}\``, `gstRuleKey(branchId) => \`gst:branch:\${branchId}\``, `depositSettingKey(branchId, categoryId) => \`deposit:branch:\${branchId}:cat:\${categoryId}\``, `branchDiscountConfigKey(branchId) => \`discount-config:branch:\${branchId}\``, `durationDiscountSlabKey(branchId, days) => \`discount-slab:branch:\${branchId}:days:\${days}\``. | ✅ | 2026-03-25 |
| TASK-007 | In `getVehiclePricing`, wrap the `vehicleCustomPricing.findUnique` call with a Redis cache check using `vehiclePricingConfigKey(vehicleId)`, TTL 300s. Serialize the result as JSON. On cache miss, fetch from DB and store. On Redis error, fall through to DB. Similarly cache the `branchPricingDefaults` result using `branchPricingDefaultsKey(branchId, categoryId)`, TTL 300s. | ✅ | 2026-03-25 |
| TASK-008 | In `calculateTax`, wrap the `gSTRule.findUnique` call with Redis cache using `gstRuleKey(branchId)`, TTL 600s. GST rules change rarely; longer TTL is safe. | ✅ | 2026-03-25 |
| TASK-009 | In `getDepositAmount` (pricing engine), wrap the `categoryDepositSetting.findUnique` call with Redis cache using `depositSettingKey(branchId, categoryId)`, TTL 300s. | ✅ | 2026-03-25 |
| TASK-010 | In `discountEvaluationEngine.evaluate`, wrap the `branchDiscountConfig.findUnique` call with Redis cache using `branchDiscountConfigKey(branchId)`, TTL 300s. | ✅ | 2026-03-25 |
| TASK-011 | In `durationDiscountService.evaluate`, wrap both the `branchDiscountConfig.findUnique` and `durationDiscountSlab.findFirst` calls with Redis caching. Key for slab: `durationDiscountSlabKey(branchId, rentalDays)`, TTL 300s. | ✅ | 2026-03-25 |
| TASK-012 | Add cache invalidation to all admin/manager pricing config update endpoints: (a) When `vehicleCustomPricing` is updated → `del(vehiclePricingConfigKey(vehicleId))`. (b) When `branchPricingDefaults` is updated → `del(branchPricingDefaultsKey(branchId, categoryId))`. (c) When `GSTRule` is updated → `del(gstRuleKey(branchId))`. (d) When `categoryDepositSetting` is updated → `del(depositSettingKey(branchId, categoryId))`. (e) When `branchDiscountConfig` is updated → `del(branchDiscountConfigKey(branchId))`. (f) When `durationDiscountSlab` is updated → delete all `discount-slab:branch:{branchId}:*` keys. Search `apps/backend/src/controller/` for each of these update handlers to add the invalidation. | ✅ | 2026-03-25 |

### Implementation Phase 3 — Reduce Listing Payload & Parallelise Setup Queries

- GOAL-003: Reduce the listing endpoint's DB payload and eliminate sequential setup queries that add latency before the main vehicle fetch.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | In `getPublicVehicles`, change `include: { category: true, branch: true }` to `select` with only the fields actually used in the response. For `category`, only `id` and `name` are used. For `branch`, only `id` and `name` are used. Replace with: `category: { select: { id: true, name: true } }`, `branch: { select: { id: true, name: true } }`. This avoids fetching all Branch scalar fields (which include potentially large JSON `pricingSetting`). | ✅ | 2026-03-25 |
| TASK-014 | Parallelise the category and branch resolution queries at the top of `getPublicVehicles`. Currently they run sequentially when both `category` and `branch` query params are provided. Wrap them in `Promise.all([categoryLookup, branchLookup])`. | ✅ | 2026-03-25 |
| TASK-015 | Remove `include: { branch: { include: { pricingSetting: true } } }` from the main vehicle query in `getPublicVehiclesDetails` — `pricingSetting` is fetched but never used in the details response or pricing engine. Replace with `branch: { select: { id: true, name: true } }`. | ✅ | 2026-03-25 |
| TASK-016 | In `getPublicVehiclesDetails`, the `include: { pricingOverride: true, customPricing: true }` fetches data that is also fetched inside `PricingEngineService.getVehiclePricing`. Pass the already-fetched `customPricing` from the vehicle query into `calculateBookingPrice` as an optional parameter to skip the redundant `vehicleCustomPricing.findUnique` inside the engine. Add optional `vehicleCustomPricing?: VehicleCustomPricing | null` to `calculateBookingPrice` signature and `getVehiclePricing`. | ✅ | 2026-03-25 |

### Implementation Phase 4 — Cache Full Pricing Results

- GOAL-004: Cache the complete `PricingResult` for a vehicle+duration combination so that repeated calls (e.g., user refreshing the details page) return instantly from Redis.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | Add cache key helper: `vehicleDetailsPricingKey(vehicleId, startIso, endIso) => \`pricing-result:vehicle:\${vehicleId}:\${startIso}:\${endIso}\``. | ✅ | 2026-03-25 |
| TASK-018 | In `getPublicVehiclesDetails`, before calling `pricingEngine.calculateBookingPrice`, check Redis for `vehicleDetailsPricingKey`. On hit, parse and return the cached `PricingResult` directly. On miss, compute and store with TTL 60s. On booking create/status change for vehicles in the result, invalidate this key. | ✅ | 2026-03-25 |
| TASK-019 | In `checkVehicleAvailability` / `getUnavailableVehicleIds`, check `vehicleAvailabilityKey(vehicleId)` in Redis before querying the DB. On cache hit (value = "0" for available, "1" for unavailable), return immediately. Store availability result with TTL 30s. The existing `invalidateVehicleAvailability` call on booking changes ensures correctness. Note: only cache single-vehicle checks; batch checks populate individual keys for each vehicleId. | ⏭️ Skipped | Key doesn't include time window — would serve stale availability for different date ranges |

### Implementation Phase 5 — Monitoring & Verification

- GOAL-005: Verify that the optimisations achieve the target response times and add monitoring to catch regressions.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | Add `console.time`/`console.timeEnd` around `pricingEngine.calculateBookingPrice` in `getPublicVehiclesDetails` with label `[perf] details:pricing:{vehicleId}`. Compare before/after timings. | ✅ | 2026-03-25 |
| TASK-021 | Add cache hit/miss logging inside `PricingEngineService` private methods: `console.log("[pricing-cache] hit: pricing-config:vehicle:${vehicleId}")` on cache hit, `warn` on miss. | ✅ | 2026-03-25 |
| TASK-022 | After implementation, benchmark listing and details endpoints. Targets: listing < 500ms (uncached), listing < 50ms (cached), details < 800ms (uncached), details < 100ms (cached). | ⏭️ Manual verification | |

---

## 3. Alternatives

- **ALT-001**: Replace sequential calls in `calculateBookingPrice` with a single raw SQL query joining Vehicle, VehicleCustomPricing, BranchPricingDefaults, GSTRule, and CategoryDepositSetting. Rejected — bypasses Prisma type safety and is harder to maintain; caching achieves the same effect more cleanly.
- **ALT-002**: Use Prisma Accelerate (connection pooler + global cache). Viable but adds external dependency and cost. The Redis caching approach achieves similar results with existing infrastructure.
- **ALT-003**: Precompute and materialise pricing for all vehicles in a background job, serving from a materialised cache. Overkill for the current scale; adds stale-data risk.
- **ALT-004**: Denormalise pricing data into the Vehicle table (copy customPricing fields). Rejected — violates normalisation and makes config changes complex.

---

## 4. Dependencies

- **DEP-001**: `apps/backend/src/utils/cache/vehicleCacheKeys.ts` — must be extended with new key helpers (TASK-006).
- **DEP-002**: `apps/backend/src/services/pricing/pricing-engine.service.ts` — primary file changed across all phases.
- **DEP-003**: `apps/backend/src/services/discount/discount-evaluation-engine.service.ts` — TASK-010.
- **DEP-004**: `apps/backend/src/services/discount/duration-discount.service.ts` — TASK-011.
- **DEP-005**: Redis (`../../lib/redisconfig.js`) — must be imported into `PricingEngineService`. Currently not imported.
- **DEP-006**: All admin/manager controllers that update pricing config — need to be found and have cache invalidation added (TASK-012).

---

## 5. Files

- **FILE-001**: `apps/backend/src/services/pricing/pricing-engine.service.ts` — Major changes across Phases 1–4.
- **FILE-002**: `apps/backend/src/services/discount/discount-evaluation-engine.service.ts` — TASK-010 (cache branchDiscountConfig).
- **FILE-003**: `apps/backend/src/services/discount/duration-discount.service.ts` — TASK-011 (cache slab lookup).
- **FILE-004**: `apps/backend/src/utils/cache/vehicleCacheKeys.ts` — TASK-006 (new key helpers) + TASK-017.
- **FILE-005**: `apps/backend/src/controller/public/vehicles.controller.ts` — TASK-005, TASK-013, TASK-014, TASK-015, TASK-016, TASK-018, TASK-019.
- **FILE-006**: `apps/backend/src/controller/employee/booking.controller.ts` — TASK-001 (pass categoryId to calculateBookingPrice).
- **FILE-007**: Admin/manager controllers that update `vehicleCustomPricing`, `branchPricingDefaults`, `GSTRule`, `categoryDepositSetting`, `branchDiscountConfig`, `durationDiscountSlab` — TASK-012. Find with: `grep -r "vehicleCustomPricing\|branchPricingDefaults\|GSTRule\|categoryDepositSetting" apps/backend/src/controller`.
- **FILE-008**: `apps/backend/src/utils/availability/availabilityBatch.ts` — TASK-019 (per-vehicle availability caching).

---

## 6. Testing

- **TEST-001**: Benchmark `GET /api/public/vehicles?branch=X&start=T&end=T+25h` before and after. Verify response time drops from 5s+ to < 500ms.
- **TEST-002**: Call `GET /api/public/vehicles/:id?start=T&end=T+25h` twice in quick succession. Second call must be served from cache and complete in < 100ms.
- **TEST-003**: Update `vehicleCustomPricing` for vehicleId=5. Verify `pricing-config:vehicle:5` is deleted from Redis. Verify next pricing call fetches fresh data.
- **TEST-004**: Update `GSTRule` for branchId=1. Verify `gst:branch:1` is deleted. Verify tax calculation uses new rate.
- **TEST-005**: Call `calculateBookingPrice` and inspect logs. Verify exactly 1 `[pricing-cache] miss` then subsequent calls show `hit`.
- **TEST-006**: Simulate Redis connection failure. Verify pricing engine falls back to DB (no 500 error).
- **TEST-007**: Verify details page response now correctly reads `deposit` from `pricingResult.deposit` — no duplicate deposit fetch.
- **TEST-008**: Verify listing `findMany` SQL (via Prisma query log) uses `SELECT ... name ...` without fetching `pricingSetting` JSON blob.

---

## 7. Risks & Assumptions

- **RISK-001**: Stale cache after admin pricing update. Mitigated by TASK-012 targeted invalidation. If an admin pricing controller is missed, stale pricing will be served for up to 300s. Ensure TASK-012 performs a comprehensive search of all update/create/delete handlers for each pricing entity.
- **RISK-002**: `PricingEngineService` currently does not import `redis`. Adding Redis to a pure computation service is an architectural concern. Mitigate by creating a thin `PricingConfigCache` utility class (in `utils/cache/`) that encapsulates all Redis interaction, keeping `PricingEngineService` focused on calculation.
- **RISK-003**: `vehicleDetailsPricingKey` cache (TASK-018) includes the ISO datestring in the key. If callers pass slightly different ISO formats for the same logical time (e.g., with/without milliseconds), cache will miss. Normalise the key using `TimezoneService.toPrisma(date).toISOString()` to ensure consistent formatting.
- **RISK-004**: If `Promise.all([getVehiclePricing, getDepositAmount])` (TASK-004) fails on one item, both fail. Ensure individual catch blocks or let the outer try/catch handle it uniformly.
- **ASSUMPTION-001**: Redis is available and connected in all environments. The existing `redis` import from `../../lib/redisconfig.js` already handles connection gracefully.
- **ASSUMPTION-002**: The main bottleneck is cloud DB round-trip latency (~150–200ms per query). After caching, the first request will still pay this cost but subsequent requests will be served from Redis at < 5ms.
- **ASSUMPTION-003**: The listing currently includes `include: { branch: { include: { pricingSetting: true } } }` in `getPublicVehiclesDetails` — this is a large JSON blob. Removing it (TASK-015) is safe because `pricingSetting` is not used in the response shape.

---

## 8. Related Specifications / Further Reading

- `plan/refactor-availability-pricing-booking-1.md` — Previous plan (completed): availability batch, targeted cache invalidation, pricing bug fix.
- `apps/backend/src/services/pricing/pricing-engine.service.ts` — Current implementation with 9 sequential queries.
- `apps/backend/src/services/discount/discount-evaluation-engine.service.ts` — `branchDiscountConfig` lookup to cache.
- `apps/backend/src/services/discount/duration-discount.service.ts` — Slab lookup to cache.
- `apps/backend/src/utils/cache/vehicleCacheKeys.ts` — Existing cache key helpers to extend.
