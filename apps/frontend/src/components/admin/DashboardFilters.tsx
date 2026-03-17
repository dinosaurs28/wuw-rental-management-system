import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";

export type DateRangePreset = "last7" | "last30" | "last90" | "custom";

interface DashboardFiltersProps {
  // Branch filter
  selectedBranch: string;
  branches: { publicId: string; name: string }[];
  onBranchChange: (branchId: string) => void;

  // Date range filter
  dateRange: { start: Date | null; end: Date | null };
  onDateRangeChange: (range: { start: Date | null; end: Date | null }) => void;

  // Category filter
  selectedCategories: string[];
  categories: { publicId: string; name: string }[];
  onCategoriesChange: (categories: string[]) => void;

  // Actions
  onApply: () => void;
  onReset: () => void;
}

export const DashboardFilters = ({
  selectedBranch,
  branches,
  onBranchChange,
  dateRange,
  onDateRangeChange,
  selectedCategories,
  categories,
  onCategoriesChange,
  onApply,
  onReset,
}: DashboardFiltersProps) => {
  const [datePreset, setDatePreset] = useState<DateRangePreset>("last30");

  const handlePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    const end = new Date();
    let start: Date | null = null;

    switch (preset) {
      case "last7":
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "last30":
        start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "last90":
        start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "custom":
        // Keep existing dates or reset
        return;
    }

    onDateRangeChange({ start, end });
  };

  const handleCategoryToggle = (categoryId: string) => {
    if (selectedCategories.includes(categoryId)) {
      onCategoriesChange(selectedCategories.filter((id) => id !== categoryId));
    } else {
      onCategoriesChange([...selectedCategories, categoryId]);
    }
  };

  const formatDateRange = () => {
    if (!dateRange.start || !dateRange.end) return "Select date range";
    return `${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}`;
  };

  return (
    <Card className="p-4 mb-6 border-neutral-200">
      <div className="space-y-4">
        {/* Filter Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">Filters</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 text-xs text-neutral-500 hover:text-neutral-900"
          >
            <X className="w-3 h-3 mr-1" />
            Reset All
          </Button>
        </div>

        {/* Filter Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Branch Filter */}
          <div>
            <label className="text-xs font-medium text-neutral-700 mb-2 block">
              Branch
            </label>
            <Select value={selectedBranch} onValueChange={onBranchChange}>
              <SelectTrigger className="h-10 bg-white border-neutral-200">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.publicId} value={b.publicId}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range Preset */}
          <div>
            <label className="text-xs font-medium text-neutral-700 mb-2 block">
              Date Range
            </label>
            <Select
              value={datePreset}
              onValueChange={(value) =>
                handlePresetChange(value as DateRangePreset)
              }
            >
              <SelectTrigger className="h-10 bg-white border-neutral-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last7">Last 7 Days</SelectItem>
                <SelectItem value="last30">Last 30 Days</SelectItem>
                <SelectItem value="last90">Last 90 Days</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom Date Pickers - Show when 'custom' is selected */}
          {datePreset === "custom" && (
            <div className="md:col-span-2 grid grid-cols-2 gap-3">
              {/* Start Date */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-2 block">
                  Start Date
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full h-10 justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange.start
                        ? format(dateRange.start, "PPP")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.start || undefined}
                      onSelect={(date) =>
                        onDateRangeChange({ ...dateRange, start: date || null })
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* End Date */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-2 block">
                  End Date
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full h-10 justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange.end
                        ? format(dateRange.end, "PPP")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.end || undefined}
                      onSelect={(date) =>
                        onDateRangeChange({ ...dateRange, end: date || null })
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Category Filter */}
          <div>
            <label className="text-xs font-medium text-neutral-700 mb-2 block">
              Categories
            </label>
            <Select
              value={selectedCategories.length > 0 ? "selected" : "all"}
              onValueChange={(value) => {
                if (value === "all") {
                  onCategoriesChange([]);
                }
              }}
            >
              <SelectTrigger className="h-10 bg-white border-neutral-200">
                <SelectValue>
                  {selectedCategories.length === 0
                    ? "All Categories"
                    : `${selectedCategories.length} Selected`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <div
                    key={cat.publicId}
                    className="flex items-center px-2 py-1.5 hover:bg-neutral-100 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      handleCategoryToggle(cat.publicId);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(cat.publicId)}
                      onChange={() => handleCategoryToggle(cat.publicId)}
                      className="mr-2"
                    />
                    <span className="text-sm">{cat.name}</span>
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Apply Button */}
          <div className="flex items-end">
            <Button
              onClick={onApply}
              className="h-10 w-full bg-[#FF5F00] hover:bg-[#E55500] text-white"
            >
              Apply Filters
            </Button>
          </div>
        </div>

        {/* Active Filters Display */}
        {(selectedCategories.length > 0 || datePreset !== "last30") && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-neutral-100">
            <span className="text-xs text-neutral-500">Active filters:</span>
            {datePreset !== "last30" && (
              <span className="inline-flex items-center px-2 py-1 rounded-md bg-orange-50 text-xs text-[#FF5F00] border border-orange-100">
                <CalendarIcon className="w-3 h-3 mr-1" />
                {datePreset === "last7" && "Last 7 Days"}
                {datePreset === "last90" && "Last 90 Days"}
                {datePreset === "custom" && formatDateRange()}
              </span>
            )}
            {selectedCategories.length > 0 && (
              <span className="inline-flex items-center px-2 py-1 rounded-md bg-neutral-100 text-xs text-neutral-700">
                {selectedCategories.length}{" "}
                {selectedCategories.length === 1 ? "Category" : "Categories"}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
