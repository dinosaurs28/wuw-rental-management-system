import { Card, CardContent } from '@/components/ui/card';
import { useVehicleRentalStore } from '@/store/vehicleRental.store';
import { Car, Calendar, MapPin } from 'lucide-react';
import { format } from 'date-fns';

export const VehicleSummaryCard = () => {
    const {
        name,
        make,
        model,
        vehicleImages,
        category,
        branch,
        startDate,
        endDate,
        rentalDays,
    } = useVehicleRentalStore();

    const imageUrl = vehicleImages?.[0];
    const formattedStartDate = startDate ? format(new Date(startDate), 'EEE, MMM d, yyyy') : '-';
    const formattedEndDate = endDate ? format(new Date(endDate), 'EEE, MMM d, yyyy') : '-';

    return (
        <Card className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
            <CardContent className="p-0">
                {/* Vehicle Image */}
                <div className="relative aspect-[16/9] bg-zinc-100 overflow-hidden">
                    {imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={`${make} ${model}`}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <Car className="size-16 text-zinc-300" />
                        </div>
                    )}
                    {/* Category Badge */}
                    {category && (
                        <div className="absolute top-3 left-3">
                            <span className="px-3 py-1 text-xs font-semibold bg-primary text-primary-foreground rounded-full uppercase">
                                {category}
                            </span>
                        </div>
                    )}
                </div>

                {/* Vehicle Details */}
                <div className="p-5 space-y-4">
                    {/* Make + Model */}
                    <div>
                        <h3 className="text-xl font-bold text-foreground">
                            {make} {model}
                        </h3>
                        {name && name !== `${make} ${model}` && (
                            <p className="text-sm text-muted-foreground mt-1">{name}</p>
                        )}
                    </div>

                    {/* Location */}
                    {branch && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MapPin className="size-4" />
                            <span>{branch}</span>
                        </div>
                    )}

                    {/* Date Range */}
                    <div className="grid grid-cols-2 gap-4 pt-3 border-t border-zinc-100">
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Pickup
                            </p>
                            <div className="flex items-center gap-2">
                                <Calendar className="size-4 text-primary" />
                                <span className="text-sm font-medium text-foreground">
                                    {formattedStartDate}
                                </span>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Return
                            </p>
                            <div className="flex items-center gap-2">
                                <Calendar className="size-4 text-primary" />
                                <span className="text-sm font-medium text-foreground">
                                    {formattedEndDate}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Duration Badge */}
                    {rentalDays > 0 && (
                        <div className="pt-3 border-t border-zinc-100">
                            <span className="inline-flex items-center px-3 py-1.5 text-xs font-semibold bg-secondary text-secondary-foreground rounded-full">
                                {rentalDays} {rentalDays === 1 ? 'day' : 'days'} rental
                            </span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
