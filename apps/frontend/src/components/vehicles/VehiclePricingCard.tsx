import { useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, MapPin, Check, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useVehicleRentalStore } from '@/store/vehicleRental.store';
import type { VehicleDetails } from '@/services/vehicle.service';

interface VehiclePricingCardProps {
    vehicle: VehicleDetails;
    onBookVehicle: () => void;
    isRefetching?: boolean;
}

export const VehiclePricingCard = ({
    vehicle,
    onBookVehicle,
    isRefetching = false,
}: VehiclePricingCardProps) => {
    // Get state and actions from the store
    const {
        getStartDate,
        getEndDate,
        setStartDate,
        setEndDate,
    } = useVehicleRentalStore();

    // Get dates as Date objects
    const pickupDate = getStartDate();
    const returnDate = getEndDate();

    const formattedPickupDate = pickupDate ? format(pickupDate, 'MMM dd, yyyy') : 'Select date';
    const formattedReturnDate = returnDate ? format(returnDate, 'MMM dd, yyyy') : 'Select date';

    const isAvailable = vehicle.availability;

    // Use backend-calculated pricing (updates when dates change and refetch happens)
    // discountPrice is the discount amount (savings), not the final price
    const hasDiscount = vehicle.discountPrice > 0 && vehicle.discountPrice < vehicle.baseTotal;
    const displayDays = vehicle.totalDays;
    // Final price = baseTotal - discountPrice (discount amount)
    const displayTotal = hasDiscount ? (vehicle.baseTotal - vehicle.discountPrice) : vehicle.baseTotal;

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    // Disable past dates
    const disabledDays = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return { before: today };
    }, []);

    // Return date should be after pickup date
    const returnDisabledDays = useMemo(() => {
        if (pickupDate) {
            return { before: pickupDate };
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return { before: today };
    }, [pickupDate]);

    // Handle date changes - update store (triggers refetch in parent)
    const handlePickupDateChange = (date: Date | undefined) => {
        setStartDate(date || null);
    };

    const handleReturnDateChange = (date: Date | undefined) => {
        setEndDate(date || null);
    };

    // Button is enabled only when we have both dates, vehicle is available, and not loading
    const canBook = isAvailable && pickupDate && returnDate && !isRefetching;

    return (
        <Card className="overflow-hidden border border-zinc-200 shadow-lg">
            <CardContent className="p-0">
                {/* Price Header */}
                <div className="p-6 border-b border-zinc-100">
                    <div className="flex items-baseline justify-between">
                        <div>
                            <span className="text-3xl font-bold text-zinc-900">
                                {formatCurrency(vehicle.pricing.daily)}
                            </span>
                            <span className="text-sm text-zinc-500 ml-1">/day</span>
                        </div>
                        <div
                            className={cn(
                                "px-3 py-1.5 rounded-full text-xs font-semibold",
                                isAvailable
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-red-100 text-red-700"
                            )}
                        >
                            {isAvailable ? 'Available' : 'Not Available'}
                        </div>
                    </div>
                </div>

                {/* Branch Location */}
                <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-100">
                    <div className="flex items-center gap-2 text-sm text-zinc-600">
                        <MapPin className="size-4 text-orange-500" />
                        <span>{vehicle.branch}</span>
                    </div>
                </div>

                {/* Date Selectors */}
                <div className="p-6 space-y-4 border-b border-zinc-100">
                    <div className="grid grid-cols-2 gap-4">
                        {/* Pickup Date */}
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                                Pickup Date
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-full justify-start text-left font-normal h-11",
                                            !pickupDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 size-4" />
                                        <span className="truncate">{formattedPickupDate}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={pickupDate || undefined}
                                        onSelect={handlePickupDateChange}
                                        disabled={disabledDays}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Return Date */}
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                                Return Date
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-full justify-start text-left font-normal h-11",
                                            !returnDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 size-4" />
                                        <span className="truncate">{formattedReturnDate}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={returnDate || undefined}
                                        onSelect={handleReturnDateChange}
                                        disabled={returnDisabledDays}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </div>

                {/* Pricing Breakdown */}
                <div className="p-6 space-y-3 border-b border-zinc-100 relative">
                    {/* Loading overlay for refetching */}
                    {isRefetching && (
                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                            <Loader2 className="size-5 text-orange-500 animate-spin" />
                        </div>
                    )}

                    {displayDays > 0 && (
                        <>
                            <div className="flex justify-between text-sm">
                                <span className="text-zinc-600">
                                    {formatCurrency(vehicle.pricing.daily)} × {displayDays} days
                                </span>
                                <span className="text-zinc-900 font-medium">
                                    {formatCurrency(vehicle.baseTotal)}
                                </span>
                            </div>

                            {hasDiscount && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-emerald-600 flex items-center gap-1">
                                        <Check className="size-4" />
                                        Discount
                                    </span>
                                    <span className="text-emerald-600 font-medium">
                                        -{formatCurrency(vehicle.discountPrice)}
                                    </span>
                                </div>
                            )}

                            <div className="pt-3 border-t border-zinc-200">
                                <div className="flex justify-between">
                                    <span className="text-base font-semibold text-zinc-900">Total</span>
                                    <span className="text-xl font-bold text-zinc-900">
                                        {formatCurrency(displayTotal)}
                                    </span>
                                </div>
                            </div>
                        </>
                    )}

                    {displayDays === 0 && !isRefetching && (
                        <p className="text-sm text-zinc-500 text-center py-2">
                            Select dates to see pricing
                        </p>
                    )}
                </div>

                {/* Deposit Info */}
                <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-100">
                    <div className="flex justify-between text-sm">
                        <span className="text-zinc-600">Security Deposit</span>
                        <span className="text-zinc-900 font-medium">
                            {formatCurrency(vehicle.deposit)}
                        </span>
                    </div>
                </div>

                {/* CTA Button */}
                <div className="p-6">
                    <Button
                        onClick={onBookVehicle}
                        disabled={!canBook}
                        className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isRefetching ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="size-4 animate-spin" />
                                Updating...
                            </span>
                        ) : isAvailable ? (
                            'Book Vehicle'
                        ) : (
                            'Currently Unavailable'
                        )}
                    </Button>
                    {(!pickupDate || !returnDate) && isAvailable && !isRefetching && (
                        <p className="text-xs text-zinc-500 text-center mt-2">
                            Please select pickup and return dates
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
