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
import { cn } from "@/lib/utils";
import { useVehicleGroupDetails } from "@/hooks/useVehicleGroupDetails";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { useSearchStore } from "@/store/search.store";
import { useAuthStore } from "@/store/auth.store";

export const VehicleGroupDetailsPage = () => {
  const { groupKey: encodedGroupKey } = useParams<{ groupKey: string }>();
  const groupKey = decodeURIComponent(encodedGroupKey ?? "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const searchPickupDate = useSearchStore((state) => state.pickupDate);
  const searchReturnDate = useSearchStore((state) => state.returnDate);

  const { isAuthenticated } = useAuthStore();

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
    setGroupKey,
    setVehicleFullDetails,
    setDeposit,
    setAdvancePayAmount,
    setApiPricingDetails,
    paymentFlow,
  } = useVehicleRentalStore();

  const pickupDate = getStartDate();
  const returnDate = getEndDate();

  const urlStart = searchParams.get("start");
  const urlEnd   = searchParams.get("end");

  useEffect(() => {
    if (urlStart) {
      const datePart = urlStart.split("T")[0];
      const timePart = urlStart.split("T")[1] || "10:00";
      const dateObj = new Date(datePart!);
      if (!isNaN(dateObj.getTime())) { setStartDate(dateObj); setStartTime(timePart); }
    } else if (searchPickupDate) {
      setStartDate(searchPickupDate);
    } else if (!pickupDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setStartDate(today);
    }

    if (urlEnd) {
      const datePart = urlEnd.split("T")[0];
      const timePart = urlEnd.split("T")[1] || "10:00";
      const dateObj = new Date(datePart!);
      if (!isNaN(dateObj.getTime())) { setEndDate(dateObj); setEndTime(timePart); }
    } else if (searchReturnDate) {
      setEndDate(searchReturnDate);
    } else if (!returnDate) {
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      setEndDate(tomorrow);
    }
  }, []); // mount only

  const startDateTime = startDate && startTime ? `${startDate}T${startTime}` : null;
  const endDateTime   = endDate   && endTime   ? `${endDate}T${endTime}`     : null;

  const { data, isLoading, isError, isFetching } = useVehicleGroupDetails(
    groupKey,
    startDateTime,
    endDateTime,
  );

  const group = data?.data;

  // Sync pricing to store when data changes
  useEffect(() => {
    if (group?.pricing?.daily) setPricePerDay(group.pricing.daily);
    if (group?.deposit !== undefined) setDeposit(group.deposit ?? 0);
    if (group?.advancePayAmount !== undefined) setAdvancePayAmount(group.advancePayAmount ?? 0);
    if (group?.pricingDetails) {
      setApiPricingDetails({
        basePrice:               group.pricingDetails.basePrice               ?? 0,
        durationDiscountAmount:  group.pricingDetails.discountAmount          ?? 0,
        durationDiscountPercent: group.pricingDetails.discountPercent         ?? 0,
        taxAmount:               group.pricingDetails.taxAmount               ?? 0,
        finalTotal:              group.pricingDetails.finalTotal              ?? 0,
      });
    }
  }, [
    group?.pricing?.daily,
    group?.deposit,
    group?.advancePayAmount,
    group?.pricingDetails,
    setPricePerDay,
    setDeposit,
    setAdvancePayAmount,
    setApiPricingDetails,
  ]);

  const handleBookVehicle = useCallback(() => {
    if (!groupKey || !group) return;

    // Capture raw date strings before clearVehicleSelection wipes them
    const savedStartDate = startDate;
    const savedEndDate   = endDate;

    // Capture payment plan before clearVehicleSelection resets it to defaults
    const savedPaymentFlow    = useVehicleRentalStore.getState().paymentFlow;
    const savedAdvanceAmount  = useVehicleRentalStore.getState().advancePayAmount;

    useVehicleRentalStore.getState().clearVehicleSelection();

    // Store the group key instead of a specific vehicle ID
    setGroupKey(groupKey);

    setVehicleFullDetails({
      name:     `${group.make} ${group.model}`,
      model:    group.model,
      make:     group.make,
      images:   group.images,
      category: group.category,
      branch:   group.branch,
    });

    // Restore dates and payment plan (clearVehicleSelection wiped them)
    if (savedStartDate) setStartDate(new Date(savedStartDate));
    if (savedEndDate)   setEndDate(new Date(savedEndDate));
    useVehicleRentalStore.getState().setPaymentFlow(savedPaymentFlow);
    useVehicleRentalStore.getState().setAdvancePayAmount(savedAdvanceAmount);

    setPricePerDay(group.pricing?.daily || 0);
    setDeposit(group.deposit || 0);
    if (group.pricingDetails) {
      setApiPricingDetails({
        basePrice:               group.pricingDetails.basePrice               ?? 0,
        durationDiscountAmount:  group.pricingDetails.discountAmount          ?? 0,
        durationDiscountPercent: group.pricingDetails.discountPercent         ?? 0,
        taxAmount:               group.pricingDetails.taxAmount               ?? 0,
        finalTotal:              group.pricingDetails.finalTotal              ?? 0,
      });
    }

    if (!isAuthenticated) {
      useAuthStore.getState().setBookingIntent();
      navigate("/auth/sign-in");
      return;
    }

    navigate("/booking/review-confirm");
  }, [
    groupKey,
    group,
    isAuthenticated,
    paymentFlow,
    startDate,
    endDate,
    setGroupKey,
    setVehicleFullDetails,
    setStartDate,
    setEndDate,
    setPricePerDay,
    setDeposit,
    setApiPricingDetails,
    navigate,
  ]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Navbar />
        <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8 mt-24 min-h-[80vh]">
          <div className="flex items-center gap-2 mb-8">
            <Skeleton className="h-4 w-12 bg-zinc-100" />
            <Skeleton className="h-4 w-4 bg-white/5" />
            <Skeleton className="h-4 w-16 bg-zinc-100" />
            <Skeleton className="h-4 w-4 bg-white/5" />
            <Skeleton className="h-4 w-24 bg-zinc-100" />
          </div>
          <div className="mb-8 md:mb-10">
            <Skeleton className="h-10 w-64 md:h-12 md:w-96 bg-zinc-100 rounded-xl mb-3" />
            <Skeleton className="h-5 w-40 bg-white/5" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">
              <Skeleton className="w-full aspect-video rounded-[2rem] bg-zinc-100 border border-zinc-200" />
              <div className="grid grid-cols-4 gap-3 md:gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-2xl bg-white/5" />
                ))}
              </div>
            </div>
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

  if (isError || !group) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Navbar />
        <main className="flex-1 flex items-center justify-center mt-24">
          <div className="text-center space-y-6 max-w-md mx-auto p-8 rounded-[2rem] bg-white border border-zinc-200">
            <h2 className="text-3xl font-serif font-black text-zinc-900">Vehicles Not Found</h2>
            <p className="text-zinc-500 font-medium">
              No vehicles are currently available for this type. Please browse other options.
            </p>
            <Link
              to="/vehicles"
              className="inline-block px-8 py-4 bg-white hover:bg-zinc-200 text-zinc-950 font-bold tracking-wide rounded-full transition-all hover:scale-105 active:scale-95 shadow-sm"
            >
              Browse Vehicles
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const vehicleName = `${group.make} ${group.model}`;

  // Shape the group data into the format VehiclePricingCard expects
  const vehicleForPricingCard = {
    publicId:         groupKey,
    make:             group.make,
    model:            group.model,
    status:           (group.availability ? "AVAILABLE" : "NOT_AVAILABLE") as any,
    availability:     group.availability,
    category:         group.category,
    branch:           group.branch,
    images:           group.images,
    pricing:          { daily: group.pricing.daily ?? 0 },
    deposit:          group.deposit,
    advancePayAmount: group.advancePayAmount,
    pricingDetails:   group.pricingDetails,
    fastagNumber:     undefined,
    hasFastag:        false,
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 scroll-smooth">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8 mt-24 min-h-[80vh]">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-8">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/" className="text-zinc-500 hover:text-zinc-900 transition-colors">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-zinc-700" />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/vehicles" className="text-zinc-500 hover:text-zinc-900 transition-colors">Vehicles</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-zinc-700" />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-zinc-900 font-medium">{vehicleName}</BreadcrumbPage>
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
                {group.category}
              </span>
              <span
                className={cn(
                  "px-4 py-1.5 text-xs font-black tracking-[0.2em] rounded-full uppercase border",
                  group.availableCount > 0
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : "bg-red-500/10 text-red-500 border-red-500/20",
                )}
              >
                {group.availableCount > 0
                  ? `${group.availableCount} Available`
                  : "Not Available"}
              </span>
            </div>
          </div>
          <p className="text-sm font-bold tracking-wider text-zinc-500 uppercase flex items-center gap-2">
            <span className="size-2 rounded-full bg-orange-500 shrink-0" />
            {group.branch}
          </p>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          <div className="lg:col-span-7 xl:col-span-8">
            <VehicleImageGallery images={group.images} vehicleName={vehicleName} />
          </div>
          <div className="lg:col-span-5 xl:col-span-4">
            <div className="lg:sticky lg:top-28">
              <VehiclePricingCard
                vehicle={vehicleForPricingCard as any}
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

export default VehicleGroupDetailsPage;
