import { useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { VehicleImageGallery } from '@/components/vehicles/VehicleImageGallery';
import { VehiclePricingCard } from '@/components/vehicles/VehiclePricingCard';
import { Spinner } from '@/components/ui/spinner';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useVehicleDetails } from '@/hooks/useVehicleDetails';
import { useSearchStore } from '@/store/search.store';
import { cn } from '@/lib/utils';

export const VehicleDetailsPage = () => {
    const { vehicleId } = useParams<{ vehicleId: string }>();

    // Get dates from Zustand store
    const { pickupDate, returnDate, setSearchCriteria } = useSearchStore();

    // Fetch vehicle details
    const { data, isLoading, isError } = useVehicleDetails(
        vehicleId || '',
        pickupDate,
        returnDate
    );

    const vehicle = data?.data;

    // Date change handlers
    const handlePickupDateChange = useCallback(
        (date: Date | undefined) => {
            setSearchCriteria({ pickupDate: date || null });
        },
        [setSearchCriteria]
    );

    const handleReturnDateChange = useCallback(
        (date: Date | undefined) => {
            setSearchCriteria({ returnDate: date || null });
        },
        [setSearchCriteria]
    );

    // Book vehicle handler
    const handleBookVehicle = useCallback(() => {
        // Navigate to booking flow (to be implemented)
        console.log('Booking vehicle:', vehicleId);
        // navigate(`/booking/${vehicleId}`);
    }, [vehicleId]);

    // Loading state
    if (isLoading) {
        return (
            <div className="min-h-screen flex flex-col bg-zinc-50">
                <Navbar />
                <main className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                        <Spinner className="size-10 text-orange-500" />
                        <p className="text-zinc-500">Loading vehicle details...</p>
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
                                {vehicle.category}
                            </span>
                            <span
                                className={cn(
                                    "px-3 py-1 text-xs font-semibold rounded-full",
                                    vehicle.status === 'AVAILABLE'
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-red-100 text-red-700"
                                )}
                            >
                                {vehicle.status === 'AVAILABLE' ? 'Available' : 'Not Available'}
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
                                pickupDate={pickupDate}
                                returnDate={returnDate}
                                onPickupDateChange={handlePickupDateChange}
                                onReturnDateChange={handleReturnDateChange}
                                onBookVehicle={handleBookVehicle}
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
