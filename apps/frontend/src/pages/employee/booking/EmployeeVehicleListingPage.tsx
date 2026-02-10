import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';

import { VehicleFilters } from '@/components/vehicles/VehicleFilters';
import { VehicleGrid } from '@/components/vehicles/VehicleGrid';
import { Button } from '@/components/ui/button';

import { useEmployeeVehicles } from '@/hooks/useEmployeeVehicles';
import type { VehicleFilters as VehicleFiltersType } from '@/services/vehicle.service';

import { useEmployeeAuthStore } from '@/store/employeeAuth.store';
import { customerSession } from '@/utils/customerSession';
import { useEmployeeBookingStore } from '@/store/employeeBooking.store';

const ITEMS_PER_PAGE = 9;

export default function EmployeeVehicleListingPage() {
    const navigate = useNavigate();
    const { isAuthenticated } = useEmployeeAuthStore();

    // Employee booking store
    const { setDates, startDate: storeStart, endDate: storeEnd } = useEmployeeBookingStore();

    // Check sessions
    useEffect(() => {
        if (!isAuthenticated) return;
        if (!customerSession.exists()) {
            toast.error("No active customer session. Please select a customer first.");
            navigate("/employee/new-booking");
        }
    }, [isAuthenticated, navigate]);

    // Local State
    // Default to today if no store date
    const [selectedPickupDate, setSelectedPickupDate] = useState<Date | null>(
        storeStart ? new Date(storeStart) : new Date()
    );
    const [selectedReturnDate, setSelectedReturnDate] = useState<Date | null>(storeEnd ? new Date(storeEnd) : null);
    const [category, setCategory] = useState<string>('all');
    const [sortBy, setSortBy] = useState<string>('default');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Sync Store Dates
    useEffect(() => {
        if (selectedPickupDate && selectedReturnDate) {
            setDates(selectedPickupDate, selectedReturnDate);
        }
    }, [selectedPickupDate, selectedReturnDate, setDates]);

    // Reset Page on Filter Change
    useEffect(() => {
        setCurrentPage(1);
    }, [category, searchQuery, sortBy]);

    // Filter Construction
    const filters: VehicleFiltersType = useMemo(() => {
        const f: VehicleFiltersType = {};
        // Branch handled by backend token
        if (category && category !== 'all') f.category = category;
        if (searchQuery) f.search = searchQuery;
        if (sortBy && sortBy !== 'default') f.sort = sortBy as 'price_low_to_high' | 'price_high_to_low';

        if (selectedPickupDate) {
            const date = selectedPickupDate instanceof Date ? selectedPickupDate : new Date(selectedPickupDate);
            try {
                f.start = date.toISOString().split('T')[0];
            } catch (e) {
                console.error("Invalid pickup date:", selectedPickupDate);
            }
        }
        if (selectedReturnDate) {
            const date = selectedReturnDate instanceof Date ? selectedReturnDate : new Date(selectedReturnDate);
            try {
                f.end = date.toISOString().split('T')[0];
            } catch (e) {
                console.error("Invalid return date:", selectedReturnDate);
            }
        }

        f.limit = ITEMS_PER_PAGE;
        f.offset = (currentPage - 1) * ITEMS_PER_PAGE;
        return f;
    }, [category, searchQuery, sortBy, selectedPickupDate, selectedReturnDate, currentPage]);

    // Fetch Vehicles
    const { data: vehiclesData, isLoading: vehiclesLoading } = useEmployeeVehicles(filters);
    const vehicles = vehiclesData?.data || [];
    const vehicleCount = vehiclesData?.pagination?.total || vehicles.length || 0;

    // Handlers
    const handleReset = useCallback(() => {
        setSelectedPickupDate(new Date());
        setSelectedReturnDate(null);
        setCategory('all');
        setSortBy('default');
        setSearchQuery('');
        setCurrentPage(1);
    }, []);

    if (!isAuthenticated) return null;

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            {/* Header */}
            <div className="bg-white border-b sticky top-0 z-10 mb-6">
                <div className="container max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => navigate("/employee/new-booking")}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div>
                            <h1 className="text-lg font-semibold">Select Vehicle</h1>
                            <p className="text-xs text-muted-foreground">
                                Customer: {customerSession.get()?.name || 'Unknown'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <main className="container max-w-7xl mx-auto px-4">
                {/* Filters */}
                <div className="mb-6">
                    <VehicleFilters
                        branches={[]} // Employee branch is determined by backend token
                        branchesLoading={false}
                        selectedBranch=""
                        pickupDate={selectedPickupDate}
                        returnDate={selectedReturnDate}
                        category={category}
                        sortBy={sortBy}
                        searchQuery={searchQuery}
                        onBranchChange={() => { }} // No-op for employee page
                        onPickupDateChange={(date) => setSelectedPickupDate(date ?? null)}
                        onReturnDateChange={(date) => setSelectedReturnDate(date ?? null)}
                        onCategoryChange={setCategory}
                        onSortChange={setSortBy}
                        onSearchChange={setSearchQuery}
                        onReset={handleReset}
                        showBranchSelector={false} // Hide branch selector for employee page
                    />
                </div>

                {/* Grid */}
                <VehicleGrid
                    vehicles={vehicles}
                    isLoading={vehiclesLoading}
                    onReset={handleReset}
                    currentPage={currentPage}
                    totalCount={vehicleCount}
                    itemsPerPage={ITEMS_PER_PAGE}
                    onPageChange={setCurrentPage}
                    basePath="/employee/vehicle" // Redirect to employee details page
                />
            </main>
        </div>
    );
}
