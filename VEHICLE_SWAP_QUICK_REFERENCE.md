# VEHICLE SWAP FEATURE - QUICK REFERENCE CARD

## 🎯 What Is This?
Branch managers can swap vehicles on active bookings for maintenance, upgrades, customer requests, etc.

## 📍 Quick Navigation

### Backend Files
```
packages/db/prisma/schema.prisma              # VehicleSwap model + enums
apps/backend/src/services/vehicle-swap/       # Business logic
apps/backend/src/controller/branchManager/    # Vehicle swap controller
apps/backend/src/routes/branchManger/         # Routes (integrated)
packages/schemas/src/vehicle.schema.ts        # Validation schemas
```

### Frontend Files
```
apps/frontend/src/types/vehicleSwap.ts                       # TypeScript types
apps/frontend/src/services/vehicleSwap.service.ts            # API service
apps/frontend/src/hooks/useVehicleSwap.ts                    # React hook
apps/frontend/src/pages/manager/VehicleSwapPage.tsx          # Main page
apps/frontend/src/components/manager/vehicle-swap/           # Components
apps/frontend/src/components/ui/alert.tsx                    # New UI component
```

## 🚀 Quick Start Commands

### 1. Database Setup (REQUIRED FIRST)
```bash
# Navigate to database package
cd packages/db

# Run migration
pnpm db:migrate:dev --name add_vehicle_swap_feature

# Generate Prisma client
pnpm db:generate
```

### 2. Set Category Ranks (REQUIRED)
```sql
-- Connect to your PostgreSQL database and run:
UPDATE "VehicleCategory" SET rank = 1 WHERE name = 'Scooter';
UPDATE "VehicleCategory" SET rank = 2 WHERE name = 'Bike';
UPDATE "VehicleCategory" SET rank = 3 WHERE name = 'Premium';
-- Adjust based on your categories
```

### 3. Start Services
```bash
# Backend
cd apps/backend
pnpm dev

# Frontend (new terminal)
cd apps/frontend
pnpm dev
```

## 📡 API Endpoints

### 1. Get Available Vehicles
```
GET /api/branchManager/dashboard/bookings/:bookingId/available-vehicles
Auth: Required (Manager)
Returns: Array of available vehicles
```

### 2. Perform Swap
```
POST /api/branchManager/dashboard/bookings/:bookingId/swap-vehicle
Auth: Required (Manager)
Body: {
  newVehicleId: number,
  reason: SwapReason,
  reasonNotes?: string,
  markOriginalForMaintenance?: boolean,
  originalVehicleNotes?: string
}
Returns: VehicleSwap record
```

### 3. Get Booking Swap History
```
GET /api/branchManager/dashboard/bookings/:bookingId/swap-history
Auth: Required (Manager)
Returns: Array of swaps for this booking
```

### 4. Get All Swap History
```
GET /api/branchManager/dashboard/swap-history?startDate=X&endDate=Y
Auth: Required (Manager)
Query: startDate, endDate, vehicleId?, reason?, bookingId?
Returns: Filtered array of swaps
```

## 🎨 Swap Reasons (Enum)
```
CUSTOMER_REQUEST  - Customer requested different vehicle
MAINTENANCE       - Original vehicle needs maintenance
UPGRADE           - Upgrading to higher category
DOWNGRADE         - Downgrading to lower category
DAMAGE            - Original vehicle damaged
OTHER             - Other reason
```

## 🧪 Quick Test Flow

1. **Login as Manager**: `/branch-manager/sign-in`
2. **Go to Dashboard**: `/manager/dashboard`
3. **Click "Swap" button** on any active booking
4. **Select a vehicle** from the list
5. **Fill the form**:
   - Reason: Required
   - Notes: Optional
   - Mark for maintenance: Optional (needs notes if checked)
6. **Confirm swap**
7. **Verify**: Success toast → Redirect to dashboard

## 🔍 Troubleshooting

### "No available vehicles found"
- Check vehicles are in AVAILABLE status
- Verify category ranks are set correctly
- Ensure vehicles are in same branch
- Check booking is CONFIRMED or PICKED_UP

### "Property 'vehicleSwap' does not exist"
```bash
cd packages/db
pnpm db:generate
# Restart backend server
```

### "Module '@/components/ui/alert' not found"
- File exists at: `apps/frontend/src/components/ui/alert.tsx`
- Try restarting dev server
- Clear build cache if needed

### TypeScript Errors
```bash
# Frontend
cd apps/frontend
pnpm build

# Backend
cd apps/backend
pnpm build
```

### Swap Fails with "Cannot swap to lower category"
- Check category ranks: Higher rank = premium category
- Ensure new vehicle rank >= original vehicle rank
- Verify ranks are set in database

## 📊 Database Check Queries

### Check VehicleSwap Records
```sql
SELECT vs.*, ov."regNo" as original, nv."regNo" as new, u.name as manager
FROM "VehicleSwap" vs
JOIN "Vehicle" ov ON vs."originalVehicleId" = ov.id
JOIN "Vehicle" nv ON vs."newVehicleId" = nv.id
JOIN "User" u ON vs."swappedById" = u.id
ORDER BY vs."swappedAt" DESC
LIMIT 10;
```

### Check Category Ranks
```sql
SELECT id, name, rank FROM "VehicleCategory" ORDER BY rank;
```

### Verify Audit Logs
```sql
SELECT * FROM "AuditLog" 
WHERE action = 'VEHICLE_SWAP' 
ORDER BY "createdAt" DESC 
LIMIT 10;
```

## 🔑 Key Business Rules

1. ✅ Only CONFIRMED or PICKED_UP bookings can swap
2. ✅ Cannot swap after booking end date
3. ✅ New vehicle must be AVAILABLE
4. ✅ New vehicle must be same or higher category rank
5. ✅ New vehicle must be in same branch
6. ✅ Original vehicle can be marked for MAINTENANCE
7. ✅ All swaps logged in audit trail
8. ✅ Transaction ensures data integrity

## 📱 Frontend Routes

```
/manager/dashboard                           # Dashboard with swap button
/manager/bookings/:bookingId/swap-vehicle   # Swap page (NEW)
```

## 🛠️ Development Tips

### Add Console Logs
```typescript
// In VehicleSwapPage.tsx
console.log('Available vehicles:', availableVehicles);
console.log('Swap request:', swapData);
```

### Test API Directly
```bash
# Get available vehicles
curl -X GET http://localhost:3000/api/branchManager/dashboard/bookings/BOOKING_ID/available-vehicles \
  -H "Authorization: Bearer YOUR_TOKEN"

# Perform swap
curl -X POST http://localhost:3000/api/branchManager/dashboard/bookings/BOOKING_ID/swap-vehicle \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newVehicleId": 123, "reason": "MAINTENANCE", "reasonNotes": "Test"}'
```

### Check Network Tab
- Open Browser DevTools → Network
- Filter: Fetch/XHR
- Perform swap
- Check request/response

## 📦 No New Dependencies!
All required packages already in project:
- react, react-router-dom
- axios
- sonner (toast)
- lucide-react (icons)
- @radix-ui/* (UI components)
- tailwindcss

## ✅ Implementation Status

- ✅ Database Schema
- ✅ Backend Service
- ✅ Backend Controller
- ✅ Backend Routes
- ✅ Validation Schemas
- ✅ Frontend Types
- ✅ Frontend Service
- ✅ Frontend Hook
- ✅ Frontend Components
- ✅ Frontend Page
- ✅ Route Integration
- ⏳ Database Migration (PENDING)
- ⏳ Category Ranks (PENDING)
- ⏳ Testing (PENDING)

## 🎓 Related Docs

- `IMPLEMENTATION_SUMMARY.md` - Backend details
- `FRONTEND_IMPLEMENTATION_COMPLETE.md` - Frontend details
- `QUICK_START.md` - Step-by-step guide
- `IMPLEMENTATION_CHECKLIST.md` - Full checklist

## 🆘 Need Help?

1. Check error message in toast notification
2. Check browser console for errors
3. Check backend logs
4. Check database records
5. Review API response in Network tab
6. Verify migration ran successfully
7. Confirm category ranks are set

---

**Last Updated**: March 2024  
**Version**: 1.0  
**Status**: Ready for Testing (after migration)