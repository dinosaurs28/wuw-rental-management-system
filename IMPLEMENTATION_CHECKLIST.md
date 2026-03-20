# VEHICLE SWAP FEATURE - IMPLEMENTATION CHECKLIST

## ✅ Completion Tracker

Use this checklist to track your implementation progress. Check off items as you complete them.

---

## 🗄️ DATABASE IMPLEMENTATION

### Migration & Schema
- [ ] Navigate to `packages/db` directory
- [ ] Run `pnpm db:migrate:dev --name add_vehicle_swap_feature`
- [ ] Verify migration completed without errors
- [ ] Run `pnpm db:generate` to regenerate Prisma client
- [ ] Verify Prisma client includes `VehicleSwap` model
- [ ] Verify Prisma client includes `SwapReason` enum

### Data Setup
- [ ] Connect to database (PostgreSQL)
- [ ] Verify `VehicleSwap` table exists
- [ ] Verify `VehicleCategory` has `rank` column
- [ ] Verify `AuditLog` has `metadata` column
- [ ] Set rank values for all vehicle categories
  - [ ] Scooter = 1
  - [ ] Bike = 2
  - [ ] Premium = 3
  - [ ] Luxury = 4 (adjust based on your categories)
- [ ] Run verification query to confirm ranks are set

---

## 🔧 BACKEND IMPLEMENTATION

### Code Verification
- [ ] Check `apps/backend/src/services/vehicle-swap/vehicle-swap.service.ts` exists
- [ ] Check `apps/backend/src/controller/branchManager/vehicle-swap.controller.ts` exists
- [ ] Verify routes added to `apps/backend/src/routes/branchManger/branchManager.routes.ts`
- [ ] Verify schemas added to `packages/schemas/src/vehicle.schema.ts`
- [ ] Run `pnpm tsc --noEmit` in backend (should have no errors)

### Testing Backend
- [ ] Start backend server (`cd apps/backend && pnpm dev`)
- [ ] Test endpoint 1: GET available vehicles
  - [ ] Returns 200 OK for valid booking
  - [ ] Returns 400/404 for invalid booking
  - [ ] Returns vehicles in correct format
- [ ] Test endpoint 2: POST swap vehicle
  - [ ] Successfully swaps vehicle with valid data
  - [ ] Validates required fields
  - [ ] Returns 400 for invalid data
  - [ ] Returns swap record on success
- [ ] Test endpoint 3: GET swap history (by booking)
  - [ ] Returns array of swaps
  - [ ] Includes vehicle and user details
- [ ] Test endpoint 4: GET swap history (by date range)
  - [ ] Filters by date correctly
  - [ ] Optional filters work (vehicleId, reason)

### Database Verification
- [ ] After test swap: Check `VehicleSwap` table has record
- [ ] Verify `BookingItem` updated with new vehicle
- [ ] Verify original vehicle status changed
- [ ] Verify new vehicle status is `OUT_FOR_RENTAL`
- [ ] Verify `AuditLog` has swap entry

---

## 🎨 FRONTEND IMPLEMENTATION

### File Structure Setup
- [ ] Create directory: `apps/frontend/src/types/`
- [ ] Create directory: `apps/frontend/src/services/api/`
- [ ] Create directory: `apps/frontend/src/hooks/`
- [ ] Create directory: `apps/frontend/src/components/branch-manager/vehicle-swap/`
- [ ] Create directory: `apps/frontend/src/pages/branch-manager/bookings/`

### Type Definitions
- [ ] Create `apps/frontend/src/types/vehicleSwap.types.ts`
- [ ] Add `SwapReason` enum
- [ ] Add `AvailableVehicle` interface
- [ ] Add `VehicleSwapRequest` interface
- [ ] Add `VehicleSwap` interface
- [ ] Add `SwapHistoryFilters` interface

### API Service Layer
- [ ] Create `apps/frontend/src/services/api/vehicleSwap.service.ts`
- [ ] Implement `getAvailableVehicles()` method
- [ ] Implement `performSwap()` method
- [ ] Implement `getBookingSwapHistory()` method
- [ ] Implement `getSwapHistory()` method
- [ ] Configure API base URL and authentication headers

### Custom Hook
- [ ] Create `apps/frontend/src/hooks/useVehicleSwap.ts`
- [ ] Implement state management (availableVehicles, loading, error)
- [ ] Implement `fetchAvailableVehicles()` function
- [ ] Implement `performSwap()` function
- [ ] Add error handling with toast notifications
- [ ] Add loading states

### Components
- [ ] Create `AvailableVehiclesList.tsx`
  - [ ] Display vehicles grouped by category
  - [ ] Show vehicle images
  - [ ] Handle vehicle selection
  - [ ] Show selected state
- [ ] Create `SwapConfirmationModal.tsx`
  - [ ] Show current vs new vehicle comparison
  - [ ] Swap reason dropdown
  - [ ] Reason notes textarea
  - [ ] Mark for maintenance checkbox
  - [ ] Maintenance notes (conditional)
  - [ ] Form validation
  - [ ] Submit handler
- [ ] Create `SwapHistoryTable.tsx` (optional)
  - [ ] Display swap records in table
  - [ ] Show dates, vehicles, reason
  - [ ] Filter options
- [ ] Create `SwapReasonSelector.tsx` (optional)
  - [ ] Reason dropdown component
  - [ ] Custom validation

### Pages
- [ ] Create `VehicleSwapPage.tsx`
  - [ ] Fetch available vehicles on mount
  - [ ] Display loading state
  - [ ] Display available vehicles list
  - [ ] Handle vehicle selection
  - [ ] Show confirmation modal
  - [ ] Handle swap submission
  - [ ] Show success/error notifications
  - [ ] Navigate back on success

### Integration
- [ ] Update `ActiveBookingsPage.tsx`
  - [ ] Add "Swap Vehicle" button to booking cards/rows
  - [ ] Disable button for ineligible bookings
  - [ ] Handle navigation to swap page
- [ ] Add route in router configuration
  - [ ] Path: `/branch-manager/bookings/:bookingId/swap-vehicle`
  - [ ] Component: `<VehicleSwapPage />`
  - [ ] Add authentication guard
  - [ ] Add manager role check
- [ ] Update navigation/menu (if needed)
  - [ ] Add "Swap History" link (optional)

---

## 🧪 TESTING

### Unit Tests
- [ ] Test `VehicleSwapService` methods
  - [ ] getAvailableVehiclesForSwap
  - [ ] performVehicleSwap
  - [ ] getSwapHistory
  - [ ] validateSwapEligibility
- [ ] Test controller validation
- [ ] Test API service methods (frontend)
- [ ] Test `useVehicleSwap` hook
- [ ] Test component rendering

### Integration Tests
- [ ] Test complete swap flow (backend)
  - [ ] Database transaction rollback on error
  - [ ] Status updates work correctly
  - [ ] Audit logs created
- [ ] Test API endpoints with various scenarios
  - [ ] Valid requests succeed
  - [ ] Invalid requests fail with proper errors
  - [ ] Authorization enforced

### E2E Tests
- [ ] Manager login
- [ ] Navigate to active bookings
- [ ] Click swap vehicle
- [ ] See available vehicles
- [ ] Select vehicle
- [ ] Fill swap form
- [ ] Submit swap
- [ ] Verify success notification
- [ ] Verify booking updated
- [ ] Check swap history

### Edge Cases
- [ ] Try swap on RETURNED booking (should fail)
- [ ] Try swap on CANCELLED booking (should fail)
- [ ] Try swap with lower category vehicle (should fail)
- [ ] Try swap with unavailable vehicle (should fail)
- [ ] Try swap without maintenance notes when flagged (should fail)
- [ ] Test with no available vehicles
- [ ] Test with network errors
- [ ] Test with slow API responses

---

## 📊 DATA VERIFICATION

### After First Successful Swap
- [ ] Check `VehicleSwap` table has 1 record
- [ ] Verify all swap fields populated correctly
- [ ] Check `BookingItem.vehicleId` updated
- [ ] Verify original vehicle status updated
- [ ] Verify new vehicle status is `OUT_FOR_RENTAL`
- [ ] Check `AuditLog` has swap entry with metadata
- [ ] Verify booking still shows correct dates
- [ ] Verify pricing unchanged

---

## 📝 DOCUMENTATION

### Code Documentation
- [ ] Add JSDoc comments to service methods
- [ ] Add prop type documentation to components
- [ ] Document environment variables (if any new)
- [ ] Update README with feature description

### User Documentation
- [ ] Create manager user guide for swaps
- [ ] Document swap reasons and when to use them
- [ ] Create troubleshooting guide
- [ ] Add screenshots to documentation

### Technical Documentation
- [ ] Document API endpoints (Swagger/OpenAPI)
- [ ] Update ER diagram with VehicleSwap table
- [ ] Document business rules
- [ ] Add to release notes

---

## 🚀 DEPLOYMENT

### Pre-Deployment
- [ ] All tests passing
- [ ] Code reviewed by team
- [ ] No TypeScript errors
- [ ] No console errors in browser
- [ ] Tested in staging environment
- [ ] Rollback plan documented
- [ ] Database backup created

### Deployment to Staging
- [ ] Deploy database migration
- [ ] Set category ranks
- [ ] Deploy backend
- [ ] Deploy frontend
- [ ] Verify all 4 endpoints work
- [ ] Perform test swap
- [ ] Verify data in database

### Deployment to Production
- [ ] Create database backup
- [ ] Run migration in production
- [ ] Set category ranks in production
- [ ] Deploy backend to production
- [ ] Deploy frontend to production
- [ ] Smoke test all endpoints
- [ ] Monitor logs for errors
- [ ] Verify first production swap

### Post-Deployment
- [ ] Monitor error logs (first 24 hours)
- [ ] Check swap frequency
- [ ] Verify no performance issues
- [ ] Collect user feedback
- [ ] Document any issues found

---

## 📈 MONITORING & ANALYTICS

### Setup Tracking
- [ ] Add analytics event: "vehicle_swap_initiated"
- [ ] Add analytics event: "vehicle_swap_completed"
- [ ] Add analytics event: "vehicle_swap_failed"
- [ ] Track swap reasons distribution
- [ ] Track swap frequency per branch
- [ ] Monitor swap API response times

### Alerts
- [ ] Set up alert for high swap failure rate
- [ ] Set up alert for unusual swap volume
- [ ] Monitor database table size growth
- [ ] Track API endpoint errors

---

## ✅ DEFINITION OF DONE

Feature is complete when:

- [x] Database migration applied successfully
- [x] Backend code compiles without errors
- [x] All 4 API endpoints return valid responses
- [ ] Frontend components render without errors
- [ ] Manager can view available vehicles
- [ ] Manager can complete a swap
- [ ] Booking reflects new vehicle after swap
- [ ] Swap history is accessible and accurate
- [ ] Audit trail captures all swap details
- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] Deployed to production
- [ ] No critical bugs reported in first week

---

## 🎯 PRIORITY LEVELS

### P0 - Critical (Must Have)
- ✅ Database schema and migration
- ✅ Backend service layer
- ✅ Backend controller and routes
- ✅ Validation schemas
- ⏳ Frontend swap page (basic)
- ⏳ Swap button on active bookings

### P1 - High (Should Have)
- ⏳ Swap confirmation modal
- ⏳ Available vehicles list with images
- ⏳ Error handling and notifications
- ⏳ Basic tests

### P2 - Medium (Nice to Have)
- Swap history page
- Advanced filtering
- Comprehensive tests
- Analytics dashboard

### P3 - Low (Future)
- Customer notifications
- Price adjustments
- Approval workflows
- Mobile optimization

---

## 📞 SUPPORT CONTACTS

**For Issues**:
- Backend errors: Check `IMPLEMENTATION_SUMMARY.md`
- Frontend help: Check `FRONTEND_VEHICLE_SWAP_GUIDE.md`
- Quick help: Check `QUICK_START.md`
- Database issues: Check migration files in `packages/db/prisma/migrations/`

---

## 📅 TIMELINE ESTIMATE

- **Database (1-2 hours)**
  - Migration: 30 minutes
  - Data setup: 30 minutes
  - Verification: 30 minutes

- **Backend Testing (1-2 hours)**
  - API testing: 1 hour
  - Bug fixes: 1 hour

- **Frontend (4-8 hours)**
  - Type definitions: 30 minutes
  - API service: 1 hour
  - Components: 3-4 hours
  - Integration: 1-2 hours
  - Testing: 1 hour

- **Testing & Deployment (2-4 hours)**
  - E2E testing: 2 hours
  - Deployment: 1 hour
  - Verification: 1 hour

**Total: 8-16 hours for complete implementation**

---

**Last Updated**: March 2024
**Checklist Version**: 1.0