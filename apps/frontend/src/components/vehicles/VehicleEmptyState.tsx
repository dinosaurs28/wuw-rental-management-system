import { Car, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VehicleEmptyStateProps {
    onReset: () => void;
}

export const VehicleEmptyState = ({ onReset }: VehicleEmptyStateProps) => {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="size-24 rounded-full bg-zinc-100 flex items-center justify-center mb-6">
                <Car className="size-12 text-zinc-400" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">
                No vehicles found
            </h3>
            <p className="text-zinc-500 text-center max-w-sm mb-6">
                We couldn't find any vehicles matching your search criteria. Try adjusting your filters or search terms.
            </p>
            <Button
                onClick={onReset}
                variant="outline"
                className="border-orange-500 text-orange-500 hover:bg-orange-50 font-semibold rounded-lg"
            >
                <Search className="size-4 mr-2" />
                Reset Filters
            </Button>
        </div>
    );
};
