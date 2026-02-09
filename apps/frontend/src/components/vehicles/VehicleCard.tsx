import { useNavigate } from 'react-router-dom';
import { Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Vehicle } from '@/services/vehicle.service';

interface VehicleCardProps {
    vehicle: Vehicle;
    basePath?: string;
}

export const VehicleCard = ({ vehicle, basePath = '/vehicle' }: VehicleCardProps) => {
    const navigate = useNavigate();

    const imageUrl = vehicle.imageUrl?.[0]?.file?.url;

    const handleViewVehicle = () => {
        navigate(`${basePath}/${vehicle.publicId}`);
    };

    return (
        <Card className="group overflow-hidden bg-white border border-zinc-200 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300">
            {/* Vehicle Image */}
            <div className="relative aspect-[4/3] bg-zinc-100 overflow-hidden">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Car className="size-16 text-zinc-300" />
                    </div>
                )}
                {/* Category Badge */}
                <div className="absolute top-3 left-3">
                    <span className="px-3 py-1 text-xs font-semibold bg-orange-500 text-white rounded-full">
                        {vehicle.category.name}
                    </span>
                </div>
            </div>

            <CardContent className="p-4 space-y-3">
                {/* Make + Model */}
                <h3 className="text-lg font-bold text-zinc-900 truncate">
                    {vehicle.make} {vehicle.model}
                </h3>

                {/* Branch */}
                <p className="text-sm text-zinc-500 truncate">
                    {vehicle.branch}
                </p>

                {/* Price and CTA */}
                <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
                    <div>
                        <span className="text-2xl font-bold text-zinc-900">
                            ₹{vehicle.baseDailyPrice}
                        </span>
                        <span className="text-sm text-zinc-500 ml-1">/day</span>
                    </div>
                    <Button
                        onClick={handleViewVehicle}
                        className="bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors"
                    >
                        View Vehicle
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};
