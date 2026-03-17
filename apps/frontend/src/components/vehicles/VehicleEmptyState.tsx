import { Car, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VehicleEmptyStateProps {
  onReset: () => void;
}

export const VehicleEmptyState = ({ onReset }: VehicleEmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center rounded-[2rem] border border-dashed border-white/10 bg-black/20 backdrop-blur-md">
      <div className="size-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6">
        <Car className="size-10 text-zinc-500" />
      </div>
      <h3 className="text-2xl font-serif font-black text-white mb-2">
        No vehicles found
      </h3>
      <p className="text-zinc-500 text-center max-w-sm mb-8 font-medium">
        We couldn't find any vehicles matching your search criteria. Try
        adjusting your filters or search terms.
      </p>
      <Button
        onClick={onReset}
        variant="outline"
        className="h-12 px-8 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 font-bold tracking-wide transition-all"
      >
        <Search className="size-4 mr-2" />
        Reset Filters
      </Button>
    </div>
  );
};
