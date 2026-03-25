import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  CalendarIcon,
  Search,
  X,
  ArrowUpDown,
  Grid3X3,
  MapPin,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface VehicleFiltersProps {
  branches: { publicId: string; name: string }[];
  branchesLoading: boolean;
  categories?: { publicId: string; name: string }[];
  categoriesLoading?: boolean;
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
  showBranchSelector?: boolean; // Optional, defaults to true
  pickupTime?: string;
  returnTime?: string;
  onPickupTimeChange?: (time: string) => void;
  onReturnTimeChange?: (time: string) => void;
}

const SORT_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "price_low_to_high", label: "Price: Low to High" },
  { value: "price_high_to_low", label: "Price: High to Low" },
];

export const VehicleFilters = ({
  branches,
  branchesLoading,
  categories = [],
  categoriesLoading = false,
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
  showBranchSelector = true, // Default to true for backward compatibility
  pickupTime,
  returnTime,
  onPickupTimeChange,
  onReturnTimeChange,
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

  const categoryOptions = [
    { value: "all", label: "All Categories" },
    ...categories.map((category) => ({
      value: category.publicId,
      label: category.name,
    })),
  ];

  return (
    <div className="bg-white rounded-[2rem] border border-zinc-200 shadow-2xl p-6 md:p-8 relative overflow-hidden">
      {/* Subtle Inner Glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent pointer-events-none" />

      {/* Main Filter Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 gap-6 relative z-10">
        {/* Branch Selector */}
        {showBranchSelector && (
          <div className="w-full">
            <label className="block text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-3 ml-2">
              Branch
            </label>
            <Select
              value={selectedBranch}
              onValueChange={onBranchChange}
              disabled={branchesLoading}
            >
              <SelectTrigger className="h-14 w-full bg-white border-zinc-200 text-zinc-900 rounded-full hover:bg-zinc-100 hover:border-zinc-300 transition-all px-5">
                <div className="flex items-center gap-3 overflow-hidden">
                  <MapPin className="size-4 text-zinc-400 shrink-0" />
                  <SelectValue
                    placeholder={
                      branchesLoading ? "Loading..." : "Select branch"
                    }
                  />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-zinc-200 bg-white text-zinc-900 shadow-2xl">
                {branches.map((branch) => (
                  <SelectItem
                    key={branch.publicId}
                    value={branch.publicId}
                    className="focus:bg-zinc-100 focus:text-zinc-900 rounded-xl mx-1 my-1 cursor-pointer py-3"
                  >
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Pickup Date */}
        <div className="w-full">
          <label className="block text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-3 ml-2">
            Pickup Date
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-14 w-full justify-start text-left font-medium bg-white border-zinc-200 text-zinc-900 rounded-full hover:bg-zinc-100 hover:border-zinc-300 transition-all px-5",
                  !pickupDate && "text-zinc-500 hover:text-zinc-900",
                )}
              >
                <CalendarIcon className="mr-3 size-4 text-zinc-400 shrink-0" />
                <span className="truncate">
                  {pickupDate
                    ? format(pickupDate, "MMM dd, yyyy")
                    : "Select date"}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-0 rounded-2xl border-zinc-200 bg-white text-zinc-900 shadow-2xl"
              align="start"
            >
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

        {/* Pickup Time */}
        <div className="w-full">
          <label className="block text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-3 ml-2">
            Pickup Time
          </label>
          <input
            type="time"
            value={pickupTime || "10:00"}
            onChange={(e) => onPickupTimeChange?.(e.target.value)}
            className="h-14 w-full bg-white border border-zinc-200 text-zinc-900 rounded-full px-5 focus:outline-none focus:border-zinc-300 transition-all"
          />
        </div>

        {/* Return Date */}
        <div className="w-full">
          <label className="block text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-3 ml-2">
            Return Date
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-14 w-full justify-start text-left font-medium bg-white border-zinc-200 text-zinc-900 rounded-full hover:bg-zinc-100 hover:border-zinc-300 transition-all px-5",
                  !returnDate && "text-zinc-500 hover:text-zinc-900",
                )}
              >
                <CalendarIcon className="mr-3 size-4 text-zinc-400 shrink-0" />
                <span className="truncate">
                  {returnDate
                    ? format(returnDate, "MMM dd, yyyy")
                    : "Select date"}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-0 rounded-2xl border-zinc-200 bg-white text-zinc-900 shadow-2xl"
              align="start"
            >
              <Calendar
                mode="single"
                selected={returnDate || undefined}
                onSelect={onReturnDateChange}
                disabled={(date) =>
                  pickupDate ? date < pickupDate : date < new Date()
                }
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Return Time */}
        <div className="w-full">
          <label className="block text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-3 ml-2">
            Return Time
          </label>
          <input
            type="time"
            value={returnTime || "10:00"}
            onChange={(e) => onReturnTimeChange?.(e.target.value)}
            className="h-14 w-full bg-white border border-zinc-200 text-zinc-900 rounded-full px-5 focus:outline-none focus:border-zinc-300 transition-all"
          />
        </div>

        {/* Category */}
        <div className="w-full">
          <label className="block text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-3 ml-2">
            Category
          </label>
          <Select
            value={category}
            onValueChange={onCategoryChange}
            disabled={categoriesLoading}
          >
            <SelectTrigger className="h-14 w-full bg-white border-zinc-200 text-zinc-900 rounded-full hover:bg-zinc-100 hover:border-zinc-300 transition-all px-5">
              <div className="flex items-center gap-3 overflow-hidden">
                <Grid3X3 className="size-4 text-zinc-400 shrink-0" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-zinc-200 bg-white text-zinc-900 shadow-2xl">
              {categoryOptions.map((cat) => (
                <SelectItem
                  key={cat.value}
                  value={cat.value}
                  className="focus:bg-zinc-100 focus:text-zinc-900 rounded-xl mx-1 my-1 cursor-pointer py-3"
                >
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sort */}
        <div className="w-full">
          <label className="block text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-3 ml-2">
            Sort By
          </label>
          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger className="h-14 w-full bg-white border-zinc-200 text-zinc-900 rounded-full hover:bg-zinc-100 hover:border-zinc-300 transition-all px-5">
              <div className="flex items-center gap-3 overflow-hidden">
                <ArrowUpDown className="size-4 text-zinc-400 shrink-0" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-zinc-200 bg-white text-zinc-900 shadow-2xl">
              {SORT_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className="focus:bg-zinc-100 focus:text-zinc-900 rounded-xl mx-1 my-1 cursor-pointer py-3"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Search and Reset Row */}
      <div className="flex flex-col sm:flex-row gap-4 mt-8 pt-8 border-t border-zinc-200 relative z-10">
        {/* Search Input */}
        <div className="flex-1 relative">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 size-5 text-zinc-400" />
          <Input
            type="text"
            placeholder="Search by make or model..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="h-14 pl-14 bg-white border-zinc-200 text-zinc-900 rounded-full focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:border-zinc-300 transition-all placeholder:text-zinc-400 text-base"
          />
          {localSearch && (
            <button
              onClick={() => {
                setLocalSearch("");
                onSearchChange("");
              }}
              className="absolute right-5 top-1/2 -translate-y-1/2 p-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-full text-zinc-400 hover:text-zinc-900 transition-all"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Reset Button */}
        <Button
          variant="outline"
          onClick={() => {
            setLocalSearch("");
            onReset();
          }}
          className="h-14 px-8 border-zinc-200 bg-transparent text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 rounded-full font-bold tracking-wide transition-all"
        >
          <X className="size-4 mr-2" />
          Reset
        </Button>
      </div>
    </div>
  );
};
