import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { VehicleFilters } from "@/components/vehicles/VehicleFilters";
import { VehicleGrid } from "@/components/vehicles/VehicleGrid";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBranches } from "@/hooks/useBranches";
import { useVehicles } from "@/hooks/useVehicles";
import { usePublicVehicleCategories } from "@/hooks/usePublicVehicleCategories";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearchStore } from "@/store/search.store";
import { useCustomerBookingLimits } from "@/hooks/useCustomerBookingLimits";
import { useBranchSchedule } from "@/hooks/useBranchSchedule";
import { useBookingScheduleVerdict } from "@/hooks/useBookingScheduleVerdict";
import type { VehicleFilters as VehicleFiltersType } from "@/services/vehicle.service";
import { Lock } from "lucide-react";

const ITEMS_PER_PAGE = 9; // 3x3 grid

export const VehiclesPage = () => {
  // State from landing page (if coming from search)
  const {
    branchPublicId,
    categoryPublicId,
    pickupDate,
    returnDate,
    pickupTime: storePickupTime,
    returnTime: storeReturnTime,
    setSearchCriteria,
    resetSearch,
  } = useSearchStore();

  // Branches data
  const { data: branches = [], isLoading: branchesLoading } = useBranches();
  const { data: categories = [], isLoading: categoriesLoading } =
    usePublicVehicleCategories();

  // Local filter state
  const [selectedBranch, setSelectedBranch] = useState<string>(
    branchPublicId || "",
  );
  const [selectedPickupDate, setSelectedPickupDate] = useState<Date | null>(
    pickupDate || null,
  );
  const [selectedReturnDate, setSelectedReturnDate] = useState<Date | null>(
    returnDate || null,
  );
  const [pickupTime, setPickupTime] = useState<string>(
    storePickupTime || "10:00",
  );
  const [returnTime, setReturnTime] = useState<string>(
    storeReturnTime || "10:00",
  );
  const [category, setCategory] = useState<string>(categoryPublicId || "all");
  const [sortBy, setSortBy] = useState<string>("default");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Debounced search
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBranch, category, debouncedSearch, sortBy]);

  // Initialize state from store or set default branch
  useEffect(() => {
    if (branchPublicId && selectedBranch !== branchPublicId) {
      setSelectedBranch(branchPublicId);
    } else if (branches.length > 0 && !selectedBranch && !branchPublicId) {
      setSelectedBranch(branches[0].publicId);
      setSearchCriteria({ branchPublicId: branches[0].publicId });
    }
  }, [branchPublicId, branches, selectedBranch, setSearchCriteria]);

  // Sync dates from store and handle default return date
  useEffect(() => {
    setSelectedPickupDate(pickupDate);
    setSelectedReturnDate(returnDate);

    // If pickup date exists but return date is missing on load/store update, default to next day
    if (pickupDate && !returnDate) {
      const nextDay = new Date(pickupDate);
      nextDay.setDate(nextDay.getDate() + 1);
      setSelectedReturnDate(nextDay);
      setSearchCriteria({ returnDate: nextDay });
    }
  }, [pickupDate, returnDate, setSearchCriteria]);

  useEffect(() => {
    setCategory(categoryPublicId || "all");
  }, [categoryPublicId]);

  // Build filters for API with pagination
  const filters: VehicleFiltersType = useMemo(() => {
    const f: VehicleFiltersType = {};

    if (selectedBranch) f.branch = selectedBranch;
    if (category && category !== "all") f.category = category;
    if (debouncedSearch) f.search = debouncedSearch;
    if (sortBy && sortBy !== "default")
      f.sort = sortBy as "price_low_to_high" | "price_high_to_low";

    // Add datetimes for availability and pricing calculation
    if (selectedPickupDate) {
      const year = selectedPickupDate.getFullYear();
      const month = String(selectedPickupDate.getMonth() + 1).padStart(2, "0");
      const day = String(selectedPickupDate.getDate()).padStart(2, "0");
      f.start = `${year}-${month}-${day}T${pickupTime}`;
    }
    if (selectedReturnDate) {
      const year = selectedReturnDate.getFullYear();
      const month = String(selectedReturnDate.getMonth() + 1).padStart(2, "0");
      const day = String(selectedReturnDate.getDate()).padStart(2, "0");
      f.end = `${year}-${month}-${day}T${returnTime}`;
    }

    f.limit = ITEMS_PER_PAGE;
    f.offset = (currentPage - 1) * ITEMS_PER_PAGE;

    return f;
  }, [
    selectedBranch,
    category,
    debouncedSearch,
    sortBy,
    selectedPickupDate,
    selectedReturnDate,
    pickupTime,
    returnTime,
    currentPage,
  ]);

  // Fetch vehicles - Only when branch is selected
  const { data: vehiclesData, isLoading: vehiclesLoading } = useVehicles(
    filters,
    { enabled: !!selectedBranch },
  );

  const vehicles = vehiclesData?.data || [];
  const vehicleCount = vehiclesData?.count || 0;

  // Handlers
  const handleBranchChange = useCallback(
    (branch: string) => {
      setSelectedBranch(branch);
      setSearchCriteria({ branchPublicId: branch });
    },
    [setSearchCriteria],
  );

  const handlePickupDateChange = useCallback(
    (date: Date | undefined) => {
      const nextDay = date ? new Date(date) : null;
      if (nextDay) {
        nextDay.setDate(nextDay.getDate() + 1);
      }

      setSelectedPickupDate(date || null);

      // If we have a valid date and no return date (or return date is before pickup date), set next day
      // Also update store in one go if possible, or sequentially but ensuring local state is consistent
      if (date && (!selectedReturnDate || selectedReturnDate <= date)) {
        setSelectedReturnDate(nextDay);
        setSearchCriteria({
          pickupDate: date,
          returnDate: nextDay,
        });
      } else {
        setSearchCriteria({ pickupDate: date || null });
      }
    },
    [selectedReturnDate, setSearchCriteria],
  );

  const handleReturnDateChange = useCallback(
    (date: Date | undefined) => {
      setSelectedReturnDate(date || null);
      setSearchCriteria({ returnDate: date || null });
    },
    [setSearchCriteria],
  );

  const handlePickupTimeChange = useCallback(
    (time: string) => {
      setPickupTime(time);
      setSearchCriteria({ pickupTime: time });
    },
    [setSearchCriteria],
  );

  const handleReturnTimeChange = useCallback(
    (time: string) => {
      setReturnTime(time);
      setSearchCriteria({ returnTime: time });
    },
    [setSearchCriteria],
  );

  const handleCategoryChange = useCallback((cat: string) => {
    setCategory(cat);
    setSearchCriteria({ categoryPublicId: cat });
  }, [setSearchCriteria]);

  const handleSortChange = useCallback((sort: string) => {
    setSortBy(sort);
  }, []);

  const handleSearchChange = useCallback((search: string) => {
    setSearchQuery(search);
  }, []);

  const handleReset = useCallback(() => {
    const defaultBranch = branches.length > 0 ? branches[0].publicId : "";
    setSelectedBranch(defaultBranch);
    setSelectedPickupDate(null);
    setSelectedReturnDate(null);
    setPickupTime("10:00");
    setReturnTime("10:00");
    setCategory("all");
    setSortBy("default");
    setSearchQuery("");
    setCurrentPage(1);
    resetSearch();
    if (defaultBranch) {
      setSearchCriteria({ branchPublicId: defaultBranch, categoryPublicId: "all" });
    }
  }, [branches, resetSearch, setSearchCriteria]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Build datetime strings for passing to VehicleGrid cards
  const startDateTime = selectedPickupDate
    ? (() => {
        const year = selectedPickupDate.getFullYear();
        const month = String(selectedPickupDate.getMonth() + 1).padStart(
          2,
          "0",
        );
        const day = String(selectedPickupDate.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}T${pickupTime}`;
      })()
    : undefined;
  const endDateTime = selectedReturnDate
    ? (() => {
        const year = selectedReturnDate.getFullYear();
        const month = String(selectedReturnDate.getMonth() + 1).padStart(
          2,
          "0",
        );
        const day = String(selectedReturnDate.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}T${returnTime}`;
      })()
    : undefined;

  // Booking type-class limits — declared after startDateTime/endDateTime so the hook
  // receives the correct values on first render (avoids temporal dead zone access)
  const {
    restrictedTypeClasses,
    conflictDetails,
    isLoading: limitsLoading,
  } = useCustomerBookingLimits(startDateTime, endDateTime);

  const restrictionBannerLabel = useMemo(() => {
    const labels: string[] = [];
    if (restrictedTypeClasses.has("TWO_WHEELER")) labels.push("two-wheeler");
    if (restrictedTypeClasses.has("FOUR_WHEELER")) labels.push("four-wheeler");
    return labels;
  }, [restrictedTypeClasses]);

  // Branch schedule — used for hours badge and schedule conflict warnings
  const { schedule } = useBranchSchedule(selectedBranch || undefined);
  const { verdict: scheduleVerdict, adjustedEndDateTime } =
    useBookingScheduleVerdict(schedule, startDateTime, endDateTime);

  // Write-back: when return is bumped, persist the adjusted date/time to local state + store
  useEffect(() => {
    if (!adjustedEndDateTime || scheduleVerdict?.status !== "RETURN_BUMPED") return;
    const adjusted = new Date(adjustedEndDateTime);
    if (isNaN(adjusted.getTime())) return;
    const newDate = new Date(adjusted.getFullYear(), adjusted.getMonth(), adjusted.getDate());
    const hh = String(adjusted.getHours()).padStart(2, "0");
    const mm = String(adjusted.getMinutes()).padStart(2, "0");
    const newTime = `${hh}:${mm}`;
    setSelectedReturnDate(newDate);
    setReturnTime(newTime);
    setSearchCriteria({ returnDate: newDate, returnTime: newTime });
  }, [adjustedEndDateTime, scheduleVerdict?.status, setSearchCriteria]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 scroll-smooth">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8 mt-24">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  to="/"
                  className="text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  Home
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Vehicles</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-5xl font-black text-black tracking-tight uppercase">
              Select Your Vehicle
            </h1>
            <p className="text-gray-500 font-bold mt-2 uppercase tracking-wide text-sm">
              Premium fleet at your disposal
            </p>
          </div>
          <div className="text-xs font-black text-white tracking-widest uppercase bg-[#1A1A1A] px-5 py-3 rounded-none shadow-md">
            <span className="text-[#FF5F00] text-lg mr-2">{vehicleCount}</span>
            Results
          </div>
        </div>

        {/* Booking restriction banner */}
        {restrictionBannerLabel.length > 0 && startDateTime && endDateTime && (
          <div className="mb-6 flex items-start gap-3 bg-amber-950/60 border border-amber-800/60 rounded-xl px-5 py-4 text-amber-300">
            <Lock className="size-5 shrink-0 mt-0.5" strokeWidth={2.2} />
            <div>
              <p className="font-bold text-sm uppercase tracking-wide text-amber-200">
                Booking limit reached
              </p>
              <p className="text-sm mt-0.5 text-amber-300/90">
                You already have an active{" "}
                <span className="font-semibold text-amber-100">
                  {restrictionBannerLabel.join(" and ")}
                </span>{" "}
                booking during these dates. Only one per type is allowed.{" "}
                {Object.values(conflictDetails).map((slot, i) => (
                  <span key={i} className="block mt-1 text-amber-400/80 text-xs font-medium">
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

        {/* Filters */}
        <div className="mb-6">
          <VehicleFilters
            branches={branches}
            branchesLoading={branchesLoading}
            categories={categories}
            categoriesLoading={categoriesLoading}
            selectedBranch={selectedBranch}
            pickupDate={selectedPickupDate}
            returnDate={selectedReturnDate}
            category={category}
            sortBy={sortBy}
            searchQuery={searchQuery}
            onBranchChange={handleBranchChange}
            onPickupDateChange={handlePickupDateChange}
            onReturnDateChange={handleReturnDateChange}
            onCategoryChange={handleCategoryChange}
            onSortChange={handleSortChange}
            onSearchChange={handleSearchChange}
            onReset={handleReset}
            pickupTime={pickupTime}
            returnTime={returnTime}
            onPickupTimeChange={handlePickupTimeChange}
            onReturnTimeChange={handleReturnTimeChange}
            schedule={schedule}
            scheduleVerdict={scheduleVerdict}
          />
        </div>

        {/* Vehicle Grid with Pagination */}
        <VehicleGrid
          vehicles={vehicles}
          isLoading={vehiclesLoading || branchesLoading}
          onReset={handleReset}
          currentPage={currentPage}
          totalCount={vehicleCount}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={handlePageChange}
          startDateTime={startDateTime}
          endDateTime={endDateTime}
          variant="dark"
          restrictedTypeClasses={restrictedTypeClasses}
          limitsLoading={limitsLoading}
        />
      </main>

      <Footer />
    </div>
  );
};

export default VehiclesPage;
