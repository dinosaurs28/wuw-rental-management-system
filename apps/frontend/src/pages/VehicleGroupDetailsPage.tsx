import { useCallback, useEffect, useState } from "react";
import {
  useParams,
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Car } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { VehicleBookingPanel } from "@/components/vehicles/VehicleBookingPanel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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

  const [activeImage, setActiveImage] = useState(0);

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
  const images = group.images ?? [];
  const mainImage = images[activeImage] ?? images[0];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 scroll-smooth">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8 mt-24 min-h-[80vh]">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-6">
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

        {/* Two-panel card: dark image hero (left) + booking panel (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-xl lg:min-h-[620px]">
          {/* Left: dark image panel */}
          <div className="relative flex flex-col bg-gradient-to-br from-zinc-800 via-zinc-900 to-black p-6 lg:p-10">
            {/* Title */}
            <div className="relative z-10">
              <h1 className="text-3xl lg:text-4xl xl:text-5xl font-serif font-black uppercase tracking-tight text-white">
                {vehicleName}
              </h1>
              <p className="mt-2 text-sm font-medium uppercase tracking-wider text-white/60">
                {group.category}
              </p>
            </div>

            {/* Image */}
            <div className="relative z-10 my-8 flex flex-1 items-center justify-center">
              {mainImage ? (
                <img
                  src={mainImage}
                  alt={vehicleName}
                  className="max-h-[320px] w-full object-contain drop-shadow-2xl"
                />
              ) : (
                <Car className="size-24 text-white/20" />
              )}
            </div>

            {/* Thumbnails */}
            {images.length > 1 && (
              <div className="relative z-10 mb-6 flex flex-wrap gap-3">
                {images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    className={`size-16 shrink-0 overflow-hidden rounded-xl border-2 bg-white/5 p-1 transition-all ${
                      i === activeImage
                        ? "border-[#FF5F00]"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    <img src={img} alt={`${vehicleName} ${i + 1}`} className="size-full object-contain" />
                  </button>
                ))}
              </div>
            )}

            {/* Facts row — only real data */}
            <div className="relative z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/10 pt-5 text-sm font-medium text-white/70">
              <span className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[#FF5F00]" />
                {group.category}
              </span>
              <span className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-white/30" />
                {group.branch}
              </span>
              <span
                className={
                  group.availableCount > 0 ? "text-emerald-400" : "text-red-400"
                }
              >
                {group.availableCount > 0
                  ? `${group.availableCount} available`
                  : "Not available"}
              </span>
            </div>
          </div>

          {/* Right: booking panel */}
          <VehicleBookingPanel
            group={group}
            onBookVehicle={handleBookVehicle}
            isRefetching={isFetching}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default VehicleGroupDetailsPage;
