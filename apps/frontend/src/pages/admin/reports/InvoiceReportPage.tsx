import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, DollarSign, TrendingUp, CheckCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency, formatDate, abbreviateAmount } from "@/utils/formatters";
import { getDateRangeFromPreset, type DateRangePreset } from "@/utils/exportHelpers";
import { toast } from "sonner";
import { adminService } from "@/services/admin.service";
import type { ColumnDef } from "@tanstack/react-table";

interface InvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  bookingId: string;
  customer: { name: string; phone: string };
  branch: string;
  subtotal: number;
  discount: number;
  tax: number;
  damageCharges: number;
  total: number;
  status: string;
  generatedAt: string;
}

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100 text-blue-800",
  FINALIZED: "bg-purple-100 text-purple-800",
  PAID: "bg-green-100 text-green-800",
};

export const InvoiceReportPage = () => {
  const navigate = useNavigate();
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
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
    if (startDate && endDate) fetchReport();
  }, [startDate, endDate, selectedBranch, selectedStatus, currentPage]);

  const fetchReport = async () => {
    if (!startDate || !endDate) return;
    setIsLoading(true);
    try {
      const params: any = {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        page: currentPage.toString(),
        limit: "50",
      };
      if (selectedBranch !== "all") params.branchId = selectedBranch;
      if (selectedStatus !== "all") params.status = selectedStatus;
      const result = await adminService.getInvoiceReport(params);
      setReportData(result.data);
    } catch {
      toast.error("Failed to load invoice report.");
    } finally {
      setIsLoading(false);
    }
  };

  const columns: ColumnDef<InvoiceRow>[] = [
    {
      accessorKey: "invoiceNumber",
      header: "Invoice #",
      cell: ({ row }) => <div className="font-mono text-sm font-medium">{row.original.invoiceNumber}</div>,
    },
    {
      accessorKey: "bookingId",
      header: "Booking ID",
      cell: ({ row }) => <div className="font-mono text-xs text-gray-500">{row.original.bookingId.slice(0, 8)}</div>,
    },
    {
      accessorKey: "generatedAt",
      header: "Date",
      cell: ({ row }) => <div className="text-sm">{formatDate(row.original.generatedAt)}</div>,
    },
    {
      accessorKey: "customer.name",
      header: "Customer",
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-sm">{row.original.customer.name}</div>
          <div className="text-xs text-gray-500">{row.original.customer.phone}</div>
        </div>
      ),
    },
    { accessorKey: "branch", header: "Branch", cell: ({ row }) => <div className="text-sm">{row.original.branch}</div> },
    {
      accessorKey: "subtotal",
      header: "Subtotal",
      cell: ({ row }) => <div className="text-sm text-right font-mono">{formatCurrency(row.original.subtotal)}</div>,
    },
    {
      accessorKey: "discount",
      header: "Discount",
      cell: ({ row }) => (
        <div className="text-sm text-right font-mono text-red-600">
          {row.original.discount > 0 ? `-${formatCurrency(row.original.discount)}` : "—"}
        </div>
      ),
    },
    {
      accessorKey: "tax",
      header: "Tax",
      cell: ({ row }) => <div className="text-sm text-right font-mono">{formatCurrency(row.original.tax)}</div>,
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => <div className="font-semibold font-mono">{formatCurrency(row.original.total)}</div>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge className={`text-xs ${statusColors[row.original.status] ?? "bg-gray-100 text-gray-700"}`}>
          {row.original.status}
        </Badge>
      ),
    },
  ];

  const statusOptions = [
    { value: "PENDING", label: "Pending" },
    { value: "APPROVED", label: "Approved" },
    { value: "FINALIZED", label: "Finalized" },
    { value: "PAID", label: "Paid" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate(-1)} variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="h-7 w-7 text-orange-500" /> Invoice Report
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">All invoices raised across bookings</p>
          </div>
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
          showStatusFilter
          statuses={statusOptions}
          selectedStatus={selectedStatus}
          onStatusChange={setSelectedStatus}
          onApply={() => { setCurrentPage(1); fetchReport(); }}
          onReset={() => { setDateRangePreset("30days"); setSelectedBranch("all"); setSelectedStatus("all"); setCurrentPage(1); }}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Invoices" value={reportData?.summary.totalInvoices?.toString() ?? "0"} icon={FileText} variant="default" isLoading={isLoading} />
          <MetricCard title="Total Billed" value={abbreviateAmount(reportData?.summary.totalBilled ?? 0)} icon={DollarSign} variant="revenue" isLoading={isLoading} />
          <MetricCard title="Total Tax" value={abbreviateAmount(reportData?.summary.totalTax ?? 0)} icon={TrendingUp} variant="default" isLoading={isLoading} />
          <MetricCard title="Paid / Pending" value={`${reportData?.summary.paidCount ?? 0} / ${reportData?.summary.pendingCount ?? 0}`} icon={CheckCircle} variant="bookings" isLoading={isLoading} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" /> Invoice Details
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
              emptyMessage="No invoices found for the selected filters"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
