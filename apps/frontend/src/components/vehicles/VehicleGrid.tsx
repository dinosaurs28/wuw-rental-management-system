import { memo, useMemo } from 'react';
import { VehicleCard } from './VehicleCard';
import { VehicleEmptyState } from './VehicleEmptyState';
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
    PaginationEllipsis,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import type { Vehicle } from '@/services/vehicle.service';

interface VehicleGridProps {
    vehicles: Vehicle[];
    isLoading: boolean;
    onReset: () => void;
    currentPage: number;
    totalCount: number;
    itemsPerPage: number;
    onPageChange: (page: number) => void;
    basePath?: string;
}

// Memoized vehicle card for optimization
const MemoizedVehicleCard = memo(VehicleCard);

// Generate pagination page numbers
const getPageNumbers = (currentPage: number, totalPages: number): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = [];

    if (totalPages <= 7) {
        // Show all pages if 7 or less
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i);
        }
    } else {
        // Always show first page
        pages.push(1);

        if (currentPage > 3) {
            pages.push('ellipsis');
        }

        // Show pages around current
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);

        for (let i = start; i <= end; i++) {
            pages.push(i);
        }

        if (currentPage < totalPages - 2) {
            pages.push('ellipsis');
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
}: VehicleGridProps) => {
    const totalPages = Math.ceil(totalCount / itemsPerPage);

    // Memoize page numbers calculation
    const pageNumbers = useMemo(
        () => getPageNumbers(currentPage, totalPages),
        [currentPage, totalPages]
    );

    // Smooth scroll to top when page changes
    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages && page !== currentPage) {
            onPageChange(page);
            // Smooth scroll to top of grid
            window.scrollTo({ top: 200, behavior: 'smooth' });
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="flex flex-col space-y-3">
                            <Skeleton className="h-[200px] w-full rounded-xl" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-[250px]" />
                                <Skeleton className="h-4 w-[200px]" />
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
                    <MemoizedVehicleCard key={vehicle.publicId} vehicle={vehicle} basePath={basePath} />
                ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center pt-4 pb-8">
                    <Pagination>
                        <PaginationContent>
                            {/* Previous Button */}
                            <PaginationItem>
                                <PaginationPrevious
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    className={
                                        currentPage === 1
                                            ? 'pointer-events-none opacity-50'
                                            : 'cursor-pointer hover:bg-zinc-100'
                                    }
                                />
                            </PaginationItem>

                            {/* Page Numbers */}
                            {pageNumbers.map((page, index) => (
                                <PaginationItem key={index}>
                                    {page === 'ellipsis' ? (
                                        <PaginationEllipsis />
                                    ) : (
                                        <PaginationLink
                                            onClick={() => handlePageChange(page)}
                                            isActive={currentPage === page}
                                            className={
                                                currentPage === page
                                                    ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
                                                    : 'cursor-pointer hover:bg-zinc-100'
                                            }
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
                                    className={
                                        currentPage === totalPages
                                            ? 'pointer-events-none opacity-50'
                                            : 'cursor-pointer hover:bg-zinc-100'
                                    }
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            )}

            {/* Page Info */}
            {totalPages > 1 && (
                <div className="text-center text-sm text-zinc-500 pb-4">
                    Page {currentPage} of {totalPages} • Showing {vehicles.length} of {totalCount} vehicles
                </div>
            )}
        </div>
    );
};
