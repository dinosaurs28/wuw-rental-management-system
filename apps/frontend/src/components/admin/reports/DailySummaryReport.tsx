import { useState, useEffect } from "react";
import {
  Calendar,
  TrendingUp,
  DollarSign,
  Car,
  FileText,
  AlertTriangle,
  Wrench,
  Receipt,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/ui/MetricCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  formatCurrency,
  formatDate,
  abbreviateAmount,
} from "@/utils/formatters";
import { adminService } from "@/services/admin.service";
import { toast } from "sonner";
import type { DailySummaryReport } from "@/types/reports";

// ============================================================================
// Daily Summary Report Component
// ============================================================================

export const DailySummaryReports = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [reportData, setReportData] = useState<DailySummaryReport | null>(null);
  const [branches, setBranches] = useState<Array<{ value: string; label: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => { fetchBranches(); }, []);
  useEffect(() => { fetchReportData(); }, [selectedDate, selectedBranch]);

  const fetchBranches = async () => {
    try {
      const data = await adminService.getBranches();
      setBranches(data.map((b: any) => ({ value: b.publicId, label: b.name })));
    } catch (error) {
      console.error("Failed to fetch branches:", error);
    }
  };

  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split("T")[0];
      const params: { date: string; branchId?: string } = { date: dateStr };
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

  const getExportUrl = () => {
    const dateStr = selectedDate.toISOString().split("T")[0];
    const params: Record<string, any> = { date: dateStr };
    if (selectedBranch !== "all") params.branchId = selectedBranch;
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/daily-summary?${new URLSearchParams(params).toString()}`;
  };

  const chartData =
    reportData?.collections.breakdown.map((item) => ({
      name: item.method.replace("_", " "),
      amount: item.amount,
      count: item.count,
    })) || [];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Daily Summary Report</h1>
          <p className="text-sm text-gray-600 mt-1">
            {reportData ? formatDate(reportData.metadata.date) : "Loading..."}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                <Calendar className="mr-2 h-4 w-4" />
                {formatDate(selectedDate)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <CalendarComponent
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ExportButton
            apiUrl={getExportUrl()}
            filename={`daily-summary-${selectedDate.toISOString().split("T")[0]}`}
            disabled={isLoading || !reportData}
          />
        </div>
      </div>

      {/* ── Section 1: Booking Value vs Billed Amount ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Booking Value vs Billed Amount</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          <strong>Booking Value</strong> = amount committed when a booking is created today. &nbsp;|&nbsp;
          <strong>Billed Amount</strong> = actual invoice total finalized after vehicle return (includes extra charges, damage, etc.).
          These will differ — not all bookings created today are returned today.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            title="Booking Value (Created Today)"
            value={abbreviateAmount(reportData?.revenue.bookingValue || 0)}
            icon={FileText}
            variant="revenue"
            isLoading={isLoading}
            trend={
              reportData
                ? { value: reportData.comparison.revenueVsYesterday, label: "vs yesterday" }
                : undefined
            }
          />
          <MetricCard
            title={`Billed Amount (${reportData?.revenue.invoicedCount ?? 0} Invoices Finalized)`}
            value={abbreviateAmount(reportData?.revenue.invoicedAmount || 0)}
            icon={Receipt}
            variant="collection"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ── Section 2: Collections — What Was Actually Received ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <DollarSign className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Collections — Actual Cash Received Today</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Only payments with status <strong>Collected</strong> or <strong>Confirmed</strong> are counted here.
          Advance payments, safety deposits, and damage fees are shown separately so nothing is hidden in the total.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Advance Collected"
            value={abbreviateAmount(reportData?.revenue.advanceCollected || 0)}
            icon={DollarSign}
            variant="revenue"
            isLoading={isLoading}
          />
          <MetricCard
            title="Safety Deposit Collected"
            value={abbreviateAmount(reportData?.revenue.safetyDepositCollected || 0)}
            icon={DollarSign}
            variant="collection"
            isLoading={isLoading}
          />
          <MetricCard
            title="Damage Fees Collected"
            value={abbreviateAmount(reportData?.revenue.damageFeesCollected || 0)}
            icon={ShieldAlert}
            variant="collection"
            isLoading={isLoading}
          />
          <MetricCard
            title="Total Collected (All)"
            value={abbreviateAmount(reportData?.revenue.totalCollected || 0)}
            icon={TrendingUp}
            variant="revenue"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ── Section 3: Operations — Bookings & Fleet ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Booking Activity */}
        <Card className="p-6">
          <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-orange-500" />
            Booking Activity
          </h3>
          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">New Bookings:</span>
                <span className="font-semibold">{reportData?.bookings.newBookings || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Pickups:</span>
                <span className="font-semibold text-blue-600">{reportData?.bookings.pickups || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Returns:</span>
                <span className="font-semibold text-green-600">{reportData?.bookings.returns || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Cancellations:</span>
                <span className="font-semibold text-red-600">{reportData?.bookings.cancellations || 0}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-3">
                <span className="text-sm font-medium">Active (Currently Out):</span>
                <span className="font-bold text-lg">{reportData?.bookings.active || 0}</span>
              </div>
            </div>
          )}
        </Card>

        {/* Fleet Status */}
        <Card className="p-6">
          <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Car className="h-5 w-5 text-orange-500" />
            Fleet Status
          </h3>
          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Available (Start of Day):</span>
                <span className="font-semibold">{reportData?.vehicles.availableStartOfDay || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Rented Out:</span>
                <span className="font-semibold text-blue-600">{reportData?.vehicles.rentedOut || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Returned:</span>
                <span className="font-semibold text-green-600">{reportData?.vehicles.returned || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Available (End of Day):</span>
                <span className="font-semibold">{reportData?.vehicles.availableEndOfDay || 0}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-3">
                <span className="text-sm font-medium">Utilization:</span>
                <span className="font-bold text-lg text-violet-600">
                  {reportData?.vehicles.currentUtilization.toFixed(1) || "0.0"}%
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Section 4: Damage — Charged vs Collected ── */}
      <Card className="p-6">
        <h3 className="text-base font-semibold mb-1 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          Damage — Charged vs Collected
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          <strong>Estimated Cost</strong> = amount filed at report time (before approval). &nbsp;|&nbsp;
          <strong>Final Cost Charged</strong> = approved amount billed to customer. &nbsp;|&nbsp;
          <strong>Collected</strong> = damage fees are settled as part of the return payment — the approved final cost is the amount recovered.
        </p>
        {isLoading ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Reports */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reports</p>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">New Reports Filed:</span>
                <span className="font-semibold">{reportData?.damages.newReports || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Pending Approval:</span>
                <span className="font-semibold text-amber-600">{reportData?.damages.pendingApproval || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Approved:</span>
                <span className="font-semibold text-green-600">{reportData?.damages.approvedCount || 0}</span>
              </div>
            </div>
            {/* Charged */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Charged</p>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Estimated Cost:</span>
                <span className="font-semibold text-orange-600">
                  {formatCurrency(reportData?.damages.totalEstimatedCost || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Final Cost (approved):</span>
                <span className="font-semibold text-red-600">
                  {formatCurrency(reportData?.damages.totalFinalCost || 0)}
                </span>
              </div>
            </div>
            {/* Collected */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Collected</p>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Damage Fees Paid:</span>
                <span className="font-semibold text-green-600">
                  {formatCurrency(reportData?.damages.collected || 0)}
                </span>
              </div>
              {reportData && reportData.damages.totalFinalCost > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Outstanding:</span>
                  <span className="font-semibold text-red-500">
                    {formatCurrency(Math.max(0, reportData.damages.totalFinalCost - reportData.damages.collected))}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Section 5: Collections by Payment Method ── */}
      <Card className="p-6">
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-orange-500" />
          Collections by Payment Method
        </h3>
        {isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : chartData.length > 0 ? (
          <div className="w-full h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  formatter={(value: any) => formatCurrency(value)}
                  contentStyle={{ backgroundColor: "#fff", border: "1px solid #ccc" }}
                />
                <Legend />
                <Bar dataKey="amount" fill="#FF5F00" name="Amount Collected" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">No collection data available for this date</div>
        )}
      </Card>

      {/* ── Section 6: Maintenance Alerts ── */}
      {reportData && reportData.maintenance.vehiclesServiced > 0 && (
        <Card className="p-6">
          <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-blue-500" />
            Maintenance
          </h3>
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <Wrench className="h-5 w-5 text-blue-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-900">
                {reportData.maintenance.vehiclesServiced} Vehicle{reportData.maintenance.vehiclesServiced > 1 ? "s" : ""} Serviced
              </p>
              <p className="text-xs text-blue-700">
                Total Cost: {formatCurrency(reportData.maintenance.totalCost)}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
