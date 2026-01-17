import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { VehicleFilters } from '@/components/vehicles/VehicleFilters';
import { VehicleGrid } from '@/components/vehicles/VehicleGrid';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useBranches } from '@/hooks/useBranches';
import { useVehicles } from '@/hooks/useVehicles';
import { useDebounce } from '@/hooks/useDebounce';
import { useSearchStore } from '@/store/search.store';
import type { VehicleFilters as VehicleFiltersType } from '@/services/vehicle.service';

const ITEMS_PER_PAGE = 9; // 3x3 grid

export const VehiclesPage = () => {
    // State from landing page (if coming from search)
    const { branchPublicId, pickupDate, returnDate, setSearchCriteria, resetSearch } = useSearchStore();

    // Branches data
    const { data: branches = [], isLoading: branchesLoading } = useBranches();

    // Local filter state
    const [selectedBranch, setSelectedBranch] = useState<string>('');
    const [selectedPickupDate, setSelectedPickupDate] = useState<Date | null>(null);
    const [selectedReturnDate, setSelectedReturnDate] = useState<Date | null>(null);
    const [category, setCategory] = useState<string>('all');
    const [sortBy, setSortBy] = useState<string>('default');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Debounced search
    const debouncedSearch = useDebounce(searchQuery, 300);

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedBranch, category, debouncedSearch, sortBy]);

    // Initialize state from store or set default branch
    useEffect(() => {
        if (branchPublicId) {
            setSelectedBranch(branchPublicId);
        } else if (branches.length > 0 && !selectedBranch) {
            setSelectedBranch(branches[0].publicId);
            setSearchCriteria({ branchPublicId: branches[0].publicId });
        }
    }, [branchPublicId, branches, selectedBranch, setSearchCriteria]);

    useEffect(() => {
        if (pickupDate) setSelectedPickupDate(pickupDate);
        if (returnDate) setSelectedReturnDate(returnDate);
    }, [pickupDate, returnDate]);

    // Build filters for API with pagination
    const filters: VehicleFiltersType = useMemo(() => {
        const f: VehicleFiltersType = {};

        if (selectedBranch) f.branch = selectedBranch;
        if (category && category !== 'all') f.category = category;
        if (debouncedSearch) f.search = debouncedSearch;
        if (sortBy && sortBy !== 'default') f.sort = sortBy as 'price_low_to_high' | 'price_high_to_low';

        // Add dates for availability filtering
        if (selectedPickupDate) {
            const year = selectedPickupDate.getFullYear();
            const month = String(selectedPickupDate.getMonth() + 1).padStart(2, '0');
            const day = String(selectedPickupDate.getDate()).padStart(2, '0');
            f.start = `${year}-${month}-${day}`;
        }
        if (selectedReturnDate) {
            const year = selectedReturnDate.getFullYear();
            const month = String(selectedReturnDate.getMonth() + 1).padStart(2, '0');
            const day = String(selectedReturnDate.getDate()).padStart(2, '0');
            f.end = `${year}-${month}-${day}`;
        }

        f.limit = ITEMS_PER_PAGE;
        f.offset = (currentPage - 1) * ITEMS_PER_PAGE;

        return f;
    }, [selectedBranch, category, debouncedSearch, sortBy, selectedPickupDate, selectedReturnDate, currentPage]);

    // Fetch vehicles
    const { data: vehiclesData, isLoading: vehiclesLoading } = useVehicles(filters);

    const vehicles = vehiclesData?.data || [];
    const vehicleCount = vehiclesData?.count || 0;

    // Handlers
    const handleBranchChange = useCallback((branch: string) => {
        setSelectedBranch(branch);
        setSearchCriteria({ branchPublicId: branch });
    }, [setSearchCriteria]);

    const handlePickupDateChange = useCallback((date: Date | undefined) => {
        setSelectedPickupDate(date || null);
        setSearchCriteria({ pickupDate: date || null });
    }, [setSearchCriteria]);

    const handleReturnDateChange = useCallback((date: Date | undefined) => {
        setSelectedReturnDate(date || null);
        setSearchCriteria({ returnDate: date || null });
    }, [setSearchCriteria]);

    const handleCategoryChange = useCallback((cat: string) => {
        setCategory(cat);
    }, []);

    const handleSortChange = useCallback((sort: string) => {
        setSortBy(sort);
    }, []);

    const handleSearchChange = useCallback((search: string) => {
        setSearchQuery(search);
    }, []);

    const handleReset = useCallback(() => {
        const defaultBranch = branches.length > 0 ? branches[0].publicId : '';
        setSelectedBranch(defaultBranch);
        setSelectedPickupDate(null);
        setSelectedReturnDate(null);
        setCategory('all');
        setSortBy('default');
        setSearchQuery('');
        setCurrentPage(1);
        resetSearch();
        if (defaultBranch) {
            setSearchCriteria({ branchPublicId: defaultBranch });
        }
    }, [branches, resetSearch, setSearchCriteria]);

    const handlePageChange = useCallback((page: number) => {
        setCurrentPage(page);
    }, []);

    return (
        <div className="min-h-screen flex flex-col bg-zinc-50 scroll-smooth">
            <Navbar />

            <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 md:py-8">
                {/* Breadcrumb */}
                <Breadcrumb className="mb-6">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link to="/" className="text-orange-500 hover:text-orange-600">
                                    Home
                                </Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Vehicles</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>

                {/* Page Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-zinc-900">
                            Select Your Vehicle
                        </h1>
                        <p className="text-zinc-500 mt-1">
                            Find the perfect vehicle for your journey
                        </p>
                    </div>
                    <div className="text-sm text-zinc-600">
                        <span className="font-bold text-orange-500 text-lg">{vehicleCount}</span>
                        {' '}Results found
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-6">
                    <VehicleFilters
                        branches={branches}
                        branchesLoading={branchesLoading}
                        selectedBranch={selectedBranch}
                        pickupDate={selectedPickupDate}
                        returnDate={selectedReturnDate}
                        category={category}
                        sortBy={sortBy}
                        searchQuery={searchQuery}
                        onBranchChange={handleBranchChange}
                        onPickupDateChange={handlePickupDateChange}
                        onReturnDateChange={handleReturnDateChange}
                        onCategoryChange={handleCategoryChange}
                        onSortChange={handleSortChange}
                        onSearchChange={handleSearchChange}
                        onReset={handleReset}
                    />
                </div>

                {/* Vehicle Grid with Pagination */}
                <VehicleGrid
                    vehicles={vehicles}
                    isLoading={vehiclesLoading || branchesLoading}
                    onReset={handleReset}
                    currentPage={currentPage}
                    totalCount={vehicleCount}
                    itemsPerPage={ITEMS_PER_PAGE}
                    onPageChange={handlePageChange}
                />
            </main>

            <Footer />
        </div>
    );
};

export default VehiclesPage;
