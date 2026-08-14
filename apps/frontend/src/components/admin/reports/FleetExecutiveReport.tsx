import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  Car,
  Activity,
  AlertTriangle,
  Wrench,
  BarChart as BarChartIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { adminService } from "@/services/admin.service";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { DataTable } from "@/components/ui/DataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { abbreviateAmount } from "@/utils/formatters";
import {
  getDateRangeFromPreset,
  type DateRangePreset,
} from "@/utils/exportHelpers";
import type { ColumnDef } from "@tanstack/react-table";

interface FleetExecutiveReportProps {
  startDate: string;
  endDate: string;
}

interface KPIs {
  totalVehicles: number;
  activeBookings: number;
  totalBookings: number;
  totalRevenue: number;
  averageBookingValue: number;
  fleetUtilization: number;
  revenuePerVehicle: number;
}

interface BranchPerformance {
  branchId: string;
  branchName: string;
  totalVehicles: number;
  activeVehicles: number;
  totalBookings: number;
  totalRevenue: number;
  averageBookingValue: number;
  utilization: number;
}

interface CategoryPerformance {
  categoryName: string;
  totalVehicles: number;
  totalBookings: number;
  totalRevenue: number;
  averageBookingValue: number;
}

interface OperationalMetrics {
  damageReports: number;
  maintenanceRecords: number;
  damageReportRate: number;
  maintenanceRate: number;
}

interface ExecutiveRow {
  executiveId: string;
  executiveName: string;
  branchName: string;
  bookingsHandled: number;
  totalRevenue: number;
  cashCollected: number;
  upiCollected: number;
  outstanding: number;
  cancellations: number;
}

interface ExecutivesSummary {
  executiveCount: number;
  bookingsHandled: number;
  totalRevenue: number;
  cashCollected: number;
  upiCollected: number;
  outstanding: number;
  cancellations: number;
}

interface FleetExecutiveData {
  metadata: {
    generatedAt: string;
    dateRange: {
      startDate: string;
      endDate: string;
    };
  };
  kpis: KPIs;
  branchPerformance: BranchPerformance[];
  categoryPerformance: CategoryPerformance[];
  operationalMetrics: OperationalMetrics;
  executives: ExecutiveRow[];
  executivesSummary: ExecutivesSummary;
}

export const FleetExecutiveReport = ({
  startDate: initialStartDate,
  endDate: initialEndDate,
}: FleetExecutiveReportProps) => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialStartDate ? new Date(initialStartDate) : undefined,
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    initialEndDate ? new Date(initialEndDate) : undefined,
  );
  const [data, setData] = useState<FleetExecutiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedExecutive, setSelectedExecutive] = useState<string>("all");
  const [branches, setBranches] = useState<
    Array<{ value: string; label: string }>
  >([]);
  // Executive dropdown options, captured only from the UNFILTERED fetch so the
  // list does not collapse to a single entry once an executive is selected.
  const [executiveOptions, setExecutiveOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);

  // Fetch branches once for the branch filter.
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const result = await adminService.getBranches();
        setBranches(
          result.map((branch) => ({
            value: branch.publicId,
            label: branch.name,
          })),
        );
      } catch (err) {
        console.error("Failed to fetch branches:", err);
      }
    };
    fetchBranches();
  }, []);

  // Initialize date range from preset
  useEffect(() => {
    if (!initialStartDate && !initialEndDate && dateRangePreset !== "custom") {
      const { startDate: start, endDate: end } =
        getDateRangeFromPreset(dateRangePreset);
      setStartDate(start);
      setEndDate(end);
    }
  }, [dateRangePreset, initialStartDate, initialEndDate]);

  useEffect(() => {
    if (startDate && endDate) {
      fetchReportData();
    }
  }, [startDate, endDate, selectedBranch, selectedExecutive]);

  const fetchReportData = async () => {
    setLoading(true);
    setError(null);

    try {
      const params: {
        startDate: string;
        endDate: string;
        branchId?: string;
        executiveId?: string;
      } = {
        startDate: startDate!.toISOString().split("T")[0],
        endDate: endDate!.toISOString().split("T")[0],
      };
      if (selectedBranch !== "all") params.branchId = selectedBranch;
      if (selectedExecutive !== "all") params.executiveId = selectedExecutive;

      const result = await adminService.getFleetExecutiveReport(params);
      const reportData: FleetExecutiveData = result.data;
      setData(reportData);

      // Only refresh the executive dropdown from an unfiltered response so the
      // option list stays complete (a filtered response returns one row only).
      if (selectedExecutive === "all" && reportData.executives) {
        setExecutiveOptions(
          reportData.executives
            .filter((e) => e.executiveId !== "unassigned")
            .map((e) => ({ value: e.executiveId, label: e.executiveName })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const getExportUrl = () => {
    if (!startDate || !endDate) return "";
    const params = new URLSearchParams({
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    });
    if (selectedBranch !== "all") params.set("branchId", selectedBranch);
    if (selectedExecutive !== "all")
      params.set("executiveId", selectedExecutive);
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/fleet-executive?${params.toString()}`;
  };

  const handleApplyFilters = () => {
    fetchReportData();
  };

  const handleResetFilters = () => {
    setDateRangePreset("30days");
    setSelectedBranch("all");
    setSelectedExecutive("all");
    const { startDate: start, endDate: end } = getDateRangeFromPreset("30days");
    setStartDate(start);
    setEndDate(end);
  };

  const executiveColumns: ColumnDef<ExecutiveRow>[] = [
    {
      accessorKey: "executiveName",
      header: "Executive Name",
      cell: ({ row }) => (
        <div className="font-medium">{row.original.executiveName}</div>
      ),
    },
    {
      accessorKey: "branchName",
      header: "Branch",
      cell: ({ row }) => (
        <div className="text-sm">{row.original.branchName}</div>
      ),
    },
    {
      accessorKey: "bookingsHandled",
      header: "Bookings Handled",
      cell: ({ row }) => (
        <div className="text-right">{row.original.bookingsHandled}</div>
      ),
    },
    {
      accessorKey: "totalRevenue",
      header: "Total Revenue",
      cell: ({ row }) => (
        <div className="text-right font-semibold font-mono">
          ₹{row.original.totalRevenue.toLocaleString("en-IN")}
        </div>
      ),
    },
    {
      accessorKey: "cashCollected",
      header: "Cash Collected",
      cell: ({ row }) => (
        <div className="text-right font-mono">
          ₹{row.original.cashCollected.toLocaleString("en-IN")}
        </div>
      ),
    },
    {
      accessorKey: "upiCollected",
      header: "UPI Collected",
      cell: ({ row }) => (
        <div className="text-right font-mono">
          ₹{row.original.upiCollected.toLocaleString("en-IN")}
        </div>
      ),
    },
    {
      accessorKey: "outstanding",
      header: "Outstanding",
      cell: ({ row }) => (
        <div className="text-right font-mono">
          ₹{row.original.outstanding.toLocaleString("en-IN")}
        </div>
      ),
    },
    {
      accessorKey: "cancellations",
      header: "Cancellations",
      cell: ({ row }) => (
        <div className="text-right">{row.original.cancellations}</div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        {/* Header Skeleton */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        {/* Filters Skeleton */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>

        {/* KPIs Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const COLORS = [
    "#FF5F00",
    "#10b981",
    "#3b82f6",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
  ];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Fleet Executive Report</h1>
          <p className="text-muted-foreground mt-1">
            {data.metadata.dateRange.startDate} to{" "}
            {data.metadata.dateRange.endDate}
          </p>
        </div>
        <ExportButton
          apiUrl={getExportUrl()}
          filename={`fleet-executive-${startDate?.toISOString().split("T")[0]}-${endDate?.toISOString().split("T")[0]}`}
          disabled={loading || !data}
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
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      >
        {/* Executive Filter */}
        {executiveOptions.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Executive</label>
            <Select
              value={selectedExecutive}
              onValueChange={setSelectedExecutive}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Executives" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Executives</SelectItem>
                {executiveOptions.map((exec) => (
                  <SelectItem key={exec.value} value={exec.value}>
                    {exec.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </FilterPanel>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Revenue"
          value={data ? abbreviateAmount(data.kpis.totalRevenue) : "₹0"}
          icon={DollarSign}
          variant="revenue"
          isLoading={loading}
        />
        <MetricCard
          title="Active Bookings"
          value={data?.kpis.activeBookings.toString() || "0"}
          icon={Car}
          variant="bookings"
          isLoading={loading}
        />
        <MetricCard
          title="Fleet Utilization"
          value={`${data?.kpis.fleetUtilization.toFixed(1) || "0"}%`}
          icon={Activity}
          variant="fleet"
          isLoading={loading}
        />
        <MetricCard
          title="Damage Rate"
          value={`${data?.operationalMetrics.damageReportRate.toFixed(1) || "0"}%`}
          icon={AlertTriangle}
          variant="default"
          isLoading={loading}
        />
      </div>

      {/* Executive Performance (per-staff) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChartIcon className="h-5 w-5 text-orange-500" />
            Executive Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={executiveColumns}
            data={data.executives || []}
            isLoading={loading}
            pageSize={25}
            emptyMessage="No executive activity found for the selected filters"
          />
          {data.executivesSummary && data.executives.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Bookings</p>
                <p className="font-semibold">
                  {data.executivesSummary.bookingsHandled}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Total Revenue</p>
                <p className="font-semibold font-mono">
                  ₹{data.executivesSummary.totalRevenue.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Cash Collected</p>
                <p className="font-semibold font-mono">
                  ₹{data.executivesSummary.cashCollected.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">UPI Collected</p>
                <p className="font-semibold font-mono">
                  ₹{data.executivesSummary.upiCollected.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Outstanding</p>
                <p className="font-semibold font-mono">
                  ₹{data.executivesSummary.outstanding.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Cancellations</p>
                <p className="font-semibold">
                  {data.executivesSummary.cancellations}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operational Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Damage Reports
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.operationalMetrics.damageReports}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.operationalMetrics.damageReportRate.toFixed(1)}% rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Maintenance Records
            </CardTitle>
            <Wrench className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.operationalMetrics.maintenanceRecords}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.operationalMetrics.maintenanceRate.toFixed(1)}% rate
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Branch Performance Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChartIcon className="h-5 w-5 text-orange-500" />
            Branch Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : data?.branchPerformance && data.branchPerformance.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.branchPerformance}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="branchName" />
                  <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                  <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                  <Tooltip />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="totalRevenue"
                    name="Revenue"
                    fill="#FF5F00"
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="utilization"
                    name="Utilization %"
                    fill="#82ca9d"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Category Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.categoryPerformance}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ categoryName, percent }) =>
                    `${categoryName}: ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="totalRevenue"
                  nameKey="categoryName"
                >
                  {data.categoryPerformance.map((_entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) =>
                    `₹${value.toLocaleString("en-IN")}`
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Category Performance Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.categoryPerformance.map((category, index) => (
                <div
                  key={category.categoryName}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <div>
                      <p className="font-medium">{category.categoryName}</p>
                      <p className="text-sm text-muted-foreground">
                        {category.totalVehicles} vehicles
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      ₹{category.totalRevenue.toLocaleString("en-IN")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {category.totalBookings} bookings
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Branch Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>Branch Performance Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-medium">Branch</th>
                  <th className="text-right p-2 font-medium">Vehicles</th>
                  <th className="text-right p-2 font-medium">Active</th>
                  <th className="text-right p-2 font-medium">Bookings</th>
                  <th className="text-right p-2 font-medium">Revenue</th>
                  <th className="text-right p-2 font-medium">Avg Value</th>
                  <th className="text-right p-2 font-medium">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {data.branchPerformance.map((branch) => (
                  <tr
                    key={branch.branchId}
                    className="border-b hover:bg-muted/50"
                  >
                    <td className="p-2 font-medium">{branch.branchName}</td>
                    <td className="p-2 text-right">{branch.totalVehicles}</td>
                    <td className="p-2 text-right">{branch.activeVehicles}</td>
                    <td className="p-2 text-right">{branch.totalBookings}</td>
                    <td className="p-2 text-right font-semibold">
                      ₹{branch.totalRevenue.toLocaleString("en-IN")}
                    </td>
                    <td className="p-2 text-right">
                      ₹
                      {Math.round(branch.averageBookingValue).toLocaleString(
                        "en-IN",
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          branch.utilization >= 70
                            ? "bg-green-100 text-green-700"
                            : branch.utilization >= 40
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {branch.utilization.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
