import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Receipt, DollarSign, TrendingDown, RefreshCw } from "lucide-react";
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

interface ReceiptRow {
  receiptId: string;
  receiptNumber: string;
  bookingId: string;
  customer: { name: string; phone: string };
  branch: string;
  totalCharges: number;
  depositPaid: number;
  amountDue: number;
  refundAmount: number;
  creditNotes: { creditNoteNumber: string | null; amount: number; reason: string }[];
  generatedAt: string;
}

export const ReceiptReportPage = () => {
  const navigate = useNavigate();
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedBranch, setSelectedBranch] = useState("all");
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
  }, [startDate, endDate, selectedBranch, currentPage]);

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
      const result = await adminService.getReceiptReport(params);
      setReportData(result.data);
    } catch {
      toast.error("Failed to load receipt report.");
    } finally {
      setIsLoading(false);
    }
  };

  const columns: ColumnDef<ReceiptRow>[] = [
    {
      accessorKey: "receiptNumber",
      header: "Receipt #",
      cell: ({ row }) => <div className="font-mono text-sm font-medium">{row.original.receiptNumber}</div>,
    },
    {
      accessorKey: "bookingId",
      header: "Booking",
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
      accessorKey: "totalCharges",
      header: "Total Charges",
      cell: ({ row }) => <div className="font-mono text-sm font-semibold">{formatCurrency(row.original.totalCharges)}</div>,
    },
    {
      accessorKey: "amountDue",
      header: "Amt Due",
      cell: ({ row }) => (
        <div className={`font-mono text-sm font-semibold ${row.original.amountDue > 0 ? "text-red-600" : "text-gray-400"}`}>
          {row.original.amountDue > 0 ? formatCurrency(row.original.amountDue) : "—"}
        </div>
      ),
    },
    {
      accessorKey: "refundAmount",
      header: "Refund",
      cell: ({ row }) => (
        <div className={`font-mono text-sm font-semibold ${row.original.refundAmount > 0 ? "text-green-600" : "text-gray-400"}`}>
          {row.original.refundAmount > 0 ? formatCurrency(row.original.refundAmount) : "—"}
        </div>
      ),
    },
    {
      accessorKey: "creditNotes",
      header: "Credit Notes",
      cell: ({ row }) =>
        row.original.creditNotes.length > 0 ? (
          <div className="space-y-1">
            {row.original.creditNotes.map((cn, i) => (
              <Badge key={i} className="bg-purple-100 text-purple-800 text-xs block w-fit">
                {cn.creditNoteNumber ?? "CN"} · {formatCurrency(cn.amount)}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-gray-400 text-xs">None</span>
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
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Receipt className="h-7 w-7 text-orange-500" /> Receipt Report
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Return receipts with charges, refunds and credit notes</p>
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
          onApply={() => { setCurrentPage(1); fetchReport(); }}
          onReset={() => { setDateRangePreset("30days"); setSelectedBranch("all"); setCurrentPage(1); }}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Receipts" value={reportData?.summary.totalReceipts?.toString() ?? "0"} icon={Receipt} variant="default" isLoading={isLoading} />
          <MetricCard title="Total Charges" value={abbreviateAmount(reportData?.summary.totalCharges ?? 0)} icon={DollarSign} variant="revenue" isLoading={isLoading} />
          <MetricCard title="Total Due" value={abbreviateAmount(reportData?.summary.totalDue ?? 0)} icon={TrendingDown} variant="collection" isLoading={isLoading} />
          <MetricCard title="Total Refunded" value={abbreviateAmount(reportData?.summary.totalRefunded ?? 0)} icon={RefreshCw} variant="default" isLoading={isLoading} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Receipt className="h-5 w-5 text-orange-500" /> Receipt Details
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
              emptyMessage="No receipts found for the selected filters"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
