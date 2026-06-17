import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  CalendarIcon,
  Search,
  X,
  ArrowUpDown,
  MapPin,
  Clock,
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
  { value: "default", label: "Recommended" },
  { value: "price_low_to_high", label: "Price: Low to High" },
  { value: "price_high_to_low", label: "Price: High to Low" },
];

const fieldShell =
  "flex items-stretch h-[58px] rounded-[14px] border-[1.5px] border-zinc-200 bg-white overflow-hidden transition-colors focus-within:border-zinc-900";

const labelClass =
  "block text-[13px] font-bold tracking-[-0.01em] text-zinc-900 mb-2 pl-1";

const timeInputClass =
  "h-full bg-transparent border-0 text-zinc-900 font-medium text-[15px] tracking-[-0.01em] focus:outline-none w-[78px] [color-scheme:light] appearance-none cursor-pointer p-0 pr-7 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer";

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
  showBranchSelector = true,
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
    { value: "all", label: "All" },
    ...categories.map((c) => ({ value: c.publicId, label: c.name })),
  ];

  return (
    <div className="space-y-5">
      {/* Booking bar — rental criteria (branch + dates + times) */}
      <div className="bg-white rounded-[22px] border border-zinc-200 shadow-[0_1px_2px_rgba(20,20,30,0.04),0_18px_50px_-30px_rgba(20,20,30,0.18)] p-5 md:p-6">
        <div
          className={cn(
            "grid grid-cols-1 sm:grid-cols-2 gap-5 items-end",
            showBranchSelector
              ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_auto]"
              : "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_auto]",
          )}
        >
          {/* Branch */}
          {showBranchSelector && (
            <div className="w-full">
              <label className={labelClass}>Branch</label>
              <Select
                value={selectedBranch}
                onValueChange={onBranchChange}
                disabled={branchesLoading}
              >
                <SelectTrigger className="w-full h-[58px] data-[size=default]:h-[58px] bg-white border-[1.5px] border-zinc-200 rounded-[14px] px-5 font-medium text-zinc-900 hover:border-zinc-300 focus:border-zinc-900 shadow-none focus:ring-0 focus:ring-offset-0">
                  <div className="flex items-center gap-3 overflow-hidden text-[15px]">
                    <MapPin className="size-[18px] text-zinc-500 shrink-0" strokeWidth={2} />
                    <SelectValue
                      placeholder={branchesLoading ? "Loading..." : "Select branch"}
                    />
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-zinc-200 bg-white text-zinc-900 shadow-2xl">
                  {branches.map((branch) => (
                    <SelectItem
                      key={branch.publicId}
                      value={branch.publicId}
                      className="focus:bg-zinc-100 focus:text-zinc-900 rounded-xl mx-1 my-0.5 cursor-pointer py-2.5 font-medium"
                    >
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Pickup date + time */}
          <div className="w-full">
            <label className={labelClass}>Pick-up date</label>
            <div className={fieldShell}>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      "flex items-center gap-3 flex-1 min-w-0 h-full rounded-none justify-start px-4 bg-transparent hover:bg-[#fafafb] border-0 shadow-none font-medium",
                      !pickupDate ? "text-[#8a8a93]" : "text-zinc-900",
                    )}
                  >
                    <CalendarIcon className="size-[18px] shrink-0 text-zinc-900" strokeWidth={1.8} />
                    <span className="text-[15px] font-medium truncate">
                      {pickupDate ? format(pickupDate, "MMM dd") : "Select"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-2xl border-zinc-200 bg-white shadow-2xl" align="start">
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
              <div className="h-full w-[1.5px] bg-zinc-200 shrink-0" />
              <div className="relative flex items-center h-full px-3 hover:bg-[#fafafb] transition-colors shrink-0">
                <input
                  type="time"
                  value={pickupTime || "10:00"}
                  onChange={(e) => onPickupTimeChange?.(e.target.value)}
                  className={timeInputClass}
                />
                <Clock className="size-[15px] shrink-0 text-zinc-900 pointer-events-none absolute right-3" strokeWidth={2} />
              </div>
            </div>
          </div>

          {/* Return date + time */}
          <div className="w-full">
            <label className={labelClass}>Return date</label>
            <div className={fieldShell}>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      "flex items-center gap-3 flex-1 min-w-0 h-full rounded-none justify-start px-4 bg-transparent hover:bg-[#fafafb] border-0 shadow-none font-medium",
                      !returnDate ? "text-[#8a8a93]" : "text-zinc-900",
                    )}
                  >
                    <CalendarIcon className="size-[18px] shrink-0 text-zinc-900" strokeWidth={1.8} />
                    <span className="text-[15px] font-medium truncate">
                      {returnDate ? format(returnDate, "MMM dd") : "Select"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-2xl border-zinc-200 bg-white shadow-2xl" align="start">
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
              <div className="h-full w-[1.5px] bg-zinc-200 shrink-0" />
              <div className="relative flex items-center h-full px-3 hover:bg-[#fafafb] transition-colors shrink-0">
                <input
                  type="time"
                  value={returnTime || "10:00"}
                  onChange={(e) => onReturnTimeChange?.(e.target.value)}
                  className={timeInputClass}
                />
                <Clock className="size-[15px] shrink-0 text-zinc-900 pointer-events-none absolute right-3" strokeWidth={2} />
              </div>
            </div>
          </div>

          {/* Reset */}
          <div className="w-full lg:w-auto">
            <Button
              variant="ghost"
              onClick={() => {
                setLocalSearch("");
                onReset();
              }}
              className="h-[58px] w-full lg:w-auto px-6 rounded-[14px] text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 font-semibold transition-colors"
            >
              <X className="size-4 mr-1.5" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Toolbar — sort + category pills + search */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:justify-between">
        {/* Sort + category pills */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger className="h-[52px] data-[size=default]:h-[52px] w-auto gap-2 bg-[#f3f3f5] border-0 text-zinc-900 rounded-full px-5 font-semibold text-[15px] hover:bg-[#e9e9ec] shadow-none focus:ring-0 focus:ring-offset-0">
              <ArrowUpDown className="size-[17px] text-zinc-700 shrink-0" strokeWidth={2} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-zinc-200 bg-white text-zinc-900 shadow-2xl">
              {SORT_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className="focus:bg-zinc-100 focus:text-zinc-900 rounded-xl mx-1 my-0.5 cursor-pointer py-2.5 font-medium"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="h-7 w-px bg-zinc-200 mx-1 hidden sm:block" />

          {categoriesLoading ? (
            <span className="text-[15px] font-semibold text-zinc-400 px-2">
              Loading categories…
            </span>
          ) : (
            categoryOptions.map((cat) => {
              const active = category === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => onCategoryChange(cat.value)}
                  className={cn(
                    "h-[52px] px-6 rounded-full text-[15px] font-semibold tracking-[-0.01em] transition-colors whitespace-nowrap",
                    active
                      ? "bg-zinc-900 text-white"
                      : "bg-[#f3f3f5] text-zinc-900 hover:bg-[#e9e9ec]",
                  )}
                >
                  {cat.label}
                </button>
              );
            })
          )}
        </div>

        {/* Search */}
        <div className="relative w-full lg:w-[320px] shrink-0">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 size-[18px] text-zinc-400" />
          <Input
            type="text"
            placeholder="Search make or model…"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="h-[52px] pl-12 pr-11 bg-white border-[1.5px] border-zinc-200 text-zinc-900 rounded-full hover:border-zinc-300 focus-visible:border-zinc-900 focus-visible:ring-0 focus-visible:ring-offset-0 transition-colors placeholder:text-zinc-400 text-[15px] font-medium"
          />
          {localSearch && (
            <button
              onClick={() => {
                setLocalSearch("");
                onSearchChange("");
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-900 transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
