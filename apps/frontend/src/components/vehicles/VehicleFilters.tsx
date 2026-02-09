import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Search, X, ArrowUpDown, Grid3X3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface VehicleFiltersProps {
    branches: { publicId: string; name: string }[];
    branchesLoading: boolean;
    selectedBranch: string;
    pickupDate: Date | null;
    returnDate: Date | null;
    category: string;
    sortBy: string;
    searchQuery: string;
    onBranchChange: (branch: string) => void;
    onPickupDateChange: (date: Date | undefined) => void;
    onReturnDateChange: (date: Date | undefined) => void;
    onCategoryChange: (category: string) => void;
    onSortChange: (sort: string) => void;
    onSearchChange: (search: string) => void;
    onReset: () => void;
}

const CATEGORIES = [
    { value: 'all', label: 'All Categories' },
    { value: 'f86rdkaslieo00f4', label: 'Two Wheeler' },
    { value: 'ekdg8blyaz27a3bv', label: 'Four Wheeler' },
];

const SORT_OPTIONS = [
    { value: 'default', label: 'Default' },
    { value: 'price_low_to_high', label: 'Price: Low to High' },
    { value: 'price_high_to_low', label: 'Price: High to Low' },
];

export const VehicleFilters = ({
    branches,
    branchesLoading,
    selectedBranch,
    pickupDate,
    returnDate,
    category,
    sortBy,
    searchQuery,
    onBranchChange,
    onPickupDateChange,
    onReturnDateChange,
    onCategoryChange,
    onSortChange,
    onSearchChange,
    onReset,
}: VehicleFiltersProps) => {
    // Local state for immediate input response
    const [localSearch, setLocalSearch] = useState(searchQuery);

    // Sync local state when prop changes (e.g. reset)
    useEffect(() => {
        setLocalSearch(searchQuery);
    }, [searchQuery]);

    // Debounce calls to onSearchChange
    useEffect(() => {
        const timer = setTimeout(() => {
            if (localSearch !== searchQuery) {
                onSearchChange(localSearch);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [localSearch, onSearchChange, searchQuery]);

    return (
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-4 md:p-6">
            {/* Main Filter Row */}
            <div className="flex flex-col lg:flex-row gap-4">

                {/* Branch Selector */}
                <div className="w-full sm:w-auto lg:w-[180px]">
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                        Branch
                    </label>
                    <Select value={selectedBranch} onValueChange={onBranchChange} disabled={branchesLoading}>
                        <SelectTrigger className="h-11 w-full bg-zinc-50 border-zinc-200 rounded-lg">
                            <div className="flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0">
                                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                                    <circle cx="12" cy="10" r="3" />
                                </svg>
                                <SelectValue placeholder={branchesLoading ? "Loading..." : "Select branch"} />
                            </div>
                        </SelectTrigger>
                        <SelectContent className="rounded-lg">
                            {branches.map((branch) => (
                                <SelectItem key={branch.publicId} value={branch.publicId}>
                                    {branch.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Pickup Date */}
                <div className="w-full sm:w-auto lg:w-[160px]">
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                        Pickup Date
                    </label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                className={cn(
                                    "h-11 w-full justify-start text-left font-medium bg-zinc-50 border border-zinc-200 rounded-lg hover:bg-zinc-100",
                                    !pickupDate && "text-zinc-500"
                                )}
                            >
                                <CalendarIcon className="mr-2 size-4 text-zinc-400" />
                                {pickupDate ? format(pickupDate, "MMM dd, yyyy") : "Select date"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 rounded-lg" align="start">
                            <Calendar
                                mode="single"
                                selected={pickupDate || undefined}
                                onSelect={onPickupDateChange}
                                disabled={(date) => {
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    return date < today;
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Return Date */}
                <div className="w-full sm:w-auto lg:w-[160px]">
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                        Return Date
                    </label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                className={cn(
                                    "h-11 w-full justify-start text-left font-medium bg-zinc-50 border border-zinc-200 rounded-lg hover:bg-zinc-100",
                                    !returnDate && "text-zinc-500"
                                )}
                            >
                                <CalendarIcon className="mr-2 size-4 text-zinc-400" />
                                {returnDate ? format(returnDate, "MMM dd, yyyy") : "Select date"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 rounded-lg" align="start">
                            <Calendar
                                mode="single"
                                selected={returnDate || undefined}
                                onSelect={onReturnDateChange}
                                disabled={(date) =>
                                    (pickupDate ? date < pickupDate : date < new Date())
                                }
                            />
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Category */}
                <div className="w-full sm:w-auto lg:w-[160px]">
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                        Category
                    </label>
                    <Select value={category} onValueChange={onCategoryChange}>
                        <SelectTrigger className="h-11 w-full bg-zinc-50 border-zinc-200 rounded-lg">
                            <div className="flex items-center gap-2">
                                <Grid3X3 className="size-4 text-zinc-400 shrink-0" />
                                <SelectValue />
                            </div>
                        </SelectTrigger>
                        <SelectContent className="rounded-lg">
                            {CATEGORIES.map((cat) => (
                                <SelectItem key={cat.value} value={cat.value}>
                                    {cat.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Sort */}
                <div className="w-full sm:w-auto lg:w-[180px]">
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                        Sort By
                    </label>
                    <Select value={sortBy} onValueChange={onSortChange}>
                        <SelectTrigger className="h-11 w-full bg-zinc-50 border-zinc-200 rounded-lg">
                            <div className="flex items-center gap-2">
                                <ArrowUpDown className="size-4 text-zinc-400 shrink-0" />
                                <SelectValue />
                            </div>
                        </SelectTrigger>
                        <SelectContent className="rounded-lg">
                            {SORT_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Search and Reset Row */}
            <div className="flex flex-col sm:flex-row gap-4 mt-4 pt-4 border-t border-zinc-100">
                {/* Search Input */}
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                    <Input
                        type="text"
                        placeholder="Search by make or model..."
                        value={localSearch}
                        onChange={(e) => setLocalSearch(e.target.value)}
                        className="h-11 pl-10 bg-zinc-50 border-zinc-200 rounded-lg focus:ring-orange-500 focus:border-orange-500"
                    />
                    {localSearch && (
                        <button
                            onClick={() => {
                                setLocalSearch('');
                                onSearchChange('');
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                        >
                            <X className="size-4" />
                        </button>
                    )}
                </div>

                {/* Reset Button */}
                <Button
                    variant="outline"
                    onClick={() => {
                        setLocalSearch('');
                        onReset();
                    }}
                    className="h-11 border-zinc-200 text-zinc-600 hover:bg-zinc-50 rounded-lg font-semibold"
                >
                    <X className="size-4 mr-2" />
                    Reset Filters
                </Button>
            </div>
        </div>
    );
};
