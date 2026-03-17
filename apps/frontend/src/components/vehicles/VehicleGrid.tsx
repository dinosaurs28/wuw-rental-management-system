import { memo, useMemo } from "react";
import { VehicleCard } from "./VehicleCard";
import { VehicleEmptyState } from "./VehicleEmptyState";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Vehicle } from "@/services/vehicle.service";

interface VehicleGridProps {
  vehicles: Vehicle[];
  isLoading: boolean;
  onReset: () => void;
  currentPage: number;
  totalCount: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  basePath?: string;
  startDateTime?: string;
  endDateTime?: string;
}

// Memoized vehicle card for optimization
const MemoizedVehicleCard = memo(VehicleCard);

// Generate pagination page numbers
const getPageNumbers = (
  currentPage: number,
  totalPages: number,
): (number | "ellipsis")[] => {
  const pages: (number | "ellipsis")[] = [];

  if (totalPages <= 7) {
    // Show all pages if 7 or less
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    // Always show first page
    pages.push(1);

    if (currentPage > 3) {
      pages.push("ellipsis");
    }

    // Show pages around current
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push("ellipsis");
    }

    // Always show last page
    if (totalPages > 1) {
      pages.push(totalPages);
    }
  }

  return pages;
};

export const VehicleGrid = ({
  vehicles,
  isLoading,
  onReset,
  currentPage,
  totalCount,
  itemsPerPage,
  onPageChange,
  basePath,
  startDateTime,
  endDateTime,
}: VehicleGridProps) => {
  const totalPages = Math.ceil(totalCount / itemsPerPage);

  // Memoize page numbers calculation
  const pageNumbers = useMemo(
    () => getPageNumbers(currentPage, totalPages),
    [currentPage, totalPages],
  );

  // Smooth scroll to top when page changes
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      onPageChange(page);
      // Smooth scroll to top of grid
      window.scrollTo({ top: 200, behavior: "smooth" });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col space-y-4 bg-zinc-900/40 border border-white/5 rounded-[2rem] p-4"
            >
              <Skeleton className="h-[200px] w-full rounded-[1.5rem] bg-white/5" />
              <div className="space-y-3 px-2">
                <Skeleton className="h-4 w-3/4 bg-white/10 rounded-full" />
                <Skeleton className="h-4 w-1/2 bg-white/5 rounded-full" />
              </div>
              <div className="pt-4 mt-2 border-t border-white/5 flex justify-between px-2">
                <Skeleton className="h-8 w-24 bg-white/10 rounded-full" />
                <Skeleton className="h-10 w-28 bg-white/5 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (vehicles.length === 0) {
    return <VehicleEmptyState onReset={onReset} />;
  }

  return (
    <div className="space-y-8">
      {/* Vehicle Grid - No separate scroll container */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {vehicles.map((vehicle) => (
          <MemoizedVehicleCard
            key={vehicle.publicId}
            vehicle={vehicle}
            basePath={basePath}
            startDateTime={startDateTime}
            endDateTime={endDateTime}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center pt-8 pb-12">
          <Pagination>
            <PaginationContent className="bg-zinc-900/40 backdrop-blur-xl border border-white/5 rounded-full p-2 shadow-2xl">
              {/* Previous Button */}
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => handlePageChange(currentPage - 1)}
                  className={cn(
                    "h-10 px-4 rounded-full font-bold tracking-wide transition-all",
                    currentPage === 1
                      ? "pointer-events-none opacity-30 text-zinc-500"
                      : "cursor-pointer hover:bg-white/10 text-white",
                  )}
                />
              </PaginationItem>

              {/* Page Numbers */}
              {pageNumbers.map((page, index) => (
                <PaginationItem key={index}>
                  {page === "ellipsis" ? (
                    <PaginationEllipsis className="text-zinc-500" />
                  ) : (
                    <PaginationLink
                      onClick={() => handlePageChange(page)}
                      isActive={currentPage === page}
                      className={cn(
                        "size-10 rounded-full font-bold transition-all",
                        currentPage === page
                          ? "bg-white text-zinc-950 shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:bg-zinc-200 hover:text-zinc-950"
                          : "cursor-pointer text-zinc-400 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {page}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}

              {/* Next Button */}
              <PaginationItem>
                <PaginationNext
                  onClick={() => handlePageChange(currentPage + 1)}
                  className={cn(
                    "h-10 px-4 rounded-full font-bold tracking-wide transition-all",
                    currentPage === totalPages
                      ? "pointer-events-none opacity-30 text-zinc-500"
                      : "cursor-pointer hover:bg-white/10 text-white",
                  )}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Page Info */}
      {totalPages > 1 && (
        <div className="text-center text-xs font-black tracking-[0.2em] text-zinc-500 uppercase pb-4">
          Page <span className="text-white">{currentPage}</span> of{" "}
          <span className="text-white">{totalPages}</span> • Showing{" "}
          <span className="text-white">{vehicles.length}</span> of{" "}
          <span className="text-white">{totalCount}</span> vehicles
        </div>
      )}
    </div>
  );
};
