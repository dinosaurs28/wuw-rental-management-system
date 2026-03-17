import { useState } from "react";
import { Calendar, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/formatters";
import {
  getDateRangeFromPreset,
  type DateRangePreset,
} from "@/utils/exportHelpers";

// ============================================================================
// FilterPanel Component
// ============================================================================

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterPanelProps {
  // Date range preset filter
  dateRangePreset?: DateRangePreset;
  onDateRangePresetChange?: (preset: DateRangePreset) => void;

  // Custom date range (when preset is 'custom')
  startDate?: Date;
  endDate?: Date;
  onDateChange?: (
    startDate: Date | undefined,
    endDate: Date | undefined,
  ) => void;

  // Branch filter
  showBranchFilter?: boolean;
  branches?: FilterOption[];
  selectedBranch?: string;
  onBranchChange?: (branchId: string) => void;

  // Status filter
  showStatusFilter?: boolean;
  statuses?: FilterOption[];
  selectedStatus?: string;
  onStatusChange?: (status: string) => void;

  // Category filter
  showCategoryFilter?: boolean;
  categories?: FilterOption[];
  selectedCategory?: string;
  onCategoryChange?: (categoryId: string) => void;

  // Actions
  onApply?: () => void;
  onReset?: () => void;

  className?: string;
  children?: React.ReactNode;
}

export const FilterPanel = ({
  dateRangePreset = "current",
  onDateRangePresetChange,
  startDate,
  endDate,
  onDateChange,
  showBranchFilter = true,
  branches = [],
  selectedBranch,
  onBranchChange,
  showStatusFilter = false,
  statuses = [],
  selectedStatus,
  onStatusChange,
  showCategoryFilter = false,
  categories = [],
  selectedCategory,
  onCategoryChange,
  onApply,
  onReset,
  className,
  children,
}: FilterPanelProps) => {
  const [localStartDate, setLocalStartDate] = useState<Date | undefined>(
    startDate,
  );
  const [localEndDate, setLocalEndDate] = useState<Date | undefined>(endDate);

  const handleDateRangePresetChange = (preset: string) => {
    const presetValue = preset as DateRangePreset;
    onDateRangePresetChange?.(presetValue);

    if (presetValue !== "custom") {
      const { startDate, endDate } = getDateRangeFromPreset(presetValue);
      setLocalStartDate(startDate);
      setLocalEndDate(endDate);
      onDateChange?.(startDate, endDate);
    }
  };

  const handleReset = () => {
    setLocalStartDate(undefined);
    setLocalEndDate(undefined);
    onReset?.();
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="h-4 w-4 text-orange-500" />
            <h3 className="text-sm font-semibold">Filters</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Date Range Preset */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Date Range</label>
              <Select
                value={dateRangePreset}
                onValueChange={handleDateRangePresetChange}
              >
                <SelectTrigger>
                  <Calendar className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current (Today)</SelectItem>
                  <SelectItem value="15days">Last 15 Days</SelectItem>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                  <SelectItem value="60days">Last 60 Days</SelectItem>
                  <SelectItem value="90days">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Date Range (shown only when preset is 'custom') */}
            {dateRangePreset === "custom" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Start Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !localStartDate && "text-muted-foreground",
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {localStartDate
                          ? formatDate(localStartDate)
                          : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <CalendarComponent
                        mode="single"
                        selected={localStartDate}
                        onSelect={(date) => {
                          setLocalStartDate(date);
                          onDateChange?.(date, localEndDate);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !localEndDate && "text-muted-foreground",
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {localEndDate
                          ? formatDate(localEndDate)
                          : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <CalendarComponent
                        mode="single"
                        selected={localEndDate}
                        onSelect={(date) => {
                          setLocalEndDate(date);
                          onDateChange?.(localStartDate, date);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}

            {/* Branch Filter */}
            {showBranchFilter && branches.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Branch</label>
                <Select value={selectedBranch} onValueChange={onBranchChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.value} value={branch.value}>
                        {branch.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Status Filter */}
            {showStatusFilter && statuses.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={selectedStatus} onValueChange={onStatusChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {statuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Category Filter */}
            {showCategoryFilter && categories.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={selectedCategory}
                  onValueChange={onCategoryChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.value} value={category.value}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Custom Filters (Children) */}
            {children}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              <X className="mr-2 h-4 w-4" />
              Reset
            </Button>
            {onApply && (
              <Button size="sm" onClick={onApply}>
                <Filter className="mr-2 h-4 w-4" />
                Apply Filters
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
