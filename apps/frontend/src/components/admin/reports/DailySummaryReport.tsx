import { useState, useEffect } from "react";
import {
  TrendingUp,
  DollarSign,
  FileText,
  Receipt,
  CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { ExportButton } from "@/components/ui/ExportButton";
import { DataTable } from "@/components/ui/DataTable";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatDate, abbreviateAmount } from "@/utils/formatters";
import {
  getDateRangeFromPreset,
  type DateRangePreset,
} from "@/utils/exportHelpers";
import { adminService } from "@/services/admin.service";
import { toast } from "sonner";
import type { DailySummaryReport, DailySummaryDay } from "@/types/reports";
import type { ColumnDef } from "@tanstack/react-table";

// ============================================================================
// Daily Summary Report Component (multi-day: one row per calendar day)
// ============================================================================

export const DailySummaryReports = () => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [reportData, setReportData] = useState<DailySummaryReport | null>(null);
  const [branches, setBranches] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    if (dateRangePreset !== "custom") {
      const { startDate: start, endDate: end } =
        getDateRangeFromPreset(dateRangePreset);
      setStartDate(start);
      setEndDate(end);
    }
  }, [dateRangePreset]);

  useEffect(() => {
    if (startDate && endDate) {
      fetchReportData();
    }
  }, [startDate, endDate, selectedBranch]);

  const fetchBranches = async () => {
    try {
      const data = await adminService.getBranches();
      setBranches(
        data.map((b: any) => ({ value: b.publicId, label: b.name })),
      );
    } catch (error) {
      console.error("Failed to fetch branches:", error);
    }
  };

  const fetchReportData = async () => {
    if (!startDate || !endDate) return;
    setIsLoading(true);
    try {
      const params: {
        startDate: string;
        endDate: string;
        branchId?: string;
      } = {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      };
      if (selectedBranch !== "all") params.branchId = selectedBranch;
      const result = await adminService.getDailySummaryReport(params);
      setReportData(result.data);
    } catch (error) {
      console.error("Error fetching report:", error);
      toast.error("Failed to load daily summary. Please try again.");
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
  };

  const getExportUrl = () => {
    if (!startDate || !endDate) return "";
    const params: Record<string, string> = {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
    if (selectedBranch !== "all") params.branchId = selectedBranch;
    const queryString = new URLSearchParams(params).toString();
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/daily-summary?${queryString}`;
  };

  // Per-day table columns (spec §4.2 exact order).
  const columns: ColumnDef<DailySummaryDay>[] = [
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => (
        <div className="text-sm font-medium">{row.original.date}</div>
      ),
    },
    {
      accessorKey: "newBookings",
      header: "New Bookings",
      cell: ({ row }) => (
        <div className="text-sm tabular-nums">{row.original.newBookings}</div>
      ),
    },
    {
      accessorKey: "activeTrips",
      header: "Active Trips",
      cell: ({ row }) => (
        <div className="text-sm tabular-nums text-blue-600">
          {row.original.activeTrips}
        </div>
      ),
    },
    {
      accessorKey: "completed",
      header: "Completed",
      cell: ({ row }) => (
        <div className="text-sm tabular-nums text-green-600">
          {row.original.completed}
        </div>
      ),
    },
    {
      accessorKey: "revenue",
      header: "Revenue",
      cell: ({ row }) => (
        <div className="text-sm font-semibold font-mono">
          {formatCurrency(row.original.revenue)}
        </div>
      ),
    },
    {
      accessorKey: "cashCollected",
      header: "Cash Collected",
      cell: ({ row }) => (
        <div className="text-sm font-mono">
          {formatCurrency(row.original.cashCollected)}
        </div>
      ),
    },
    {
      accessorKey: "upiCollected",
      header: "UPI Collected",
      cell: ({ row }) => (
        <div className="text-sm font-mono">
          {formatCurrency(row.original.upiCollected)}
        </div>
      ),
    },
    {
      accessorKey: "outstanding",
      header: "Outstanding",
      cell: ({ row }) => (
        <div className="text-sm font-mono text-red-500">
          {formatCurrency(row.original.outstanding)}
        </div>
      ),
    },
    {
      accessorKey: "cancellations",
      header: "Cancellations",
      cell: ({ row }) => (
        <div className="text-sm tabular-nums text-red-600">
          {row.original.cancellations}
        </div>
      ),
    },
  ];

  const chartData =
    reportData?.days.map((d) => ({
      date: d.date,
      revenue: d.revenue,
    })) || [];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Daily Summary Report
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {startDate && endDate
              ? `${formatDate(startDate)} - ${formatDate(endDate)}`
              : "Select date range to view report"}
          </p>
        </div>

        <ExportButton
          apiUrl={getExportUrl()}
          filename={`daily-summary-${startDate?.toISOString().split("T")[0]}-${endDate?.toISOString().split("T")[0]}`}
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
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />

      {/* Totals */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-orange-500" />
          Totals for Period
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Revenue"
            value={abbreviateAmount(reportData?.totals.revenue || 0)}
            icon={DollarSign}
            variant="revenue"
            isLoading={isLoading}
          />
          <MetricCard
            title="New Bookings"
            value={(reportData?.totals.newBookings || 0).toString()}
            icon={FileText}
            variant="bookings"
            isLoading={isLoading}
          />
          <MetricCard
            title="Cash + UPI Collected"
            value={abbreviateAmount(
              (reportData?.totals.cashCollected || 0) +
                (reportData?.totals.upiCollected || 0),
            )}
            icon={Receipt}
            variant="collection"
            isLoading={isLoading}
          />
          <MetricCard
            title="Outstanding"
            value={abbreviateAmount(reportData?.totals.outstanding || 0)}
            icon={DollarSign}
            variant="default"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Per-day Revenue chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-orange-500" />
            Revenue by Day
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => abbreviateAmount(v)} />
                <Tooltip
                  formatter={(value: any) => formatCurrency(value)}
                  contentStyle={{
                    backgroundColor: "#fff",
                    border: "1px solid #ccc",
                  }}
                />
                <Bar dataKey="revenue" fill="#FF5F00" name="Revenue" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">
              No data available for the selected range
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-day Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-orange-500" />
            Daily Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={reportData?.days || []}
            isLoading={isLoading}
            emptyMessage="No data found for the selected range"
          />
        </CardContent>
      </Card>
    </div>
  );
};
