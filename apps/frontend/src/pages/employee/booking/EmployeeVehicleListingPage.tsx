import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Lock, ShieldOff } from "lucide-react";
import { format } from "date-fns";
import { getCurrentTime } from "@/utils/formatters";

import { VehicleFilters } from "@/components/vehicles/VehicleFilters";
import { VehicleGrid } from "@/components/vehicles/VehicleGrid";
import { Button } from "@/components/ui/button";
import { ScheduleWarningBanner } from "@/components/booking/ScheduleWarningBanner";

import { useEmployeeVehicles } from "@/hooks/useEmployeeVehicles";
import { useEmployeeCustomerBookingLimits } from "@/hooks/useEmployeeCustomerBookingLimits";
import { useBranchSchedule } from "@/hooks/useBranchSchedule";
import { useBookingScheduleVerdict } from "@/hooks/useBookingScheduleVerdict";
import type { VehicleFilters as VehicleFiltersType } from "@/services/vehicle.service";
import { useQuery } from "@tanstack/react-query";
import { employeeService } from "@/services/employee.service";

import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import { customerSession } from "@/utils/customerSession";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";

const ITEMS_PER_PAGE = 9;

export default function EmployeeVehicleListingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user: employeeUser } = useEmployeeAuthStore();
  const canBypassSchedule = employeeUser?.role === "ADMIN" || employeeUser?.role === "MANAGER";
  const [bypassSchedule, setBypassSchedule] = useState(false);

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
    storeStartTime || getCurrentTime(),
  );
  const [returnTime, setReturnTime] = useState<string>(storeEndTime || getCurrentTime());
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

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["employee-vehicle-categories"],
    queryFn: () => employeeService.getVehicleCategories(),
    staleTime: 2 * 60 * 1000,
  });

  const handleReset = useCallback(() => {
    const today = new Date();
    setSelectedPickupDate(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setSelectedReturnDate(tomorrow);
    setPickupTime(getCurrentTime());
    setReturnTime(getCurrentTime());
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

  const customerPublicId = customerSession.get()?.publicId;

  const {
    restrictedTypeClasses,
    conflictDetails,
    isLoading: limitsLoading,
  } = useEmployeeCustomerBookingLimits(customerPublicId, startDateTime, endDateTime);

  const restrictionBannerLabel = useMemo(() => {
    const labels: string[] = [];
    if (restrictedTypeClasses.has("TWO_WHEELER")) labels.push("two-wheeler");
    if (restrictedTypeClasses.has("FOUR_WHEELER")) labels.push("four-wheeler");
    return labels;
  }, [restrictedTypeClasses]);

  const { schedule } = useBranchSchedule(employeeUser?.branchPublicId ?? undefined);
  const { verdict: scheduleVerdict, adjustedEndDateTime } =
    useBookingScheduleVerdict(
      bypassSchedule ? undefined : schedule,
      startDateTime,
      endDateTime,
    );

  // Write-back: persist bumped return to local state + store
  useEffect(() => {
    if (!adjustedEndDateTime || scheduleVerdict?.status !== "RETURN_BUMPED") return;
    const adjusted = new Date(adjustedEndDateTime);
    if (isNaN(adjusted.getTime())) return;
    setSelectedReturnDate(new Date(adjusted.getFullYear(), adjusted.getMonth(), adjusted.getDate()));
    const hh = String(adjusted.getHours()).padStart(2, "0");
    const mm = String(adjusted.getMinutes()).padStart(2, "0");
    setReturnTime(`${hh}:${mm}`);
  }, [adjustedEndDateTime, scheduleVerdict?.status]);

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
            categories={categories}
            categoriesLoading={categoriesLoading}
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
            schedule={bypassSchedule ? undefined : schedule}
            scheduleVerdict={bypassSchedule ? null : scheduleVerdict}
          />
        </div>

        {/* Schedule bypass toggle for ADMIN / MANAGER */}
        {canBypassSchedule && (
          <div className="mb-4 flex items-center gap-3 px-1">
            <button
              type="button"
              onClick={() => setBypassSchedule((v) => !v)}
              className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border transition-all ${
                bypassSchedule
                  ? "bg-amber-100 border-amber-400 text-amber-800"
                  : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300"
              }`}
            >
              <ShieldOff className="size-4 shrink-0" />
              {bypassSchedule ? "Schedule bypass ON" : "Bypass schedule check"}
            </button>
            {bypassSchedule && (
              <span className="text-xs text-amber-600 font-medium">
                Branch operating hour restrictions are disabled for this booking
              </span>
            )}
          </div>
        )}

        {/* Schedule warning banner */}
        {!bypassSchedule && scheduleVerdict && scheduleVerdict.status !== "OK" && (
          <div className="mb-6">
            <ScheduleWarningBanner verdict={scheduleVerdict} />
          </div>
        )}

        {/* Booking restriction banner */}
        {restrictionBannerLabel.length > 0 && startDateTime && endDateTime && (
          <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-5 py-4 text-amber-800">
            <Lock className="size-5 shrink-0 mt-0.5 text-amber-600" strokeWidth={2.2} />
            <div>
              <p className="font-bold text-sm text-amber-900">
                Customer has an active {restrictionBannerLabel.join(" and ")} booking
              </p>
              <p className="text-sm mt-0.5 text-amber-700">
                Vehicles of the same type are blocked for these dates.{" "}
                {Object.values(conflictDetails).map((slot, i) => (
                  <span key={i} className="block mt-1 text-xs font-medium text-amber-600">
                    {slot.vehicleMake} {slot.vehicleModel} · until{" "}
                    {new Date(slot.endAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                ))}
              </p>
            </div>
          </div>
        )}

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
          restrictedTypeClasses={restrictedTypeClasses}
          limitsLoading={limitsLoading}
        />
      </main>
    </div>
  );
}
