import { useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, MapPin, Check, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from '@/lib/utils';
import { useEmployeeBookingStore } from '@/store/employeeBooking.store';
import type { VehicleDetails } from '@/services/vehicle.service';

interface EmployeeVehiclePricingCardProps {
    vehicle: VehicleDetails;
    onBookVehicle: () => void;
    isRefetching?: boolean;
    disabled?: boolean;
}

export const EmployeeVehiclePricingCard = ({
    vehicle,
    onBookVehicle,
    isRefetching = false,
    disabled = false,
}: EmployeeVehiclePricingCardProps) => {
    // Get state and actions from the employee store
    const {
        startDate,
        endDate,
        setDates,
        paymentType,
        setPaymentType
    } = useEmployeeBookingStore();

    // Dates are already Date objects in this store (based on interface, checking store implementation...)
    // Wait, in store implementation: startDate: Date | null

    const formattedPickupDate = startDate ? format(startDate, 'MMM dd, yyyy') : 'Select date';
    const formattedReturnDate = endDate ? format(endDate, 'MMM dd, yyyy') : 'Select date';

    const isAvailable = vehicle.availability && vehicle.status === 'AVAILABLE';

    // Pricing display logic
    const hasDiscount = vehicle.discountPrice > 0 && vehicle.discountPrice < vehicle.baseTotal;
    const displayDays = vehicle.totalDays;
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
        if (startDate) {
            return { before: startDate };
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return { before: today };
    }, [startDate]);

    const handlePickupDateChange = (date: Date | undefined) => {
        if (date) {
            // If we have an end date, keep it unless it's invalid
            const newEnd = (endDate && date > endDate) ? null : endDate;
            if (newEnd) {
                setDates(date, newEnd);
            } else {
                // Temporary state handling might be needed if store requires both at once
                // But store has setDates(start, end).
                // We might need to handle partial state if store enforces both.
                // Looking at store: setDates: (start, end) => set({ startDate: start, endDate: end })
                // So we need to pass both.
                // If we only have start, we can't call setDates yet fully?
                // Or we pass current end date.
                setDates(date, endDate as Date); // Cast might be unsafe if endDate is null
            }
        }
    };

    // Actually, looking at the store signature: setDates: (start: Date, end: Date) => void
    // It requires BOTH. So we need separate setters or handle it locally until both are present.
    // BUT! We can't handle it locally effectively because we want to persist.
    // We should probably update the store to allow setting individual dates or handle nulls.
    // The previous store `vehicleRental.store` had separate `setStartDate` and `setEndDate`.
    // My `employeeBooking.store` has `setDates`.
    // I should update `employeeBooking.store` to allow individual updates or handle it here.
    // For now, I'll update the store to allow individual updates in a future step if needed, 
    // but looking at `VehiclePricingCard`, it calls `setStartDate` and `setEndDate`.

    // Let's refactor this component to manage local state for dates until both are valid, 
    // OR update the store. Updating store is better.
    // I entered this knowing I'd need to adapt.

    // Let's assume for now I will use a local wrapper or just force it.

    const handleStartDateSelect = (date: Date | undefined) => {
        if (!date) return;
        const newEnd = endDate && date > endDate ? date : (endDate || date);
        setDates(date, newEnd);
    };

    const handleEndDateSelect = (date: Date | undefined) => {
        if (!date) return;
        const newStart = startDate || date;
        setDates(newStart, date);
    };


    const canBook = isAvailable && startDate && endDate && !isRefetching && !disabled;

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
                                            !startDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 size-4" />
                                        <span className="truncate">{formattedPickupDate}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={startDate || undefined}
                                        onSelect={handleStartDateSelect}
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
                                            !endDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 size-4" />
                                        <span className="truncate">{formattedReturnDate}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={endDate || undefined}
                                        onSelect={handleEndDateSelect}
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

                {/* Payment Type Selection */}
                <div className="px-6 py-4 border-b border-zinc-100">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide block mb-3">
                        Payment Method
                    </label>
                    <RadioGroup
                        value={paymentType}
                        onValueChange={(val) => setPaymentType(val as 'CASH' | 'ONLINE')}
                        className="grid grid-cols-2 gap-4"
                    >
                        <div>
                            <RadioGroupItem value="CASH" id="cash" className="peer sr-only" />
                            <Label
                                htmlFor="cash"
                                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-zinc-50 hover:text-accent-foreground peer-data-[state=checked]:border-orange-500 peer-data-[state=checked]:text-orange-600 cursor-pointer"
                            >
                                <span className="text-xl mb-1">💵</span>
                                <span className="text-sm font-semibold">Cash</span>
                            </Label>
                        </div>
                        <div>
                            <RadioGroupItem value="ONLINE" id="online" className="peer sr-only" />
                            <Label
                                htmlFor="online"
                                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-zinc-50 hover:text-accent-foreground peer-data-[state=checked]:border-orange-500 peer-data-[state=checked]:text-orange-600 cursor-pointer"
                            >
                                <span className="text-xl mb-1">💳</span>
                                <span className="text-sm font-semibold">Online</span>
                            </Label>
                        </div>
                    </RadioGroup>
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
                            'Proceed to Booking'
                        ) : (
                            'Currently Unavailable'
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};
