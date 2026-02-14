import { useCallback, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { VehicleImageGallery } from '@/components/vehicles/VehicleImageGallery';
import { VehiclePricingCard } from '@/components/vehicles/VehiclePricingCard';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useVehicleDetails } from '@/hooks/useVehicleDetails';
import { useVehicleRentalStore } from '@/store/vehicleRental.store';
import { useSearchStore } from '@/store/search.store';
import { cn } from '@/lib/utils';

export const VehicleDetailsPage = () => {
    const { vehicleId } = useParams<{ vehicleId: string }>();
    const navigate = useNavigate();

    // Get dates from search store (set on listing page)
    const searchPickupDate = useSearchStore((state) => state.pickupDate);
    const searchReturnDate = useSearchStore((state) => state.returnDate);

    // Get dates and actions from vehicle rental store
    const {
        getStartDate,
        getEndDate,
        setStartDate,
        setEndDate,
        setPricePerDay,
        setVehicleId,
        setVehicleFullDetails,
        setDeposit,
    } = useVehicleRentalStore();

    const pickupDate = getStartDate();
    const returnDate = getEndDate();

    // Sync dates from search store to rental store on mount
    useEffect(() => {
        // If search store has dates set from listing page, sync them
        if (searchPickupDate) {
            setStartDate(searchPickupDate);
        } else if (!pickupDate) {
            // Fallback to today if no dates exist
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            setStartDate(today);
        }

        if (searchReturnDate) {
            setEndDate(searchReturnDate);
        } else if (!returnDate) {
            // Fallback to tomorrow if no end date exists
            const tomorrow = new Date();
            tomorrow.setHours(0, 0, 0, 0);
            tomorrow.setDate(tomorrow.getDate() + 1);
            setEndDate(tomorrow);
        }
    }, []); // Run only on mount

    // Fetch vehicle details - will refetch when dates change
    const { data, isLoading, isError, isFetching } = useVehicleDetails(
        vehicleId || '',
        pickupDate,
        returnDate
    );

    const vehicle = data?.data;

    // Update price per day in store when vehicle data changes
    useEffect(() => {
        if (vehicle?.pricing?.daily) {
            setPricePerDay(vehicle.pricing.daily);
        }
        if (vehicle?.deposit) {
            setDeposit(vehicle.deposit);
        }
    }, [vehicle?.pricing?.daily, vehicle?.deposit, setPricePerDay, setDeposit]);

    // Book vehicle handler - clears previous selection, saves new one, and navigates to review
    const handleBookVehicle = useCallback(() => {
        if (!vehicleId || !vehicle) return;

        // Get the LATEST dates from store state (not from render-time closure)
        const currentState = useVehicleRentalStore.getState();
        const currentStartDate = currentState.getStartDate();
        const currentEndDate = currentState.getEndDate();

        // Clear previous vehicle selection from session storage
        useVehicleRentalStore.getState().clearVehicleSelection();

        // Set new vehicle selection with full details
        setVehicleId(vehicleId);

        // Helper to extract string from string or object with name property
        const getCategoryName = (cat: any): string => {
            if (!cat) return '';
            return typeof cat === 'string' ? cat : (cat.name || '');
        };

        const getBranchName = (br: any): string => {
            if (!br) return '';
            return typeof br === 'string' ? br : (br.name || '');
        };

        setVehicleFullDetails({
            name: `${vehicle.make} ${vehicle.model}`,
            model: vehicle.model,
            make: vehicle.make,
            images: vehicle.images?.map(img => typeof img === 'string' ? img : img.file?.url).filter(Boolean) || [],
            category: getCategoryName(vehicle.category),
            branch: getBranchName(vehicle.branch),
        });

        // Set dates from current state (not stale closure values)
        if (currentStartDate) setStartDate(currentStartDate);
        if (currentEndDate) setEndDate(currentEndDate);

        // Set pricing
        setPricePerDay(vehicle.pricing?.daily || 0);
        setDeposit(vehicle.deposit || 0);

        // Navigate to review & confirm page
        navigate('/booking/review-confirm');
    }, [vehicleId, vehicle, setVehicleId, setVehicleFullDetails, setStartDate, setEndDate, setPricePerDay, setDeposit, navigate]);

    // Loading state (initial load only)
    // Loading state (initial load only)
    if (isLoading) {
        return (
            <div className="min-h-screen flex flex-col bg-zinc-50">
                <Navbar />
                <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8">
                    {/* Breadcrumb Skeleton */}
                    <div className="flex items-center gap-2 mb-6">
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-24" />
                    </div>

                    {/* Header Skeleton */}
                    <div className="mb-6 md:mb-8">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                            <Skeleton className="h-8 w-64 md:h-10 md:w-96" />
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-6 w-20 rounded-full" />
                                <Skeleton className="h-6 w-24 rounded-full" />
                            </div>
                        </div>
                        <Skeleton className="h-5 w-32" />
                    </div>

                    {/* Content Grid Skeleton */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
                        {/* Image Gallery Skeleton */}
                        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
                            <Skeleton className="w-full aspect-video rounded-xl" />
                            <div className="grid grid-cols-4 gap-2 md:gap-4">
                                <Skeleton className="aspect-square rounded-lg" />
                                <Skeleton className="aspect-square rounded-lg" />
                                <Skeleton className="aspect-square rounded-lg" />
                                <Skeleton className="aspect-square rounded-lg" />
                            </div>
                        </div>

                        {/* Pricing Card Skeleton */}
                        <div className="lg:col-span-5 xl:col-span-4">
                            <div className="lg:sticky lg:top-6">
                                <Skeleton className="h-[400px] w-full rounded-xl" />
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
            <div className="min-h-screen flex flex-col bg-zinc-50">
                <Navbar />
                <main className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-4">
                        <h2 className="text-2xl font-bold text-zinc-900">Vehicle Not Found</h2>
                        <p className="text-zinc-500">
                            The vehicle you're looking for doesn't exist or has been removed.
                        </p>
                        <Link
                            to="/vehicles"
                            className="inline-block px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors"
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
        <div className="min-h-screen flex flex-col bg-zinc-50">
            <Navbar />

            <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8">
                {/* Breadcrumb */}
                <Breadcrumb className="mb-6">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link to="/" className="text-orange-500 hover:text-orange-600">
                                    Home
                                </Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link to="/vehicles" className="text-orange-500 hover:text-orange-600">
                                    Vehicles
                                </Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Vehicle Details</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>

                {/* Vehicle Header */}
                <div className="mb-6 md:mb-8">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                        <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-zinc-900">
                            {vehicleName}
                        </h1>
                        <div className="flex items-center gap-2">
                            <span className="px-3 py-1 text-xs font-semibold bg-orange-100 text-orange-700 rounded-full">
                                {typeof vehicle.category === 'string' ? vehicle.category : vehicle.category?.name || 'N/A'}
                            </span>
                            <span
                                className={cn(
                                    "px-3 py-1 text-xs font-semibold rounded-full",
                                    (vehicle.availability && vehicle.status === 'AVAILABLE')
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-red-100 text-red-700"
                                )}
                            >
                                {(vehicle.availability && vehicle.status === 'AVAILABLE') ? 'Available' : 'Not Available'}
                            </span>
                        </div>
                    </div>
                    <p className="text-zinc-500">{vehicle.branch}</p>
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
                        <div className="lg:sticky lg:top-6">
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
