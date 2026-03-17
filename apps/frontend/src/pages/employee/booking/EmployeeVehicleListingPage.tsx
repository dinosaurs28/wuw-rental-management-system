import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";

import { VehicleFilters } from "@/components/vehicles/VehicleFilters";
import { VehicleGrid } from "@/components/vehicles/VehicleGrid";
import { Button } from "@/components/ui/button";

import { useEmployeeVehicles } from "@/hooks/useEmployeeVehicles";
import type { VehicleFilters as VehicleFiltersType } from "@/services/vehicle.service";

import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import { customerSession } from "@/utils/customerSession";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";

const ITEMS_PER_PAGE = 9;

export default function EmployeeVehicleListingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useEmployeeAuthStore();

  const {
    setDates,
    setStartTime,
    setEndTime,
    startDate: storeStart,
    endDate: storeEnd,
    startTime: storeStartTime,
    endTime: storeEndTime,
  } = useEmployeeBookingStore();

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!customerSession.exists()) {
      toast.error(
        "No active customer session. Please select a customer first.",
      );
      navigate("/employee/new-booking");
    }
  }, [isAuthenticated, navigate]);

  const initialPickup = storeStart ? new Date(storeStart) : new Date();
  const [selectedPickupDate, setSelectedPickupDate] = useState<Date | null>(
    initialPickup,
  );

  const initialReturn = storeEnd
    ? new Date(storeEnd)
    : (() => {
        const d = new Date(initialPickup);
        d.setDate(d.getDate() + 1);
        return d;
      })();
  const [selectedReturnDate, setSelectedReturnDate] = useState<Date | null>(
    initialReturn,
  );
  const [pickupTime, setPickupTime] = useState<string>(
    storeStartTime || "10:00",
  );
  const [returnTime, setReturnTime] = useState<string>(storeEndTime || "10:00");
  const [category, setCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("default");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Sync store
  useEffect(() => {
    if (selectedPickupDate && selectedReturnDate) {
      setDates(selectedPickupDate, selectedReturnDate);
    }
  }, [selectedPickupDate, selectedReturnDate, setDates]);

  useEffect(() => {
    setStartTime(pickupTime);
  }, [pickupTime, setStartTime]);

  useEffect(() => {
    setEndTime(returnTime);
  }, [returnTime, setEndTime]);

  useEffect(() => {
    setCurrentPage(1);
  }, [category, searchQuery, sortBy]);

  const filters: VehicleFiltersType = useMemo(() => {
    const f: VehicleFiltersType = {};
    if (category && category !== "all") f.category = category;
    if (searchQuery) f.search = searchQuery;
    if (sortBy && sortBy !== "default")
      f.sort = sortBy as "price_low_to_high" | "price_high_to_low";

    if (selectedPickupDate) {
      try {
        f.start = `${format(selectedPickupDate, "yyyy-MM-dd")}T${pickupTime}`;
      } catch (e) {
        console.error("Invalid pickup date:", selectedPickupDate);
      }
    }
    if (selectedReturnDate) {
      try {
        f.end = `${format(selectedReturnDate, "yyyy-MM-dd")}T${returnTime}`;
      } catch (e) {
        console.error("Invalid return date:", selectedReturnDate);
      }
    }

    f.limit = ITEMS_PER_PAGE;
    f.offset = (currentPage - 1) * ITEMS_PER_PAGE;
    return f;
  }, [
    category,
    searchQuery,
    sortBy,
    selectedPickupDate,
    selectedReturnDate,
    pickupTime,
    returnTime,
    currentPage,
  ]);

  const {
    data: vehiclesData,
    isLoading: initialLoading,
    isFetching,
  } = useEmployeeVehicles(filters);
  const isLoading = initialLoading || isFetching;
  const vehicles = vehiclesData?.data || [];
  const vehicleCount = vehiclesData?.pagination?.total || vehicles.length || 0;

  const handleReset = useCallback(() => {
    const today = new Date();
    setSelectedPickupDate(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setSelectedReturnDate(tomorrow);
    setPickupTime("10:00");
    setReturnTime("10:00");
    setCategory("all");
    setSortBy("default");
    setSearchQuery("");
    setCurrentPage(1);
  }, []);

  // Build datetime strings for VehicleCard URL params
  const startDateTime = selectedPickupDate
    ? `${format(selectedPickupDate, "yyyy-MM-dd")}T${pickupTime}`
    : undefined;
  const endDateTime = selectedReturnDate
    ? `${format(selectedReturnDate, "yyyy-MM-dd")}T${returnTime}`
    : undefined;

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white border-b sticky top-0 z-10 mb-6">
        <div className="container max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/employee/new-booking")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Select Vehicle</h1>
              <p className="text-xs text-muted-foreground">
                Customer: {customerSession.get()?.name || "Unknown"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <main className="container max-w-7xl mx-auto px-4">
        <div className="mb-6">
          <VehicleFilters
            branches={[]}
            branchesLoading={false}
            selectedBranch=""
            pickupDate={selectedPickupDate}
            returnDate={selectedReturnDate}
            pickupTime={pickupTime}
            returnTime={returnTime}
            category={category}
            sortBy={sortBy}
            searchQuery={searchQuery}
            onBranchChange={() => {}}
            onPickupDateChange={(date) => {
              setSelectedPickupDate(date ?? null);
              if (date) {
                const nextDay = new Date(date);
                nextDay.setDate(nextDay.getDate() + 1);
                setSelectedReturnDate(nextDay);
              } else {
                setSelectedReturnDate(null);
              }
            }}
            onReturnDateChange={(date) => setSelectedReturnDate(date ?? null)}
            onPickupTimeChange={setPickupTime}
            onReturnTimeChange={setReturnTime}
            onCategoryChange={setCategory}
            onSortChange={setSortBy}
            onSearchChange={setSearchQuery}
            onReset={handleReset}
            showBranchSelector={false}
          />
        </div>

        <VehicleGrid
          vehicles={vehicles}
          isLoading={isLoading}
          onReset={handleReset}
          currentPage={currentPage}
          totalCount={vehicleCount}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
          basePath="/employee/vehicle"
          startDateTime={startDateTime}
          endDateTime={endDateTime}
        />
      </main>
    </div>
  );
}
