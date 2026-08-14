import { useState, useEffect } from "react";
import { Calendar, TrendingUp, Car, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { ExportButton } from "@/components/ui/ExportButton";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { formatDate } from "@/utils/formatters";
import {
  getDateRangeFromPreset,
  type DateRangePreset,
} from "@/utils/exportHelpers";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { adminService } from "@/services/admin.service";

// ============================================================================
// Types
// ============================================================================

interface VehicleAvailability {
  vehicleId: string;
  regNo: string;
  make: string;
  model: string;
  vehicleName: string;
  category: string;
  branch: string;
  status: string;
  currentStatus: string;
  totalDays: number;
  bookedDays: number;
  availableDays: number;
  freeDays: number;
  utilizationRate: number;
  nextAvailableFrom: string;
  bookedDatesInRange: string;
  bookings: Array<{
    bookingId: string;
    customerName: string;
    customerPhone: string;
    startDate: string;
    endDate: string;
    status: string;
    days: number;
  }>;
}

// currentStatus arrives as a display label ("Available" | "Booked" | "Maintenance").
// StatusBadge keys its colors off enum values and re-runs the text through
// formatStatus, so we keep the label as the text (renders as-is) and override
// the color via className.
const STATUS_BADGE_CLASS: Record<string, string> = {
  Available: "bg-green-100 text-green-800 border-green-200",
  Booked: "bg-blue-100 text-blue-800 border-blue-200",
  Maintenance: "bg-orange-100 text-orange-800 border-orange-200",
};

interface CategoryBreakdown {
  category: string;
  total: number;
  available: number;
  rented: number;
  maintenance: number;
  inactive: number;
  avgUtilization: number;
}

interface AvailabilityReportData {
  metadata: {
    generatedAt: string;
    dateRange: {
      startDate: string;
      endDate: string;
    };
    branch: string;
    availableOnly?: boolean;
  };
  summary: {
    totalVehicles: number;
    currentlyAvailable: number;
    currentlyRented: number;
    inMaintenance: number;
    inactive: number;
    upcomingBookings: number;
    overallUtilization: number;
    dateRange: {
      startDate: string;
      endDate: string;
      totalDays: number;
    };
  };
  categoryBreakdown: CategoryBreakdown[];
  vehicles: VehicleAvailability[];
}

// ============================================================================
// Vehicle Availability Report Component
// ============================================================================

export const VehicleAvailabilityReport = () => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [availableOnly, setAvailableOnly] = useState<boolean>(false);
  const [reportData, setReportData] = useState<AvailabilityReportData | null>(
    null,
  );
  const [branches, setBranches] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [categories, setCategories] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch branches + categories on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Initialize date range from preset
  useEffect(() => {
    if (dateRangePreset !== "custom") {
      const { startDate: start, endDate: end } =
        getDateRangeFromPreset(dateRangePreset);
      setStartDate(start);
      setEndDate(end);
    }
  }, [dateRangePreset]);

  // Fetch report data when filters change
  useEffect(() => {
    if (startDate && endDate) {
      fetchReportData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, selectedBranch, selectedCategory, availableOnly]);

  const fetchFilterOptions = async () => {
    try {
      const [branchData, categoryData] = await Promise.all([
        adminService.getBranches(),
        adminService.getCategories(),
      ]);
      setBranches(
        branchData.map((branch: any) => ({
          value: branch.publicId,
          label: branch.name,
        })),
      );
      setCategories(
        categoryData.map((category) => ({
          value: category.publicId,
          label: category.name,
        })),
      );
    } catch (error) {
      console.error("Failed to fetch filter options:", error);
    }
  };

  const fetchReportData = async () => {
    if (!startDate || !endDate) return;

    setIsLoading(true);
    try {
      const params: Record<string, any> = {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      };

      if (selectedBranch !== "all") {
        params.branchId = selectedBranch;
      }

      if (selectedCategory !== "all") {
        params.categories = selectedCategory;
      }

      if (availableOnly) {
        params.availableOnly = "true";
      }

      const result = await adminService.getVehicleAvailabilityReport(
        params as any,
      );
      setReportData(result.data);
    } catch (error) {
      console.error("Error fetching report:", error);
      toast.error(
        "Failed to load vehicle availability report. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyFilters = () => {
    fetchReportData();
  };

  const handleResetFilters = () => {
    setDateRangePreset("30days");
    setSelectedBranch("all");
    setSelectedCategory("all");
    setAvailableOnly(false);
  };

  const getExportUrl = () => {
    if (!startDate || !endDate) return "";

    const params: Record<string, any> = {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };

    if (selectedBranch !== "all") {
      params.branchId = selectedBranch;
    }

    if (selectedCategory !== "all") {
      params.categories = selectedCategory;
    }

    if (availableOnly) {
      params.availableOnly = "true";
    }

    const queryString = new URLSearchParams(params).toString();
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/vehicle-availability?${queryString}`;
  };

  // Table columns (spec §4.6 order)
  const columns: ColumnDef<VehicleAvailability>[] = [
    {
      accessorKey: "regNo",
      header: "Vehicle Reg No",
      cell: ({ row }) => (
        <div className="font-medium font-mono">{row.original.regNo}</div>
      ),
    },
    {
      accessorKey: "vehicleName",
      header: "Vehicle Name",
      cell: ({ row }) => (
        <div className="text-sm">{row.original.vehicleName}</div>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => <div className="text-sm">{row.original.category}</div>,
    },
    {
      accessorKey: "branch",
      header: "Branch",
      cell: ({ row }) => <div className="text-sm">{row.original.branch}</div>,
    },
    {
      accessorKey: "currentStatus",
      header: "Current Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.currentStatus}
          className={STATUS_BADGE_CLASS[row.original.currentStatus]}
        />
      ),
    },
    {
      accessorKey: "nextAvailableFrom",
      header: "Next Available From",
      cell: ({ row }) => (
        <div className="text-sm">
          {row.original.currentStatus === "Available"
            ? "Available"
            : formatDate(row.original.nextAvailableFrom)}
        </div>
      ),
    },
    {
      accessorKey: "bookedDatesInRange",
      header: "Booked Dates in Range",
      cell: ({ row }) => (
        <div className="text-sm text-gray-600">
          {row.original.bookedDatesInRange || "—"}
        </div>
      ),
    },
    {
      accessorKey: "bookedDays",
      header: "Total Booked Days",
      cell: ({ row }) => (
        <div className="text-sm font-semibold">{row.original.bookedDays}</div>
      ),
    },
    {
      accessorKey: "freeDays",
      header: "Total Free Days",
      cell: ({ row }) => (
        <div className="text-sm font-semibold">{row.original.freeDays}</div>
      ),
    },
  ];

  // Category breakdown chart data
  const categoryChartData =
    reportData?.categoryBreakdown.map((item) => ({
      name: item.category,
      available: item.available,
      rented: item.rented,
      maintenance: item.maintenance,
    })) || [];

  // Status distribution pie chart
  const statusDistribution = [
    {
      name: "Available",
      value: reportData?.summary.currentlyAvailable || 0,
      color: "#10B981",
    },
    {
      name: "Booked",
      value: reportData?.summary.currentlyRented || 0,
      color: "#FF5F00",
    },
    {
      name: "Maintenance",
      value: reportData?.summary.inMaintenance || 0,
      color: "#F59E0B",
    },
  ];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="h-8 w-8 text-orange-500" />
            Vehicle Availability Report
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {startDate && endDate
              ? `${formatDate(startDate)} - ${formatDate(endDate)}`
              : "Select date range to view report"}
          </p>
        </div>

        <ExportButton
          apiUrl={getExportUrl()}
          filename={`vehicle-availability-${startDate?.toISOString().split("T")[0]}-${endDate?.toISOString().split("T")[0]}`}
          disabled={isLoading || !reportData}
        />
      </div>

      {/* Filters */}
      <FilterPanel
        dateRangePreset={dateRangePreset}
        onDateRangePresetChange={setDateRangePreset}
        startDate={startDate}
        endDate={endDate}
        onDateChange={(start, end) => {
          setStartDate(start);
          setEndDate(end);
        }}
        showBranchFilter
        branches={branches}
        selectedBranch={selectedBranch}
        onBranchChange={setSelectedBranch}
        showCategoryFilter
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      >
        {/* Show Only Available toggle (sent as availableOnly) */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Availability</label>
          <div className="flex h-9 items-center gap-2">
            <Checkbox
              id="availableOnly"
              checked={availableOnly}
              onCheckedChange={(checked) => setAvailableOnly(checked === true)}
            />
            <label
              htmlFor="availableOnly"
              className="text-sm font-normal cursor-pointer select-none"
            >
              Show Only Available
            </label>
          </div>
        </div>
      </FilterPanel>

      {/* Summary Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-orange-500" />
          Fleet Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Vehicles"
            value={reportData?.summary.totalVehicles.toString() || "0"}
            icon={Car}
            variant="default"
            isLoading={isLoading}
          />
          <MetricCard
            title="Currently Available"
            value={reportData?.summary.currentlyAvailable.toString() || "0"}
            icon={Car}
            variant="fleet"
            isLoading={isLoading}
          />
          <MetricCard
            title="Currently Booked"
            value={reportData?.summary.currentlyRented.toString() || "0"}
            icon={Car}
            variant="bookings"
            isLoading={isLoading}
          />
          <MetricCard
            title="Overall Utilization"
            value={`${reportData?.summary.overallUtilization.toFixed(1) || "0.0"}%`}
            icon={TrendingUp}
            variant="revenue"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              Fleet Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusDistribution.some((item) => item.value > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-gray-500">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Category Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Availability by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            {categoryChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={categoryChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="available"
                    stackId="a"
                    fill="#10B981"
                    name="Available"
                  />
                  <Bar
                    dataKey="rented"
                    /* label aligned with table's "Booked" status */
                    stackId="a"
                    fill="#FF5F00"
                    name="Booked"
                  />
                  <Bar
                    dataKey="maintenance"
                    stackId="a"
                    fill="#F59E0B"
                    name="Maintenance"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-gray-500">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vehicle List Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Car className="h-5 w-5 text-orange-500" />
            Vehicle Availability Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={reportData?.vehicles || []}
            isLoading={isLoading}
            emptyMessage="No vehicles found for the selected filters"
          />
        </CardContent>
      </Card>
    </div>
  );
};
