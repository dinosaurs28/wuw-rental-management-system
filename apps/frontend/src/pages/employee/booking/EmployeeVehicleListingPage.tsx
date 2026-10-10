import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Lock, CalendarRange, Car, Loader2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { getCurrentTime } from "@/utils/formatters";
import { cn } from "@/lib/utils";
import {
  MONTHLY_MIN_DAYS,
  MONTHLY_MAX_DAYS,
  MAX_BOOKING_DAYS,
  snapPickupPastClosedToday,
} from "@/utils/bookingPickers";

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
import { employeeService, type RegNoVehicle } from "@/services/employee.service";
import { useDebounce } from "@/hooks/useDebounce";

import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import { customerSession } from "@/utils/customerSession";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";

const ITEMS_PER_PAGE = 9;

/** Letters and digits of a typed registration number (the server ignores the rest). */
const regSearchTerm = (q: string) => q.replace(/[^a-z0-9]/gi, "");

export default function EmployeeVehicleListingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user: employeeUser } = useEmployeeAuthStore();

  const {
    setDates,
    setStartTime,
    setEndTime,
    startDate: storeStart,
    endDate: storeEnd,
    startTime: storeStartTime,
    endTime: storeEndTime,
    plan,
    setPlan,
  } = useEmployeeBookingStore();
  const isMonthly = plan === "MONTHLY";

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
  // Model = the grouped cards; Reg. no = single cars by registration number (client item 5)
  const [searchMode, setSearchMode] = useState<"model" | "reg">("model");
  const regMode = searchMode === "reg";
  const [regQuery, setRegQuery] = useState<string>("");

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

  // Build datetime strings and validate range before the query hook
  const startDateTime = selectedPickupDate
    ? `${format(selectedPickupDate, "yyyy-MM-dd")}T${pickupTime}`
    : undefined;
  const endDateTime = selectedReturnDate
    ? `${format(selectedReturnDate, "yyyy-MM-dd")}T${returnTime}`
    : undefined;
  const isDateRangeValid = useMemo(() => {
    if (!startDateTime || !endDateTime) return true;
    return new Date(endDateTime) > new Date(startDateTime);
  }, [startDateTime, endDateTime]);

  const {
    data: vehiclesData,
    isLoading: initialLoading,
    isFetching,
  } = useEmployeeVehicles(filters, { enabled: isDateRangeValid && !regMode });
  const isLoading = initialLoading || isFetching;
  const vehicles = vehiclesData?.data || [];
  const vehicleCount = vehiclesData?.pagination?.total || vehicles.length || 0;

  // A page past the end (the list shrank after a date or filter change): back
  // to page 1 so every card stays reachable
  useEffect(() => {
    if (!isLoading && vehicleCount > 0 && currentPage > Math.ceil(vehicleCount / ITEMS_PER_PAGE)) {
      setCurrentPage(1);
    }
  }, [isLoading, vehicleCount, currentPage]);

  // Reg. no search: one row per matching car, priced for the dates
  const regTerm = useDebounce(regSearchTerm(regQuery), 300);
  const regSearch = useQuery({
    queryKey: ["employee-reg-search", regTerm, startDateTime, endDateTime],
    queryFn: () =>
      employeeService.searchVehiclesByRegNo({ q: regTerm, start: startDateTime!, end: endDateTime! }),
    enabled: regMode && regTerm.length >= 2 && !!startDateTime && !!endDateTime && isDateRangeValid,
    staleTime: 15 * 1000,
  });
  const regResults: RegNoVehicle[] = regSearch.data?.data ?? [];

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
    setPlan("STANDARD");
    setCategory("all");
    setSortBy("default");
    setSearchQuery("");
    setRegQuery("");
    setCurrentPage(1);
  }, [setPlan]);

  // startDateTime / endDateTime / isDateRangeValid declared above useEmployeeVehicles

  // Show a single toast when the range becomes invalid
  const prevInvalidRef = useRef(false);
  useEffect(() => {
    const bothSet = !!(selectedPickupDate && selectedReturnDate);
    if (!isDateRangeValid && bothSet && !prevInvalidRef.current) {
      toast.error("Return date/time must be after pickup date/time");
      prevInvalidRef.current = true;
    } else if (isDateRangeValid) {
      prevInvalidRef.current = false;
    }
  }, [isDateRangeValid, selectedPickupDate, selectedReturnDate]);

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

  // Office hours always apply to Fleet walk-ins (there is no bypass)
  const { schedule } = useBranchSchedule(employeeUser?.branchPublicId ?? undefined);
  const { verdict: scheduleVerdict, adjustedEndDateTime } =
    useBookingScheduleVerdict(schedule, startDateTime, endDateTime, { monthly: isMonthly });

  // No pickup slot left today (closed, or e.g. 21:50 with a 22:00 close): start
  // the range at the next opening (only when the hours load — never fights a pick)
  useEffect(() => {
    const snap = snapPickupPastClosedToday({
      schedule,
      pickupDate: selectedPickupDate,
      returnDate: selectedReturnDate,
      returnTime,
    });
    if (!snap) return;
    setSelectedPickupDate(snap.pickupDate);
    setPickupTime(snap.pickupTime);
    // Monthly plan: keep at least 30 days (the return moves with the pickup)
    const monthlyMin = addDays(snap.pickupDate, MONTHLY_MIN_DAYS);
    const r = snap.returnDate;
    if (isMonthly && new Date(r.getFullYear(), r.getMonth(), r.getDate()) <= monthlyMin) {
      setSelectedReturnDate(monthlyMin);
      setReturnTime(snap.pickupTime);
      return;
    }
    setSelectedReturnDate(snap.returnDate);
    setReturnTime(snap.returnTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  // Monthly rental (#15/#17): 30–180 days. Switching plans moves the return to
  // a length the plan allows (pickup + 30 days / pickup + 1 day), same time.
  const handlePlanChange = (next: "STANDARD" | "MONTHLY") => {
    if (next === plan) return;
    setPlan(next);
    if (!selectedPickupDate) return;
    if (next === "MONTHLY") {
      setSelectedReturnDate(addDays(selectedPickupDate, MONTHLY_MIN_DAYS));
      setReturnTime(pickupTime);
    } else if (selectedReturnDate && selectedReturnDate > addDays(selectedPickupDate, MAX_BOOKING_DAYS)) {
      setSelectedReturnDate(addDays(selectedPickupDate, 1));
      setReturnTime(pickupTime);
    }
  };

  // Write-back: persist bumped return to local state + store. Monthly plan only —
  // the standard plan's package selector offers in-hours returns only (and
  // keeps the extra hours, which a bump to pickup + k days would drop).
  useEffect(() => {
    if (!isMonthly || !adjustedEndDateTime || scheduleVerdict?.status !== "RETURN_BUMPED") return;
    const adjusted = new Date(adjustedEndDateTime);
    if (isNaN(adjusted.getTime())) return;
    setSelectedReturnDate(new Date(adjusted.getFullYear(), adjusted.getMonth(), adjusted.getDate()));
    const hh = String(adjusted.getHours()).padStart(2, "0");
    const mm = String(adjusted.getMinutes()).padStart(2, "0");
    setReturnTime(`${hh}:${mm}`);
  }, [adjustedEndDateTime, scheduleVerdict?.status, isMonthly]);

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
        {/* Rental plan: standard (up to 15 days) or monthly (30–180 days) */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div role="radiogroup" aria-label="Rental plan" className="inline-flex rounded-full border border-zinc-200 bg-white p-1">
            {([
              { value: "STANDARD", label: `Standard (up to ${MAX_BOOKING_DAYS} days)` },
              { value: "MONTHLY", label: "Monthly rental" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={plan === opt.value}
                onClick={() => handlePlanChange(opt.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  plan === opt.value ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900",
                )}
              >
                {opt.value === "MONTHLY" && <CalendarRange className="size-4" />}
                {opt.label}
              </button>
            ))}
          </div>
          {isMonthly && (
            <p className="text-xs text-zinc-500">
              {MONTHLY_MIN_DAYS} to {MONTHLY_MAX_DAYS} days, pickup within the next {MAX_BOOKING_DAYS} days.
              Priced on the monthly rate.
            </p>
          )}
        </div>

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
            onBranchChange={() => {}}
            onPickupDateChange={(date) => {
              setSelectedPickupDate(date ?? null);
              if (date && isMonthly) {
                // Monthly: keep at least 30 days between pickup and return
                if (!selectedReturnDate || selectedReturnDate < addDays(date, MONTHLY_MIN_DAYS)) {
                  setSelectedReturnDate(addDays(date, MONTHLY_MIN_DAYS));
                }
              } else if (date && selectedReturnDate) {
                // Only push return to next day if it's strictly before the new pickup day
                const pickupDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                const returnDay = new Date(selectedReturnDate.getFullYear(), selectedReturnDate.getMonth(), selectedReturnDate.getDate());
                if (returnDay < pickupDay) {
                  const nextDay = new Date(date);
                  nextDay.setDate(nextDay.getDate() + 1);
                  setSelectedReturnDate(nextDay);
                }
              } else if (!date) {
                setSelectedReturnDate(null);
              }
            }}
            onReturnDateChange={(date) => setSelectedReturnDate(date ?? null)}
            onPickupTimeChange={setPickupTime}
            onReturnTimeChange={setReturnTime}
            onCategoryChange={setCategory}
            onSortChange={setSortBy}
            searchQuery={regMode ? regQuery : searchQuery}
            onSearchChange={regMode ? setRegQuery : setSearchQuery}
            searchPlaceholder={regMode ? "Search by registration number..." : undefined}
            searchAddon={
              <div
                role="radiogroup"
                aria-label="Search vehicles by"
                className="inline-flex h-14 shrink-0 self-start rounded-full border border-zinc-200 bg-white p-1"
              >
                {([
                  { value: "model", label: "Model" },
                  { value: "reg", label: "Reg. no" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={searchMode === opt.value}
                    onClick={() => setSearchMode(opt.value)}
                    className={cn(
                      "rounded-full px-5 text-sm font-medium transition-colors",
                      searchMode === opt.value ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            }
            onReset={handleReset}
            showBranchSelector={false}
            schedule={schedule}
            scheduleVerdict={scheduleVerdict}
            monthly={isMonthly}
            packageMode="fleet"
          />
        </div>

        {/* Schedule warning banner */}
        {scheduleVerdict && scheduleVerdict.status !== "OK" && (
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

        {regMode ? (
          <RegNoResults
            term={regSearchTerm(regQuery)}
            isLoading={regSearch.isFetching}
            isError={regSearch.isError}
            onRetry={() => void regSearch.refetch()}
            results={regResults}
            restrictedTypeClasses={restrictedTypeClasses}
            onBook={(car) => {
              // The single-vehicle page books exactly this car (vehicles: [publicId])
              const params = new URLSearchParams();
              if (startDateTime) params.set("start", startDateTime);
              if (endDateTime) params.set("end", endDateTime);
              navigate(`/employee/vehicle/${car.publicId}?${params.toString()}`);
            }}
          />
        ) : (
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
        )}
      </main>
    </div>
  );
}

/**
 * Reg. no search results (client item 5): one row per car. A car that can't be
 * booked for the dates stays listed, greyed, with the server's reason; the
 * customer's own booking limits (vehicle type) grey it out the same way.
 */
function RegNoResults({
  term,
  isLoading,
  isError,
  onRetry,
  results,
  restrictedTypeClasses,
  onBook,
}: {
  term: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  results: RegNoVehicle[];
  restrictedTypeClasses: Set<string>;
  onBook: (car: RegNoVehicle) => void;
}) {
  if (term.length < 2) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center">
        <p className="font-medium text-zinc-700">Search by registration number</p>
        <p className="mt-1 text-sm text-zinc-500">Type at least 2 letters or digits of the number.</p>
      </div>
    );
  }
  if (isLoading && results.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
        <Loader2 className="mr-2 size-5 animate-spin text-zinc-400" />
        Searching…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-12 text-center">
        <p className="font-medium text-zinc-700">Could not search vehicles</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center">
        <p className="font-medium text-zinc-700">No vehicle with that number</p>
        <p className="mt-1 text-sm text-zinc-500">Check the number, or search by model.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((car) => {
        const restricted = !!car.typeClass && restrictedTypeClasses.has(car.typeClass);
        const reason =
          car.unavailableReason?.message ??
          (restricted ? "Blocked — the customer already has a booking of this vehicle type" : null);
        const disabled = !car.available || restricted;
        const price = car.pricingDetails?.finalPrice ?? car.pricing.daily;
        return (
          <div
            key={car.publicId}
            className={cn(
              "flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center",
              disabled && "opacity-60",
            )}
          >
            {car.imageUrl ? (
              <img
                src={car.imageUrl}
                alt={`${car.make} ${car.model}`}
                className="h-16 w-24 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                <Car className="size-6 text-zinc-300" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-base font-semibold tracking-wide text-zinc-900">{car.regNo}</p>
              <p className="text-sm text-zinc-600">
                {car.make} {car.model}
                {car.year ? ` · ${car.year}` : ""} · {car.category}
              </p>
              {price != null && (
                <p className="mt-0.5 text-sm font-semibold text-zinc-900">
                  ₹{Number(price).toLocaleString("en-IN")} total
                  {car.pricingDetails?.billedAs ? ` · ${car.pricingDetails.billedAs}` : ""}
                  <span className="ml-1 text-xs font-normal text-zinc-500">incl. GST</span>
                </p>
              )}
              {reason ? (
                <p className="mt-0.5 text-xs font-medium text-amber-700">{reason}</p>
              ) : (
                <p className="mt-0.5 text-xs font-medium text-emerald-700">Available for these dates</p>
              )}
            </div>
            <Button className="shrink-0" disabled={disabled} onClick={() => onBook(car)}>
              Book this car
            </Button>
          </div>
        );
      })}
    </div>
  );
}
