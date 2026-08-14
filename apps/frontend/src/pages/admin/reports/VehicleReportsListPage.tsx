import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Car, FileText, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { ExportButton } from "@/components/ui/ExportButton";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCurrency, formatDate, abbreviateAmount } from "@/utils/formatters";
import {
  getDateRangeFromPreset,
  type DateRangePreset,
} from "@/utils/exportHelpers";
import { toast } from "sonner";
import { adminService } from "@/services/admin.service";
import type { ColumnDef } from "@tanstack/react-table";

// ============================================================================
// Vehicle Reports — per-vehicle list (spec §4.5)
// ============================================================================

interface VehicleReportRow {
  vehicleId: string;
  regNo: string;
  vehicleName: string;
  category: string;
  branch: string;
  totalBookings: number;
  totalRevenue: number;
  utilisation: number;
  avgBookingDuration: number;
  status: string;
}

interface VehicleReportSummary {
  totalVehicles: number;
  totalBookings: number;
  totalRevenue: number;
  averageUtilisation: number;
}

interface VehicleReportData {
  summary: VehicleReportSummary;
  data: VehicleReportRow[];
}

const VEHICLE_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
];

export const VehicleReportsListPage = () => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("active");
  const [reportData, setReportData] = useState<VehicleReportData | null>(null);
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
  }, [startDate, endDate, selectedBranch, selectedCategory, selectedStatus]);

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

  const buildParams = (): Record<string, string> => {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate.toISOString().split("T")[0];
    if (endDate) params.endDate = endDate.toISOString().split("T")[0];
    if (selectedBranch !== "all") params.branchId = selectedBranch;
    if (selectedCategory !== "all") params.categories = selectedCategory;
    if (selectedStatus !== "all") params.vehicleStatus = selectedStatus;
    return params;
  };

  const fetchReportData = async () => {
    if (!startDate || !endDate) return;

    setIsLoading(true);
    try {
      const result = await adminService.getVehicleReportList(buildParams());
      setReportData(result.data);
    } catch (error) {
      console.error("Error fetching vehicle report:", error);
      toast.error("Failed to load vehicle report. Please try again.");
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
    setSelectedStatus("active");
  };

  const getExportUrl = () => {
    if (!startDate || !endDate) return "";
    const queryString = new URLSearchParams(buildParams()).toString();
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/vehicles?${queryString}`;
  };

  // Table columns — spec §4.5 order
  const columns: ColumnDef<VehicleReportRow>[] = [
    {
      accessorKey: "regNo",
      header: "Vehicle Reg No",
      cell: ({ row }) =>
        row.original.vehicleId ? (
          <Link
            to={`/admin/reports/vehicle/${row.original.vehicleId}`}
            className="font-mono text-sm font-medium text-orange-600 hover:underline"
          >
            {row.original.regNo}
          </Link>
        ) : (
          <div className="font-mono text-sm">{row.original.regNo}</div>
        ),
    },
    {
      accessorKey: "vehicleName",
      header: "Vehicle Name",
      cell: ({ row }) => (
        <div className="font-medium">{row.original.vehicleName}</div>
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
      accessorKey: "totalBookings",
      header: "Total Bookings",
      cell: ({ row }) => (
        <div className="text-sm">{row.original.totalBookings}</div>
      ),
    },
    {
      accessorKey: "totalRevenue",
      header: "Total Revenue",
      cell: ({ row }) => (
        <div className="font-semibold font-mono">
          {formatCurrency(row.original.totalRevenue)}
        </div>
      ),
    },
    {
      accessorKey: "utilisation",
      header: "Utilisation %",
      cell: ({ row }) => (
        <div className="text-sm">{row.original.utilisation}%</div>
      ),
    },
    {
      accessorKey: "avgBookingDuration",
      header: "Avg Booking Duration",
      cell: ({ row }) => (
        <div className="text-sm">{row.original.avgBookingDuration} days</div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-7 w-7 text-orange-500" />
            Vehicle Reports
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {startDate && endDate
              ? `${formatDate(startDate)} - ${formatDate(endDate)}`
              : "Select date range to view report"}
          </p>
        </div>

        <ExportButton
          apiUrl={getExportUrl()}
          filename={`vehicle-report-${startDate?.toISOString().split("T")[0]}-${endDate?.toISOString().split("T")[0]}`}
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
        showStatusFilter
        statuses={VEHICLE_STATUS_OPTIONS}
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />

      {/* Summary Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-orange-500" />
          Summary Metrics
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
            title="Total Bookings"
            value={reportData?.summary.totalBookings.toString() || "0"}
            icon={FileText}
            variant="bookings"
            isLoading={isLoading}
          />
          <MetricCard
            title="Total Revenue"
            value={abbreviateAmount(reportData?.summary.totalRevenue || 0)}
            icon={TrendingUp}
            variant="revenue"
            isLoading={isLoading}
          />
          <MetricCard
            title="Avg Utilisation"
            value={`${reportData?.summary.averageUtilisation || 0}%`}
            icon={TrendingUp}
            variant="default"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Car className="h-5 w-5 text-orange-500" />
            Vehicle Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={reportData?.data || []}
            isLoading={isLoading}
            emptyMessage="No vehicles found for the selected filters"
          />
        </CardContent>
      </Card>
    </div>
  );
};
