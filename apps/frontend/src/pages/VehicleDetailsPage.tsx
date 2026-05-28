import { useCallback, useEffect } from "react";
import {
  useParams,
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { VehicleImageGallery } from "@/components/vehicles/VehicleImageGallery";
import { VehiclePricingCard } from "@/components/vehicles/VehiclePricingCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useVehicleDetails } from "@/hooks/useVehicleDetails";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { useSearchStore } from "@/store/search.store";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/lib/utils";

export const VehicleDetailsPage = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Get dates from search store (set on listing page)
  const searchPickupDate = useSearchStore((state) => state.pickupDate);
  const searchReturnDate = useSearchStore((state) => state.returnDate);

  const { isAuthenticated } = useAuthStore();

  // Get dates, times and actions from vehicle rental store
  const {
    startDate,
    endDate,
    startTime,
    endTime,
    getStartDate,
    getEndDate,
    setStartDate,
    setEndDate,
    setStartTime,
    setEndTime,
    setPricePerDay,
    setVehicleId,
    setVehicleFullDetails,
    setDeposit,
    setAdvancePayAmount,
    setApiPricingDetails,
    paymentFlow,
  } = useVehicleRentalStore();

  const pickupDate = getStartDate();
  const returnDate = getEndDate();

  // Read URL params (start/end are full datetime strings like 2025-03-17T10:00)
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");

  // Sync dates from URL params or search store to rental store on mount
  useEffect(() => {
    if (urlStart) {
      // URL param has full datetime - extract date and time parts
      const datePart = urlStart.split("T")[0];
      const timePart = urlStart.split("T")[1] || "10:00";
      const dateObj = new Date(datePart);
      if (!isNaN(dateObj.getTime())) {
        setStartDate(dateObj);
        setStartTime(timePart);
      }
    } else if (searchPickupDate) {
      setStartDate(searchPickupDate);
    } else if (!pickupDate) {
      // Fallback to today if no dates exist
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setStartDate(today);
    }

    if (urlEnd) {
      // URL param has full datetime - extract date and time parts
      const datePart = urlEnd.split("T")[0];
      const timePart = urlEnd.split("T")[1] || "10:00";
      const dateObj = new Date(datePart);
      if (!isNaN(dateObj.getTime())) {
        setEndDate(dateObj);
        setEndTime(timePart);
      }
    } else if (searchReturnDate) {
      setEndDate(searchReturnDate);
    } else if (!returnDate) {
      // Fallback to tomorrow if no end date exists
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      setEndDate(tomorrow);
    }
  }, []); // Run only on mount

  // Build datetime strings from store (URL params are only used for initial store sync in useEffect above)
  const startDateTime =
    startDate && startTime ? `${startDate}T${startTime}` : null;
  const endDateTime = endDate && endTime ? `${endDate}T${endTime}` : null;

  // Fetch vehicle details - will refetch when datetime strings change
  const { data, isLoading, isError, isFetching } = useVehicleDetails(
    vehicleId || "",
    startDateTime,
    endDateTime,
  );

  const vehicle = data?.data;

  // Update pricing in store when vehicle data changes
  useEffect(() => {
    if (vehicle?.pricing?.daily) {
      setPricePerDay(vehicle.pricing.daily);
    }
    if (vehicle?.deposit !== undefined) {
      setDeposit(vehicle.deposit ?? 0);
    }
    if (vehicle?.advancePayAmount !== undefined) {
      setAdvancePayAmount(vehicle.advancePayAmount ?? 0);
    }
    // Store full API pricing details when available (dates selected)
    if (vehicle?.pricingDetails) {
      setApiPricingDetails({
        basePrice:                  vehicle.pricingDetails.basePrice               ?? 0,
        durationDiscountAmount:     vehicle.pricingDetails.discountAmount          ?? 0,
        durationDiscountPercent:    vehicle.pricingDetails.discountPercent         ?? 0,
        taxAmount:                  vehicle.pricingDetails.taxAmount               ?? 0,
        finalTotal:                 vehicle.pricingDetails.finalTotal              ?? 0,
      });
    }
  }, [
    vehicle?.pricing?.daily,
    vehicle?.deposit,
    vehicle?.advancePayAmount,
    vehicle?.pricingDetails,
    setPricePerDay,
    setDeposit,
    setAdvancePayAmount,
    setApiPricingDetails,
  ]);

  // Book vehicle handler - clears previous selection, saves new one, and navigates to review
  const handleBookVehicle = useCallback(() => {
    if (!vehicleId || !vehicle) return;

    // Get the LATEST dates from store state (not from render-time closure)
    const currentState = useVehicleRentalStore.getState();
    const currentStartDate = currentState.getStartDate();
    const currentEndDate = currentState.getEndDate();

    // Capture payment plan before clearVehicleSelection resets it to defaults
    const savedPaymentFlow   = currentState.paymentFlow;
    const savedAdvanceAmount = currentState.advancePayAmount;

    // Clear previous vehicle selection from session storage
    currentState.clearVehicleSelection();

    // Set new vehicle selection with full details
    setVehicleId(vehicleId);

    // Helper to extract string from string or object with name property
    const getCategoryName = (cat: any): string => {
      if (!cat) return "";
      return typeof cat === "string" ? cat : cat.name || "";
    };

    const getBranchName = (br: any): string => {
      if (!br) return "";
      return typeof br === "string" ? br : br.name || "";
    };

    setVehicleFullDetails({
      name: `${vehicle.make} ${vehicle.model}`,
      model: vehicle.model,
      make: vehicle.make,
      images:
        vehicle.images
          ?.map((img) => (typeof img === "string" ? img : img.file?.url))
          .filter(Boolean) || [],
      category: getCategoryName(vehicle.category),
      branch: getBranchName(vehicle.branch),
    });

    // Restore dates and payment plan (clearVehicleSelection wiped them)
    if (currentStartDate) setStartDate(currentStartDate);
    if (currentEndDate) setEndDate(currentEndDate);
    currentState.setPaymentFlow(savedPaymentFlow);
    currentState.setAdvancePayAmount(savedAdvanceAmount);

    // Set pricing
    setPricePerDay(vehicle.pricing?.daily || 0);
    setDeposit(vehicle.deposit || 0);
    if (vehicle.pricingDetails) {
      setApiPricingDetails({
        basePrice:               vehicle.pricingDetails.basePrice               ?? 0,
        durationDiscountAmount:  vehicle.pricingDetails.discountAmount          ?? 0,
        durationDiscountPercent: vehicle.pricingDetails.discountPercent         ?? 0,
        taxAmount:               vehicle.pricingDetails.taxAmount               ?? 0,
        finalTotal:              vehicle.pricingDetails.finalTotal              ?? 0,
      });
    }

    // If not authenticated, save booking intent and redirect to sign-in.
    // The vehicle rental store is already populated above and persists to
    // sessionStorage, so the state survives the sign-in redirect.
    if (!isAuthenticated) {
      useAuthStore.getState().setBookingIntent();
      navigate("/auth/sign-in");
      return;
    }

    // Navigate to review & confirm page
    navigate("/booking/review-confirm");
  }, [
    vehicleId,
    vehicle,
    isAuthenticated,
    paymentFlow,
    setVehicleId,
    setVehicleFullDetails,
    setStartDate,
    setEndDate,
    setPricePerDay,
    setDeposit,
    setApiPricingDetails,
    navigate,
  ]);

  // Loading state (initial load only)
  // Loading state (initial load only)
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Navbar />
        <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8 mt-24 min-h-[80vh]">
          {/* Breadcrumb Skeleton */}
          <div className="flex items-center gap-2 mb-8">
            <Skeleton className="h-4 w-12 bg-zinc-100" />
            <Skeleton className="h-4 w-4 bg-white/5" />
            <Skeleton className="h-4 w-16 bg-zinc-100" />
            <Skeleton className="h-4 w-4 bg-white/5" />
            <Skeleton className="h-4 w-24 bg-zinc-100" />
          </div>

          {/* Header Skeleton */}
          <div className="mb-8 md:mb-10">
            <div className="flex flex-wrap items-center gap-4 mb-3">
              <Skeleton className="h-10 w-64 md:h-12 md:w-96 bg-zinc-100 rounded-xl" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-24 rounded-full bg-white/5" />
                <Skeleton className="h-8 w-28 rounded-full bg-white/5" />
              </div>
            </div>
            <Skeleton className="h-5 w-40 bg-white/5" />
          </div>

          {/* Content Grid Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
            {/* Image Gallery Skeleton */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">
              <Skeleton className="w-full aspect-video rounded-[2rem] bg-zinc-100 border border-zinc-200" />
              <div className="grid grid-cols-4 gap-3 md:gap-4">
                <Skeleton className="aspect-square rounded-2xl bg-white/5" />
                <Skeleton className="aspect-square rounded-2xl bg-white/5" />
                <Skeleton className="aspect-square rounded-2xl bg-white/5" />
                <Skeleton className="aspect-square rounded-2xl bg-white/5" />
              </div>
            </div>

            {/* Pricing Card Skeleton */}
            <div className="lg:col-span-5 xl:col-span-4">
              <div className="lg:sticky lg:top-28">
                <Skeleton className="h-[500px] w-full rounded-[2rem] bg-zinc-100 border border-zinc-200" />
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Error state
  if (isError || !vehicle) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Navbar />
        <main className="flex-1 flex items-center justify-center mt-24">
          <div className="text-center space-y-6 max-w-md mx-auto p-8 rounded-[2rem] bg-white border border-zinc-200 text-center">
            <h2 className="text-3xl font-serif font-black text-zinc-900">
              Vehicle Not Found
            </h2>
            <p className="text-zinc-500 font-medium">
              The vehicle you're looking for doesn't exist or has been removed.
            </p>
            <Link
              to="/vehicles"
              className="inline-block px-8 py-4 bg-white hover:bg-zinc-200 text-zinc-950 font-bold tracking-wide rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            >
              Browse Vehicles
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const vehicleName = `${vehicle.make} ${vehicle.model}`;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 scroll-smooth">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8 mt-24 min-h-[80vh]">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-8">
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
            <BreadcrumbSeparator className="text-zinc-700" />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  to="/vehicles"
                  className="text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  Vehicles
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-zinc-700" />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-zinc-900 font-medium">
                Vehicle Details
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Vehicle Header */}
        <div className="mb-8 md:mb-12">
          <div className="flex flex-wrap items-center gap-4 mb-3">
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-serif font-black text-zinc-900 tracking-tight">
              {vehicleName}
            </h1>
            <div className="flex items-center gap-3">
              <span className="px-4 py-1.5 text-xs font-black tracking-[0.2em] bg-zinc-100 text-zinc-900 rounded-full uppercase border border-zinc-200">
                {typeof vehicle.category === "string"
                  ? vehicle.category
                  : vehicle.category?.name || "N/A"}
              </span>
              <span
                className={cn(
                  "px-4 py-1.5 text-xs font-black tracking-[0.2em] rounded-full uppercase border",
                  vehicle.availability
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20",
                )}
              >
                {vehicle.availability ? "Available" : "Not Available"}
              </span>
            </div>
          </div>
          <p className="text-sm font-bold tracking-wider text-zinc-500 uppercase flex items-center gap-2">
            <span className="size-2 rounded-full bg-orange-500 shrink-0" />
            {vehicle.branch}
          </p>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          {/* Left Column - Image Gallery */}
          <div className="lg:col-span-7 xl:col-span-8">
            <VehicleImageGallery
              images={vehicle.images}
              vehicleName={vehicleName}
            />
          </div>

          {/* Right Column - Pricing Card (Sticky on Desktop) */}
          <div className="lg:col-span-5 xl:col-span-4">
            <div className="lg:sticky lg:top-28">
              <VehiclePricingCard
                vehicle={vehicle}
                onBookVehicle={handleBookVehicle}
                isRefetching={isFetching}
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default VehicleDetailsPage;
