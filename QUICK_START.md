# VEHICLE SWAP FEATURE - QUICK START GUIDE

## 🚀 Complete the Implementation in 5 Steps

This guide will help you complete and deploy the Vehicle Swap feature. The backend is fully coded and ready - you just need to run migrations and implement the frontend.

---

## STEP 1: Complete Database Migration ⚡

### 1.1 Navigate to Database Package
```bash
cd packages/db
```

### 1.2 Run Migration
```bash
pnpm db:migrate:dev --name add_vehicle_swap_feature
```

**Expected Output**: Migration file created and applied to database

### 1.3 Generate Prisma Client
```bash
pnpm db:generate
```

**Expected Output**: Prisma client regenerated with new VehicleSwap model

### 1.4 Verify Migration
```bash
# Connect to your database and verify tables exist
# Should see: VehicleSwap table with all columns
```

**Critical Fields to Verify**:
- `VehicleCategory.rank` (new field, default 1)
- `AuditLog.metadata` (new field)
- `VehicleSwap` table exists

---

## STEP 2: Set Category Ranks 📊

Run this SQL to set category ranks (adjust based on your categories):

```sql
-- Update your vehicle categories with appropriate ranks
-- Lower rank = lower category, Higher rank = premium category

UPDATE "VehicleCategory" SET rank = 1 WHERE name = 'Scooter';
UPDATE "VehicleCategory" SET rank = 2 WHERE name = 'Bike';
UPDATE "VehicleCategory" SET rank = 3 WHERE name = 'Premium Bike';
UPDATE "VehicleCategory" SET rank = 4 WHERE name = 'Luxury Bike';

-- Verify
SELECT id, name, rank FROM "VehicleCategory" ORDER BY rank;
```

---

## STEP 3: Test Backend API 🧪

### 3.1 Start Backend Server
```bash
cd apps/backend
pnpm dev
```

### 3.2 Test Endpoints

**Test 1: Get Available Vehicles**
```bash
curl -X GET \
  http://localhost:YOUR_PORT/api/branchManager/dashboard/bookings/BOOKING_ID/available-vehicles \
  -H "Authorization: Bearer YOUR_MANAGER_TOKEN"
```

**Expected**: List of available vehicles in JSON

**Test 2: Perform Swap**
```bash
curl -X POST \
  http://localhost:YOUR_PORT/api/branchManager/dashboard/bookings/BOOKING_ID/swap-vehicle \
  -H "Authorization: Bearer YOUR_MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newVehicleId": 456,
    "reason": "MAINTENANCE",
    "reasonNotes": "Test swap",
    "markOriginalForMaintenance": true,
    "originalVehicleNotes": "Needs inspection"
  }'
```

**Expected**: Success response with swap details

**Test 3: Get Swap History**
```bash
curl -X GET \
  http://localhost:YOUR_PORT/api/branchManager/dashboard/swap-history?startDate=2024-03-01&endDate=2024-03-31 \
  -H "Authorization: Bearer YOUR_MANAGER_TOKEN"
```

**Expected**: Array of swap records

---

## STEP 4: Implement Frontend 🎨

### 4.1 Create Type Definitions

**File**: `apps/frontend/src/types/vehicleSwap.types.ts`

Copy types from `FRONTEND_VEHICLE_SWAP_GUIDE.md` (Section: Type Definitions)

### 4.2 Create API Service

**File**: `apps/frontend/src/services/api/vehicleSwap.service.ts`

Copy service from `FRONTEND_VEHICLE_SWAP_GUIDE.md` (Section: API Service)

### 4.3 Create Custom Hook

**File**: `apps/frontend/src/hooks/useVehicleSwap.ts`

Copy hook from `FRONTEND_VEHICLE_SWAP_GUIDE.md` (Section: Custom Hook)

### 4.4 Create Components

Create these components (code in FRONTEND_VEHICLE_SWAP_GUIDE.md):

1. `apps/frontend/src/components/branch-manager/vehicle-swap/AvailableVehiclesList.tsx`
2. `apps/frontend/src/components/branch-manager/vehicle-swap/SwapConfirmationModal.tsx`
3. `apps/frontend/src/components/branch-manager/vehicle-swap/SwapReasonSelector.tsx` (optional)
4. `apps/frontend/src/components/branch-manager/vehicle-swap/SwapHistoryTable.tsx` (optional)

### 4.5 Create Main Page

**File**: `apps/frontend/src/pages/branch-manager/bookings/VehicleSwapPage.tsx`

Copy from `FRONTEND_VEHICLE_SWAP_GUIDE.md` (Section: Vehicle Swap Page)

### 4.6 Add Route

In your router configuration file:

```typescript
{
  path: '/branch-manager/bookings/:bookingId/swap-vehicle',
  element: <VehicleSwapPage />,
  // Add your auth middleware
}
```

### 4.7 Add Swap Button to Active Bookings

In `ActiveBookingsPage.tsx`, add:

```typescript
// Add to each booking row/card where status is CONFIRMED or PICKED_UP
<button
  onClick={() => navigate(`/branch-manager/bookings/${booking.publicId}/swap-vehicle`)}
  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
  disabled={!['CONFIRMED', 'PICKED_UP'].includes(booking.status)}
>
  Swap Vehicle
</button>
```

---

## STEP 5: Test Complete Flow 🎯

### 5.1 User Flow Test

1. ✅ Login as branch manager
2. ✅ Navigate to Active Bookings
3. ✅ Click "Swap Vehicle" on a CONFIRMED booking
4. ✅ See list of available vehicles
5. ✅ Select a new vehicle
6. ✅ Fill swap form (reason, notes, etc.)
7. ✅ Submit swap
8. ✅ See success notification
9. ✅ Verify booking shows new vehicle
10. ✅ Check swap history displays record

### 5.2 Edge Cases to Test

- [ ] Try swapping a RETURNED booking (should fail)
- [ ] Try swapping to unavailable vehicle (should fail)
- [ ] Try swapping to lower category (should fail)
- [ ] Mark for maintenance without notes (should fail validation)
- [ ] Verify original vehicle status changes correctly
- [ ] Check audit log entry created

---

## 📦 DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] All TypeScript errors resolved
- [ ] All tests passing
- [ ] Code reviewed by team
- [ ] Migration tested in staging
- [ ] Rollback plan documented

### Deployment

1. **Backup Database**
   ```bash
   # Create backup before migration
   pg_dump -h HOST -U USER -d DATABASE > backup_before_swap.sql
   ```

2. **Deploy Database Changes**
   ```bash
   cd packages/db
   pnpm db:migrate:deploy
   ```

3. **Update Category Ranks** (if not done)
   ```sql
   -- Run SQL from Step 2
   ```

4. **Deploy Backend**
   ```bash
   cd apps/backend
   pnpm build
   # Deploy build to your server
   ```

5. **Deploy Frontend**
   ```bash
   cd apps/frontend
   pnpm build
   # Deploy build to your hosting
   ```

6. **Verify in Production**
   - Test all 4 endpoints with real data
   - Check logs for errors
   - Verify first swap works correctly

---

## 🐛 TROUBLESHOOTING

### Error: "Module '@repo/database/client' has no exported member 'SwapReason'"

**Solution**: Regenerate Prisma client
```bash
cd packages/db
pnpm db:generate
```

### Error: "Property 'rank' does not exist on type 'VehicleCategory'"

**Solution**: Migration not applied. Run migration again
```bash
cd packages/db
pnpm db:migrate:dev
```

### Error: "Property 'vehicleSwap' does not exist on type 'PrismaClient'"

**Solution**: Schema changed but client not regenerated
```bash
cd packages/db
pnpm db:generate
# Then restart your backend server
```

### Frontend: "No available vehicles found"

**Check**:
1. Are there vehicles with status = AVAILABLE?
2. Are category ranks set correctly?
3. Is the booking in CONFIRMED or PICKED_UP status?
4. Are you testing with the correct branch?

### Swap Fails: "Cannot swap to a lower category vehicle"

**Solution**: This is expected behavior. Ensure category ranks are:
- Set correctly (higher number = premium category)
- The new vehicle has same or higher rank

---

## 📊 VERIFICATION QUERIES

Run these to verify everything is working:

```sql
-- Check swap records
SELECT 
  vs.id,
  vs."publicId",
  vs.reason,
  vs."swappedAt",
  ov."regNo" as original_vehicle,
  nv."regNo" as new_vehicle,
  u.name as swapped_by
FROM "VehicleSwap" vs
JOIN "Vehicle" ov ON vs."originalVehicleId" = ov.id
JOIN "Vehicle" nv ON vs."newVehicleId" = nv.id
JOIN "User" u ON vs."swappedById" = u.id
ORDER BY vs."swappedAt" DESC
LIMIT 10;

-- Check category ranks
SELECT id, name, rank 
FROM "VehicleCategory" 
ORDER BY rank;

-- Check audit logs for swaps
SELECT 
  al."publicId",
  al.action,
  al.entity,
  al."entityId",
  al.metadata,
  al."createdAt",
  u.name as performed_by
FROM "AuditLog" al
JOIN "User" u ON al."userId" = u.id
WHERE al.action = 'VEHICLE_SWAP'
ORDER BY al."createdAt" DESC
LIMIT 10;
```

---

## 📝 MINIMAL IMPLEMENTATION (Quick Win)

If you want to deploy quickly, implement just:

### Backend (Already Done) ✅
- Database migration
- Set category ranks
- Test API endpoints

### Frontend (Minimal)
- Just the main swap page
- Basic vehicle selection
- Simple confirmation dialog
- No fancy UI needed

**Time Estimate**: 2-3 hours for minimal working version

---

## 🎓 LEARNING RESOURCES

- **API Endpoints**: See `IMPLEMENTATION_SUMMARY.md` (Section: API Endpoints Reference)
- **Frontend Guide**: See `FRONTEND_VEHICLE_SWAP_GUIDE.md` (Complete examples)
- **Business Rules**: See `implementation.md` (Original requirements)
- **Database Schema**: `packages/db/prisma/schema.prisma`

---

## ✅ SUCCESS CRITERIA

You're done when:

1. ✅ Migration runs successfully
2. ✅ All 4 API endpoints return valid responses
3. ✅ Manager can see available vehicles
4. ✅ Manager can complete a swap
5. ✅ Booking reflects new vehicle after swap
6. ✅ Swap history is recorded and visible
7. ✅ Audit log captures swap event

---

## 🚦 CURRENT STATUS

- ✅ Backend service layer complete
- ✅ Backend controller complete
- ✅ Backend routes integrated
- ✅ Validation schemas complete
- ✅ Database schema updated
- ⏳ Migration needs to run
- ⏳ Category ranks need to be set
- ⏳ Frontend needs to be implemented
- ⏳ Testing needed
- ⏳ Production deployment pending

---

## 📞 NEED HELP?

1. Check `IMPLEMENTATION_SUMMARY.md` for overview
2. Check `FRONTEND_VEHICLE_SWAP_GUIDE.md` for frontend details
3. Check diagnostics: `pnpm tsc --noEmit` in backend
4. Check backend logs for runtime errors
5. Use Postman/Insomnia to test API directly

---

**Good luck! The hard part is done - now just wire it up! 🚀**