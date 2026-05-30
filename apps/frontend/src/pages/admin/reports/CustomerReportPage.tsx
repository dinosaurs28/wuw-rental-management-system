import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Users, DollarSign, TrendingUp, AlertCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { ExportButton } from "@/components/ui/ExportButton";
import { DataTable } from "@/components/ui/DataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate, abbreviateAmount } from "@/utils/formatters";
import { getDateRangeFromPreset, type DateRangePreset } from "@/utils/exportHelpers";
import { toast } from "sonner";
import { adminService } from "@/services/admin.service";
import type { ColumnDef } from "@tanstack/react-table";

interface CustomerRow {
  customerId: string;
  name: string;
  phone: string;
  email: string;
  registeredAt: string;
  isProfileCompleted: boolean;
  totalBookingsAllTime: number;
  bookingsInRange: number;
  revenueInRange: number;
  amountPaid: number;
  outstanding: number;
  lastBookingDate: string | null;
  customerType: string;
}

export const CustomerReportPage = () => {
  const navigate = useNavigate();
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [customerType, setCustomerType] = useState("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [reportData, setReportData] = useState<any>(null);
  const [branches, setBranches] = useState<Array<{ value: string; label: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    adminService.getBranches().then((data) =>
      setBranches(data.map((b: any) => ({ value: b.publicId, label: b.name })))
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (dateRangePreset !== "custom") {
      const { startDate: s, endDate: e } = getDateRangeFromPreset(dateRangePreset);
      setStartDate(s);
      setEndDate(e);
    }
  }, [dateRangePreset]);

  useEffect(() => {
    fetchReport();
  }, [startDate, endDate, selectedBranch, customerType, currentPage]);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const params: any = { page: currentPage.toString(), limit: "50" };
      if (startDate) params.startDate = startDate.toISOString().split("T")[0];
      if (endDate) params.endDate = endDate.toISOString().split("T")[0];
      if (selectedBranch !== "all") params.branchId = selectedBranch;
      if (customerType !== "all") params.customerType = customerType;
      if (search.trim()) params.search = search.trim();
      const result = await adminService.getCustomerReport(params);
      setReportData(result.data);
    } catch {
      toast.error("Failed to load customer report.");
    } finally {
      setIsLoading(false);
    }
  };

  const getExportUrl = () => {
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate.toISOString().split("T")[0]!;
    if (endDate) params.endDate = endDate.toISOString().split("T")[0]!;
    if (selectedBranch !== "all") params.branchId = selectedBranch;
    if (customerType !== "all") params.customerType = customerType;
    if (search.trim()) params.search = search.trim();
    const queryString = new URLSearchParams(params).toString();
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/customers${queryString ? `?${queryString}` : ""}`;
  };

  const columns: ColumnDef<CustomerRow>[] = [
    {
      accessorKey: "name",
      header: "Customer Name",
      cell: ({ row }) => (
        <div className="font-medium text-sm">{row.original.name}</div>
      ),
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <div className="text-sm text-gray-600">{row.original.phone}</div>,
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => <div className="text-xs text-gray-600">{row.original.email}</div>,
    },
    {
      accessorKey: "registeredAt",
      header: "Registered On",
      cell: ({ row }) => <div className="text-sm">{formatDate(row.original.registeredAt)}</div>,
    },
    {
      accessorKey: "totalBookingsAllTime",
      header: "Total Bookings",
      cell: ({ row }) => (
        <div className="text-center font-semibold">{row.original.totalBookingsAllTime}</div>
      ),
    },
    {
      accessorKey: "bookingsInRange",
      header: "Bookings in Range",
      cell: ({ row }) => (
        <div className="text-center font-semibold">{row.original.bookingsInRange}</div>
      ),
    },
    {
      accessorKey: "revenueInRange",
      header: "Revenue in Range",
      cell: ({ row }) => (
        <div className="font-mono font-semibold text-sm">{formatCurrency(row.original.revenueInRange)}</div>
      ),
    },
    {
      accessorKey: "amountPaid",
      header: "Amount Paid",
      cell: ({ row }) => (
        <div className="font-mono text-sm">{formatCurrency(row.original.amountPaid)}</div>
      ),
    },
    {
      accessorKey: "outstanding",
      header: "Outstanding",
      cell: ({ row }) => (
        <div className={`font-mono text-sm font-semibold ${row.original.outstanding > 0 ? "text-red-600" : "text-gray-400"}`}>
          {row.original.outstanding > 0 ? formatCurrency(row.original.outstanding) : "—"}
        </div>
      ),
    },
    {
      accessorKey: "lastBookingDate",
      header: "Last Booking Date",
      cell: ({ row }) => (
        <div className="text-sm text-gray-600">
          {row.original.lastBookingDate ? formatDate(row.original.lastBookingDate) : "—"}
        </div>
      ),
    },
    {
      accessorKey: "customerType",
      header: "Customer Type",
      cell: ({ row }) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.original.customerType === "New" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
          {row.original.customerType}
        </span>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate(-1)} variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="h-7 w-7 text-orange-500" /> Customer Report
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Customer-wise revenue, outstanding and booking summary</p>
          </div>
          <ExportButton
            apiUrl={getExportUrl()}
            filename="customer-report"
            disabled={isLoading || !reportData}
          />
        </div>

        <FilterPanel
          dateRangePreset={dateRangePreset}
          onDateRangePresetChange={setDateRangePreset}
          startDate={startDate}
          endDate={endDate}
          onDateChange={(s, e) => { setStartDate(s); setEndDate(e); }}
          showBranchFilter
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={setSelectedBranch}
          onApply={() => { setCurrentPage(1); fetchReport(); }}
          onReset={() => { setDateRangePreset("30days"); setSelectedBranch("all"); setCustomerType("all"); setSearch(""); setCurrentPage(1); }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Customer Type</label>
            <Select value={customerType} onValueChange={(v) => { setCustomerType(v); setCurrentPage(1); }}>
              <SelectTrigger>
                <SelectValue placeholder="All Customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="returning">Returning</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </FilterPanel>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name, phone or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchReport()}
            className="pl-9"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Customers" value={reportData?.summary.totalCustomers?.toString() ?? "0"} icon={Users} variant="default" isLoading={isLoading} />
          <MetricCard title="Total Revenue" value={abbreviateAmount(reportData?.summary.totalRevenue ?? 0)} icon={DollarSign} variant="revenue" isLoading={isLoading} />
          <MetricCard title="Outstanding" value={abbreviateAmount(reportData?.summary.totalOutstanding ?? 0)} icon={AlertCircle} variant="collection" isLoading={isLoading} />
          <MetricCard title="Total Bookings" value={reportData?.summary.totalBookings?.toString() ?? "0"} icon={TrendingUp} variant="bookings" isLoading={isLoading} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-orange-500" /> Customer Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={reportData?.data ?? []}
              isLoading={isLoading}
              pageCount={reportData?.pagination.totalPages}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              emptyMessage="No customers found"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
