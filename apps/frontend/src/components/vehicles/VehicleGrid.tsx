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
  variant?: "light" | "dark";
  restrictedTypeClasses?: Set<string>;
  limitsLoading?: boolean;
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
  variant = "light",
  restrictedTypeClasses,
  limitsLoading = false,
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
        <div className={cn(
          "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
          variant === "dark" ? "gap-[26px]" : "gap-6"
        )}>
          {Array.from({ length: 9 }).map((_, i) => (
            variant === "dark" ? (
              <div
                key={i}
                className="flex flex-col rounded-[22px] overflow-hidden bg-[#101217]"
              >
                <Skeleton className="h-[440px] w-full rounded-none bg-zinc-800/60" />
                <div className="h-[60px] bg-zinc-800/40" />
              </div>
            ) : (
              <div
                key={i}
                className="flex flex-col space-y-4 rounded-2xl p-5 bg-white border border-zinc-200"
              >
                <div className="space-y-2">
                  <Skeleton className="h-5 w-3/4 rounded bg-zinc-200" />
                  <Skeleton className="h-4 w-1/2 rounded bg-zinc-100" />
                </div>
                <Skeleton className="h-32 w-full rounded-lg bg-zinc-100" />
                <Skeleton className="h-7 w-28 rounded bg-zinc-200" />
                <Skeleton className="h-11 w-full rounded bg-zinc-200" />
              </div>
            )
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
      <div className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        variant === "dark" ? "gap-[26px]" : "gap-6"
      )}>
        {vehicles.map((vehicle) => {
          const tc = "typeClass" in vehicle ? (vehicle as any).typeClass : undefined;
          const isRestricted = !!(tc && restrictedTypeClasses?.has(tc));
          return (
            <MemoizedVehicleCard
              key={"groupKey" in vehicle ? vehicle.groupKey : (vehicle as any).publicId}
              vehicle={vehicle}
              basePath={basePath}
              startDateTime={startDateTime}
              endDateTime={endDateTime}
              variant={variant}
              isRestricted={isRestricted}
              limitsLoading={limitsLoading}
            />
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center pt-8 pb-12">
          <Pagination>
            <PaginationContent className="bg-white border border-zinc-200 rounded-full p-2 shadow-2xl">
              {/* Previous Button */}
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => handlePageChange(currentPage - 1)}
                  className={cn(
                    "h-10 px-4 rounded-full font-bold tracking-wide transition-all",
                    currentPage === 1
                      ? "pointer-events-none opacity-30 text-zinc-400"
                      : "cursor-pointer hover:bg-zinc-100 text-zinc-700",
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
                          ? "bg-zinc-900 text-white shadow-sm hover:bg-zinc-700"
                          : "cursor-pointer text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
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
                      ? "pointer-events-none opacity-30 text-zinc-400"
                      : "cursor-pointer hover:bg-zinc-100 text-zinc-700",
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
          Page <span className="text-zinc-900">{currentPage}</span> of{" "}
          <span className="text-zinc-900">{totalPages}</span> • Showing{" "}
          <span className="text-zinc-900">{vehicles.length}</span> of{" "}
          <span className="text-zinc-900">{totalCount}</span> vehicles
        </div>
      )}
    </div>
  );
};
