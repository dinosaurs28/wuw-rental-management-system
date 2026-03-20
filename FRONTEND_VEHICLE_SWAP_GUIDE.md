# VEHICLE SWAP FEATURE - FRONTEND IMPLEMENTATION GUIDE

## 🎯 Overview

This guide provides the frontend implementation details for the Vehicle Swap feature. The backend has been fully implemented with the following components:

### ✅ Backend Components Completed

1. **Database Schema** - `VehicleSwap` model added to Prisma schema
2. **Service Layer** - `VehicleSwapService` with complete business logic
3. **Controller Layer** - Vehicle swap controller with validation
4. **Routes** - Integrated into Branch Manager routes
5. **Validation Schemas** - Zod schemas for request validation

---

## 📡 API Endpoints

### 1. Get Available Vehicles for Swap
```
GET /api/branchManager/dashboard/bookings/:bookingId/available-vehicles
```

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Available vehicles fetched successfully",
  "data": [
    {
      "id": 123,
      "publicId": "veh_abc123",
      "make": "Honda",
      "model": "Activa",
      "regNo": "MH-01-AB-1234",
      "status": "AVAILABLE",
      "categoryId": 1,
      "categoryName": "Scooter",
      "categoryRank": 1,
      "images": [{ "url": "https://..." }]
    }
  ]
}
```

### 2. Perform Vehicle Swap
```
POST /api/branchManager/dashboard/bookings/:bookingId/swap-vehicle
```

**Headers:**
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "newVehicleId": 456,
  "reason": "MAINTENANCE",
  "reasonNotes": "Customer reported unusual noise",
  "markOriginalForMaintenance": true,
  "originalVehicleNotes": "Requires engine inspection"
}
```

**Valid Reasons:**
- `CUSTOMER_REQUEST`
- `MAINTENANCE`
- `UPGRADE`
- `DOWNGRADE`
- `DAMAGE`
- `OTHER`

**Response:**
```json
{
  "message": "Vehicle swapped successfully",
  "data": {
    "id": 1,
    "publicId": "swap_xyz789",
    "bookingId": 100,
    "originalVehicleId": 123,
    "newVehicleId": 456,
    "reason": "MAINTENANCE",
    "swappedAt": "2024-03-20T10:30:00Z"
  }
}
```

### 3. Get Swap History (All)
```
GET /api/branchManager/dashboard/swap-history?startDate=2024-03-01&endDate=2024-03-31
```

**Query Parameters:**
- `startDate` (required if no bookingId): ISO datetime string
- `endDate` (required if no bookingId): ISO datetime string
- `vehicleId` (optional): Filter by vehicle
- `reason` (optional): Filter by swap reason
- `bookingId` (optional): Get history for specific booking

### 4. Get Booking Swap History
```
GET /api/branchManager/dashboard/bookings/:bookingId/swap-history
```

**Response:**
```json
{
  "message": "Swap history fetched successfully",
  "data": [
    {
      "id": 1,
      "publicId": "swap_xyz789",
      "reason": "MAINTENANCE",
      "reasonNotes": "Customer reported unusual noise",
      "swappedAt": "2024-03-20T10:30:00Z",
      "originalVehicle": {
        "make": "Honda",
        "model": "Activa",
        "regNo": "MH-01-AB-1234"
      },
      "newVehicle": {
        "make": "Honda",
        "model": "Dio",
        "regNo": "MH-01-CD-5678"
      },
      "swappedBy": {
        "name": "John Manager",
        "email": "john@wuwrentals.com"
      }
    }
  ]
}
```

---

## 🗂️ Frontend File Structure

```
apps/frontend/src/
├── pages/
│   └── branch-manager/
│       └── bookings/
│           ├── ActiveBookingsPage.tsx          (Existing - Add swap button)
│           └── VehicleSwapPage.tsx             (New)
├── components/
│   └── branch-manager/
│       └── vehicle-swap/
│           ├── AvailableVehiclesList.tsx       (New)
│           ├── SwapConfirmationModal.tsx       (New)
│           ├── SwapHistoryTable.tsx            (New)
│           └── SwapReasonSelector.tsx          (New)
├── services/
│   └── api/
│       └── vehicleSwap.service.ts              (New)
├── hooks/
│   └── useVehicleSwap.ts                       (New)
└── types/
    └── vehicleSwap.types.ts                    (New)
```

---

## 📝 Type Definitions

Create `apps/frontend/src/types/vehicleSwap.types.ts`:

```typescript
export enum SwapReason {
  CUSTOMER_REQUEST = 'CUSTOMER_REQUEST',
  MAINTENANCE = 'MAINTENANCE',
  UPGRADE = 'UPGRADE',
  DOWNGRADE = 'DOWNGRADE',
  DAMAGE = 'DAMAGE',
  OTHER = 'OTHER',
}

export interface AvailableVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  status: string;
  categoryId: number;
  categoryName: string;
  categoryRank: number;
  images: Array<{ url: string | null }>;
}

export interface VehicleSwapRequest {
  newVehicleId: number;
  reason: SwapReason;
  reasonNotes?: string;
  markOriginalForMaintenance?: boolean;
  originalVehicleNotes?: string;
}

export interface VehicleSwap {
  id: number;
  publicId: string;
  bookingId: number;
  originalVehicleId: number;
  newVehicleId: number;
  reason: SwapReason;
  reasonNotes?: string;
  originalVehicleStatus?: string;
  originalVehicleNotes?: string;
  swappedAt: string;
  originalVehicle?: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
  };
  newVehicle?: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
  };
  swappedBy?: {
    name: string;
    email: string;
  };
}

export interface SwapHistoryFilters {
  startDate?: string;
  endDate?: string;
  vehicleId?: number;
  reason?: SwapReason;
  bookingId?: number;
}
```

---

## 🔌 API Service

Create `apps/frontend/src/services/api/vehicleSwap.service.ts`:

```typescript
import { apiClient } from './client'; // Adjust based on your API client setup
import {
  AvailableVehicle,
  VehicleSwapRequest,
  VehicleSwap,
  SwapHistoryFilters,
} from '../../types/vehicleSwap.types';

export const vehicleSwapService = {
  /**
   * Get available vehicles for swap
   */
  async getAvailableVehicles(bookingId: string): Promise<AvailableVehicle[]> {
    const response = await apiClient.get(
      `/branchManager/dashboard/bookings/${bookingId}/available-vehicles`
    );
    return response.data.data;
  },

  /**
   * Perform vehicle swap
   */
  async performSwap(
    bookingId: string,
    swapRequest: VehicleSwapRequest
  ): Promise<VehicleSwap> {
    const response = await apiClient.post(
      `/branchManager/dashboard/bookings/${bookingId}/swap-vehicle`,
      swapRequest
    );
    return response.data.data;
  },

  /**
   * Get swap history for a booking
   */
  async getBookingSwapHistory(bookingId: string): Promise<VehicleSwap[]> {
    const response = await apiClient.get(
      `/branchManager/dashboard/bookings/${bookingId}/swap-history`
    );
    return response.data.data;
  },

  /**
   * Get swap history with filters
   */
  async getSwapHistory(filters: SwapHistoryFilters): Promise<VehicleSwap[]> {
    const params = new URLSearchParams();
    
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.vehicleId) params.append('vehicleId', filters.vehicleId.toString());
    if (filters.reason) params.append('reason', filters.reason);
    if (filters.bookingId) params.append('bookingId', filters.bookingId.toString());

    const response = await apiClient.get(
      `/branchManager/dashboard/swap-history?${params.toString()}`
    );
    return response.data.data;
  },
};
```

---

## 🎣 Custom Hook

Create `apps/frontend/src/hooks/useVehicleSwap.ts`:

```typescript
import { useState, useCallback } from 'react';
import { vehicleSwapService } from '../services/api/vehicleSwap.service';
import {
  AvailableVehicle,
  VehicleSwapRequest,
  VehicleSwap,
} from '../types/vehicleSwap.types';
import { toast } from 'react-hot-toast'; // or your toast library

export const useVehicleSwap = (bookingId: string) => {
  const [availableVehicles, setAvailableVehicles] = useState<AvailableVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAvailableVehicles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vehicles = await vehicleSwapService.getAvailableVehicles(bookingId);
      setAvailableVehicles(vehicles);
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || 'Failed to fetch available vehicles';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  const performSwap = useCallback(
    async (swapRequest: VehicleSwapRequest): Promise<VehicleSwap | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await vehicleSwapService.performSwap(bookingId, swapRequest);
        toast.success('Vehicle swapped successfully!');
        return result;
      } catch (err: any) {
        const errorMsg = err.response?.data?.message || 'Failed to swap vehicle';
        setError(errorMsg);
        toast.error(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [bookingId]
  );

  return {
    availableVehicles,
    loading,
    error,
    fetchAvailableVehicles,
    performSwap,
  };
};
```

---

## 🎨 Component Examples

### 1. Available Vehicles List Component

`apps/frontend/src/components/branch-manager/vehicle-swap/AvailableVehiclesList.tsx`:

```typescript
import React from 'react';
import { AvailableVehicle } from '../../../types/vehicleSwap.types';

interface AvailableVehiclesListProps {
  vehicles: AvailableVehicle[];
  currentVehicleId: number;
  onSelectVehicle: (vehicle: AvailableVehicle) => void;
  selectedVehicleId?: number;
}

export const AvailableVehiclesList: React.FC<AvailableVehiclesListProps> = ({
  vehicles,
  currentVehicleId,
  onSelectVehicle,
  selectedVehicleId,
}) => {
  // Group vehicles by category
  const groupedVehicles = vehicles.reduce((acc, vehicle) => {
    const category = vehicle.categoryName;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(vehicle);
    return acc;
  }, {} as Record<string, AvailableVehicle[]>);

  return (
    <div className="space-y-6">
      {Object.entries(groupedVehicles).map(([category, categoryVehicles]) => (
        <div key={category}>
          <h3 className="text-lg font-semibold mb-3">{category}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoryVehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className={`
                  border rounded-lg p-4 cursor-pointer transition-all
                  ${selectedVehicleId === vehicle.id 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-300 hover:border-blue-300'
                  }
                `}
                onClick={() => onSelectVehicle(vehicle)}
              >
                {vehicle.images[0]?.url && (
                  <img
                    src={vehicle.images[0].url}
                    alt={`${vehicle.make} ${vehicle.model}`}
                    className="w-full h-32 object-cover rounded mb-3"
                  />
                )}
                <div className="space-y-1">
                  <h4 className="font-semibold">
                    {vehicle.make} {vehicle.model}
                  </h4>
                  <p className="text-sm text-gray-600">{vehicle.regNo}</p>
                  <span className="inline-block px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                    {vehicle.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
```

### 2. Swap Confirmation Modal

`apps/frontend/src/components/branch-manager/vehicle-swap/SwapConfirmationModal.tsx`:

```typescript
import React, { useState } from 'react';
import { SwapReason, AvailableVehicle } from '../../../types/vehicleSwap.types';

interface SwapConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    reason: SwapReason;
    reasonNotes?: string;
    markOriginalForMaintenance: boolean;
    originalVehicleNotes?: string;
  }) => void;
  currentVehicle: { make: string; model: string; regNo: string };
  newVehicle: AvailableVehicle;
  loading?: boolean;
}

export const SwapConfirmationModal: React.FC<SwapConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentVehicle,
  newVehicle,
  loading = false,
}) => {
  const [reason, setReason] = useState<SwapReason>(SwapReason.CUSTOMER_REQUEST);
  const [reasonNotes, setReasonNotes] = useState('');
  const [markForMaintenance, setMarkForMaintenance] = useState(false);
  const [maintenanceNotes, setMaintenanceNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({
      reason,
      reasonNotes: reasonNotes.trim() || undefined,
      markOriginalForMaintenance: markForMaintenance,
      originalVehicleNotes: markForMaintenance ? maintenanceNotes : undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">Confirm Vehicle Swap</h2>

        {/* Vehicle Comparison */}
        <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 rounded">
          <div>
            <p className="text-sm text-gray-600 mb-1">Current Vehicle</p>
            <p className="font-semibold">
              {currentVehicle.make} {currentVehicle.model}
            </p>
            <p className="text-sm text-gray-600">{currentVehicle.regNo}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600 mb-1">New Vehicle</p>
            <p className="font-semibold">
              {newVehicle.make} {newVehicle.model}
            </p>
            <p className="text-sm text-gray-600">{newVehicle.regNo}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Swap Reason */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Reason for Swap <span className="text-red-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as SwapReason)}
              className="w-full border rounded px-3 py-2"
              required
            >
              <option value={SwapReason.CUSTOMER_REQUEST}>Customer Request</option>
              <option value={SwapReason.MAINTENANCE}>Maintenance Required</option>
              <option value={SwapReason.UPGRADE}>Upgrade</option>
              <option value={SwapReason.DOWNGRADE}>Downgrade</option>
              <option value={SwapReason.DAMAGE}>Damage</option>
              <option value={SwapReason.OTHER}>Other</option>
            </select>
          </div>

          {/* Reason Notes */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Additional Notes
            </label>
            <textarea
              value={reasonNotes}
              onChange={(e) => setReasonNotes(e.target.value)}
              className="w-full border rounded px-3 py-2"
              rows={3}
              maxLength={500}
              placeholder="Provide additional details about the swap..."
            />
            <p className="text-xs text-gray-500 mt-1">
              {reasonNotes.length}/500 characters
            </p>
          </div>

          {/* Mark for Maintenance */}
          <div className="mb-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={markForMaintenance}
                onChange={(e) => setMarkForMaintenance(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm font-medium">
                Mark original vehicle for maintenance
              </span>
            </label>
          </div>

          {/* Maintenance Notes */}
          {markForMaintenance && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Maintenance Notes <span className="text-red-500">*</span>
              </label>
              <textarea
                value={maintenanceNotes}
                onChange={(e) => setMaintenanceNotes(e.target.value)}
                className="w-full border rounded px-3 py-2"
                rows={3}
                maxLength={1000}
                required={markForMaintenance}
                placeholder="Describe what maintenance is required..."
              />
              <p className="text-xs text-gray-500 mt-1">
                {maintenanceNotes.length}/1000 characters
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={loading || (markForMaintenance && !maintenanceNotes.trim())}
            >
              {loading ? 'Swapping...' : 'Confirm Swap'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

### 3. Vehicle Swap Page

`apps/frontend/src/pages/branch-manager/bookings/VehicleSwapPage.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useVehicleSwap } from '../../../hooks/useVehicleSwap';
import { AvailableVehiclesList } from '../../../components/branch-manager/vehicle-swap/AvailableVehiclesList';
import { SwapConfirmationModal } from '../../../components/branch-manager/vehicle-swap/SwapConfirmationModal';
import { AvailableVehicle } from '../../../types/vehicleSwap.types';

export const VehicleSwapPage: React.FC = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const { availableVehicles, loading, fetchAvailableVehicles, performSwap } =
    useVehicleSwap(bookingId!);

  const [selectedVehicle, setSelectedVehicle] = useState<AvailableVehicle | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [currentVehicle, setCurrentVehicle] = useState<any>(null); // Fetch from booking details

  useEffect(() => {
    if (bookingId) {
      fetchAvailableVehicles();
      // TODO: Fetch current booking details to get current vehicle info
    }
  }, [bookingId]);

  const handleSelectVehicle = (vehicle: AvailableVehicle) => {
    setSelectedVehicle(vehicle);
    setShowConfirmModal(true);
  };

  const handleConfirmSwap = async (swapData: any) => {
    if (!selectedVehicle) return;

    const result = await performSwap({
      newVehicleId: selectedVehicle.id,
      ...swapData,
    });

    if (result) {
      setShowConfirmModal(false);
      // Navigate back or show success
      navigate(`/branch-manager/bookings/${bookingId}`);
    }
  };

  if (loading && availableVehicles.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Loading available vehicles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Swap Vehicle</h1>
        <p className="text-gray-600">
          Select a new vehicle to swap for booking {bookingId}
        </p>
      </div>

      {availableVehicles.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <p className="text-yellow-800">
            No available vehicles found for swap. All vehicles are either in use or not suitable for this booking.
          </p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      ) : (
        <AvailableVehiclesList
          vehicles={availableVehicles}
          currentVehicleId={currentVehicle?.id}
          onSelectVehicle={handleSelectVehicle}
          selectedVehicleId={selectedVehicle?.id}
        />
      )}

      {selectedVehicle && currentVehicle && (
        <SwapConfirmationModal
          isOpen={showConfirmModal}
          onClose={() => {
            setShowConfirmModal(false);
            setSelectedVehicle(null);
          }}
          onConfirm={handleConfirmSwap}
          currentVehicle={currentVehicle}
          newVehicle={selectedVehicle}
          loading={loading}
        />
      )}
    </div>
  );
};
```

---

## 🔄 Integration with Active Bookings Page

Add a "Swap Vehicle" button to your existing `ActiveBookingsPage`:

```typescript
// In ActiveBookingsPage.tsx
import { useNavigate } from 'react-router-dom';

const navigate = useNavigate();

const handleSwapVehicle = (bookingId: string) => {
  navigate(`/branch-manager/bookings/${bookingId}/swap-vehicle`);
};

// In your booking card/row component:
<button
  onClick={() => handleSwapVehicle(booking.publicId)}
  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
  disabled={booking.status !== 'CONFIRMED' && booking.status !== 'PICKED_UP'}
>
  Swap Vehicle
</button>
```

---

## 🛣️ Route Configuration

Add to your router configuration:

```typescript
// In your router setup
{
  path: '/branch-manager/bookings/:bookingId/swap-vehicle',
  element: <VehicleSwapPage />,
  // Add appropriate guards/middleware
}
```

---

## ✅ Testing Checklist

### Unit Tests
- [ ] Test `useVehicleSwap` hook with mock data
- [ ] Test `AvailableVehiclesList` component rendering
- [ ] Test `SwapConfirmationModal` form validation
- [ ] Test `vehicleSwapService` API calls

### Integration Tests
- [ ] Test complete swap flow from selection to confirmation
- [ ] Test error handling for failed swaps
- [ ] Test loading states
- [ ] Test form validation and submission

### E2E Tests
- [ ] User can view available vehicles
- [ ] User can select and swap a vehicle
- [ ] User sees success notification
- [ ] Booking reflects new vehicle after swap
- [ ] Swap history is recorded

---

## 🎨 UI/UX Recommendations

### Visual Indicators
1. **Same Category Badge**: Show a badge when viewing same-category vehicles
2. **Upgrade Badge**: Highlight vehicles in higher categories with an "Upgrade" badge
3. **Vehicle Images**: Display vehicle images for easy identification
4. **Category Grouping**: Group available vehicles by category

### User Flow
1. Manager clicks "Swap Vehicle" on active booking
2. System shows only eligible vehicles (same or higher category, available)
3. Manager selects new vehicle
4. Modal shows comparison between current and new vehicle
5. Manager selects reason and provides notes
6. Option to mark original vehicle for maintenance
7. Confirmation and success notification
8. Booking updated with new vehicle

### Error Handling
- Clear error messages for eligibility issues
- Validation feedback in real-time
- Graceful handling of network errors
- Option to retry failed operations

---

## 🚀 Deployment Steps

1. **Backend First**
   ```bash
   # Run migration
   cd packages/db
   pnpm db:migrate:dev --name add_vehicle_swap_feature
   pnpm db:generate
   ```

2. **Build Backend**
   ```bash
   cd apps/backend
   pnpm build
   ```

3. **Build Frontend**
   ```bash
   cd apps/frontend
   pnpm build
   ```

4. **Test in Staging**
   - Test all swap scenarios
   - Verify database records
   - Check audit logs

5. **Deploy to Production**
   - Deploy backend first
   - Deploy frontend
   - Monitor for errors

---

## 📊 Analytics & Monitoring

Track the following metrics:
- Number of vehicle swaps per day/week/month
- Most common swap reasons
- Average time to complete swap
- Vehicles most frequently swapped
- Swap success/failure rate

---

## 🔐 Security Considerations

1. **Authorization**: Only branch managers should access swap endpoints
2. **Validation**: All inputs validated on both frontend and backend
3. **Audit Trail**: All swaps logged with user, timestamp, and reason
4. **Rate Limiting**: Prevent abuse of swap functionality
5. **Data Integrity**: Transaction-based operations ensure consistency

---

## 📚 Additional Resources

- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Zod Validation](https://github.com/colinhacks/zod)
- [React Hook Best Practices](https://react.dev/reference/react)

---

## 🤝 Support

For issues or questions:
1. Check implementation.md for business rules
2. Review backend service logs
3. Verify database schema matches expectations
4. Contact development team

---

**Last Updated**: March 2024  
**Version**: 1.0.0