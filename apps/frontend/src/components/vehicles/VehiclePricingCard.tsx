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
        <Card className="overflow-hidden bg-zinc-900/40 backdrop-blur-xl border border-white/5 shadow-2xl rounded-[2rem]">
            <CardContent className="p-0">
                {/* Price Header */}
                <div className="p-8 border-b border-white/5">
                    <div className="flex items-baseline justify-between mb-4">
                        <div>
                            <span className="text-4xl lg:text-5xl font-serif font-black text-white tracking-tight">
                                {formatCurrency(vehicle.pricing.daily)}
                            </span>
                            <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider ml-2">/day</span>
                        </div>
                        <div
                            className={cn(
                                "px-4 py-1.5 rounded-full text-xs font-black tracking-[0.2em] uppercase border",
                                isAvailable
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-red-500/10 text-red-400 border-red-500/20"
                            )}
                        >
                            {isAvailable ? 'Available' : 'Not Available'}
                        </div>
                    </div>
                    {/* Branch Location */}
                    <div className="flex items-center gap-2 text-sm font-bold tracking-wider text-zinc-400 uppercase">
                        <MapPin className="size-4 text-orange-500" />
                        <span>{vehicle.branch}</span>
                    </div>
                </div>

                {/* Date Selectors */}
                <div className="p-8 space-y-6 border-b border-white/5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Pickup Date */}
                        <div className="space-y-3">
                            <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                                Pickup Date
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-full justify-start text-left font-normal h-14 rounded-full bg-black/40 border-white/10 hover:bg-white/5 text-white hover:text-white transition-colors",
                                            !pickupDate && "text-zinc-500"
                                        )}
                                    >
                                        <CalendarIcon className="mr-3 size-5 text-zinc-400" />
                                        <span className="truncate text-base">{formattedPickupDate}</span>
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
                        <div className="space-y-3">
                            <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                                Return Date
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-full justify-start text-left font-normal h-14 rounded-full bg-black/40 border-white/10 hover:bg-white/5 text-white hover:text-white transition-colors",
                                            !returnDate && "text-zinc-500"
                                        )}
                                    >
                                        <CalendarIcon className="mr-3 size-5 text-zinc-400" />
                                        <span className="truncate text-base">{formattedReturnDate}</span>
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
                <div className="p-8 space-y-4 border-b border-white/5 relative">
                    {/* Loading overlay for refetching */}
                    {isRefetching && (
                        <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center z-10">
                            <Loader2 className="size-6 text-orange-500 animate-spin" />
                        </div>
                    )}

                    {displayDays > 0 && (
                        <>
                            <div className="flex justify-between text-base">
                                <span className="text-zinc-400">
                                    {formatCurrency(vehicle.pricing.daily)} × {displayDays} days
                                </span>
                                <span className="text-white font-medium">
                                    {formatCurrency(vehicle.baseTotal)}
                                </span>
                            </div>

                            {hasDiscount && (
                                <div className="flex justify-between text-base">
                                    <span className="text-emerald-400 flex items-center gap-2">
                                        <Check className="size-4" />
                                        Discount
                                    </span>
                                    <span className="text-emerald-400 font-medium tracking-wide">
                                        -{formatCurrency(vehicle.discountPrice)}
                                    </span>
                                </div>
                            )}

                            <div className="pt-4 mt-2 border-t border-white/10">
                                <div className="flex justify-between items-end">
                                    <span className="text-lg font-black text-white uppercase tracking-wider">Total</span>
                                    <span className="text-3xl font-bold text-white tracking-tight">
                                        {formatCurrency(displayTotal)}
                                    </span>
                                </div>
                            </div>
                        </>
                    )}

                    {displayDays === 0 && !isRefetching && (
                        <p className="text-base text-zinc-500 text-center py-4 font-medium">
                            Select dates to see pricing
                        </p>
                    )}
                </div>

                {/* Deposit Info */}
                <div className="px-8 py-6 bg-black/20 border-b border-white/5">
                    <div className="flex justify-between text-base">
                        <span className="text-zinc-400">Security Deposit</span>
                        <span className="text-white font-medium">
                            {formatCurrency(vehicle.deposit)}
                        </span>
                    </div>
                </div>

                {/* CTA Button */}
                <div className="p-8">
                    <Button
                        onClick={onBookVehicle}
                        disabled={!canBook}
                        className="w-full h-16 bg-white hover:bg-zinc-200 text-zinc-950 font-black text-lg uppercase tracking-widest rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none"
                    >
                        {isRefetching ? (
                            <span className="flex items-center gap-3">
                                <Loader2 className="size-5 animate-spin" />
                                Updating...
                            </span>
                        ) : isAvailable ? (
                            'Book Vehicle'
                        ) : (
                            'Unavailable'
                        )}
                    </Button>
                    {(!pickupDate || !returnDate) && isAvailable && !isRefetching && (
                        <p className="text-sm font-bold tracking-wider text-zinc-500 uppercase text-center mt-4">
                            Please select dates
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
