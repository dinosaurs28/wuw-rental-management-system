import { useNavigate } from 'react-router-dom';
import { Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { PublicVehicle, ManagerVehicle } from '@/services/vehicle.service';

interface VehicleCardProps {
    vehicle: PublicVehicle | ManagerVehicle;
    basePath?: string;
}

export const VehicleCard = ({ vehicle, basePath = '/vehicle' }: VehicleCardProps) => {
    const navigate = useNavigate();

    const imageUrl = vehicle.imageUrl?.[0]?.file?.url;

    // Helper to get category name from either type
    const getCategoryName = () => {
        return typeof vehicle.category === 'string' ? vehicle.category : vehicle.category.name;
    };

    // Helper to get price from either type
    const getPrice = () => {
        return 'pricing' in vehicle ? vehicle.pricing.daily : vehicle.baseDailyPrice;
    };

    const handleViewVehicle = () => {
        navigate(`${basePath}/${vehicle.publicId}`);
    };

    return (
        <Card className="group overflow-hidden bg-zinc-900/40 backdrop-blur-xl border border-white/5 shadow-2xl rounded-[2rem] hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] transition-all duration-500 relative">
            {/* Subtle glow effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

            {/* Vehicle Image */}
            <div className="relative aspect-[4/3] bg-zinc-950 overflow-hidden rounded-t-[2rem]">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-900/50">
                        <Car className="size-16 text-zinc-700" />
                    </div>
                )}
                {/* Category Badge */}
                <div className="absolute top-4 left-4 z-10">
                    <span className="px-4 py-1.5 text-[10px] font-black tracking-[0.2em] bg-black/60 backdrop-blur-md border border-white/10 text-white rounded-full uppercase">
                        {getCategoryName()}
                    </span>
                </div>
            </div>

            <CardContent className="p-6 space-y-4 relative z-10">
                {/* Make + Model */}
                <div className="space-y-1">
                    <h3 className="text-xl md:text-2xl font-serif font-black text-white truncate group-hover:text-orange-100 transition-colors">
                        {vehicle.make} {vehicle.model}
                    </h3>
                    {/* Branch */}
                    <p className="text-xs font-bold tracking-wider text-zinc-500 uppercase flex items-center gap-1.5 truncate">
                        <span className="size-1.5 rounded-full bg-orange-500 shrink-0" />
                        {vehicle.branch}
                    </p>
                </div>

                {/* Price and CTA */}
                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                    <div>
                        <span className="text-3xl font-bold text-white tracking-tight">
                            ₹{getPrice()}
                        </span>
                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-2">/day</span>
                    </div>
                    <Button
                        onClick={handleViewVehicle}
                        className="h-12 px-6 bg-white hover:bg-zinc-200 text-zinc-950 font-bold rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
                    >
                        View
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};
