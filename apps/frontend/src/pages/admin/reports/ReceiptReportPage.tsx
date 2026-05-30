import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Receipt, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface ReceiptRow {
  receiptNo: string;
  receiptDate: string;
  bookingId: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  amountReceived: number;
  paymentMode: string;
  transactionRef: string;
  collectedBy: string;
  branch: string;
}

export const ReceiptReportPage = () => {
  const navigate = useNavigate();
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [paymentMode, setPaymentMode] = useState("all");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, selectedBranch, paymentMode, currentPage]);

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
      if (paymentMode !== "all") params.paymentMode = paymentMode;
      const result = await adminService.getReceiptReport(params);
      setReportData(result.data);
    } catch {
      toast.error("Failed to load receipt report.");
    } finally {
      setIsLoading(false);
    }
  };

  const getExportUrl = () => {
    if (!startDate || !endDate) return "";
    const params = new URLSearchParams({
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      branchId: selectedBranch,
      paymentMode,
    });
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/receipts?${params.toString()}`;
  };

  const columns: ColumnDef<ReceiptRow>[] = [
    {
      accessorKey: "receiptNo",
      header: "Receipt No",
      cell: ({ row }) => (
        <div className="font-mono text-sm font-medium">{row.original.receiptNo}</div>
      ),
    },
    {
      accessorKey: "receiptDate",
      header: "Receipt Date",
      cell: ({ row }) => <div className="text-sm">{formatDate(row.original.receiptDate)}</div>,
    },
    {
      accessorKey: "bookingId",
      header: "Booking ID",
      cell: ({ row }) => (
        <div className="font-mono text-xs text-gray-500">{row.original.bookingId}</div>
      ),
    },
    {
      accessorKey: "invoiceNo",
      header: "Invoice No",
      cell: ({ row }) => (
        <div className="font-mono text-xs text-gray-500">{row.original.invoiceNo || "—"}</div>
      ),
    },
    {
      accessorKey: "customerName",
      header: "Customer Name",
      cell: ({ row }) => (
        <div className="font-medium text-sm">{row.original.customerName}</div>
      ),
    },
    {
      accessorKey: "customerPhone",
      header: "Customer Phone",
      cell: ({ row }) => (
        <div className="text-sm text-gray-500">{row.original.customerPhone || "—"}</div>
      ),
    },
    {
      accessorKey: "amountReceived",
      header: "Amount Received",
      cell: ({ row }) => (
        <div className="font-mono text-sm font-semibold">
          {formatCurrency(row.original.amountReceived)}
        </div>
      ),
    },
    {
      accessorKey: "paymentMode",
      header: "Payment Mode",
      cell: ({ row }) => <div className="text-sm">{row.original.paymentMode}</div>,
    },
    {
      accessorKey: "transactionRef",
      header: "Transaction Ref",
      cell: ({ row }) => (
        <div className="font-mono text-xs text-gray-500">
          {row.original.transactionRef || "—"}
        </div>
      ),
    },
    {
      accessorKey: "collectedBy",
      header: "Collected By",
      cell: ({ row }) => <div className="text-sm">{row.original.collectedBy}</div>,
    },
    {
      accessorKey: "branch",
      header: "Branch",
      cell: ({ row }) => <div className="text-sm">{row.original.branch}</div>,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button onClick={() => navigate(-1)} variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Receipt className="h-7 w-7 text-orange-500" /> Receipt Report
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Payment receipts — one row per collected payment
              </p>
            </div>
          </div>

          <ExportButton
            apiUrl={getExportUrl()}
            filename={`receipt-report-${startDate?.toISOString().split("T")[0]}-${endDate?.toISOString().split("T")[0]}`}
            disabled={isLoading || !reportData}
          />
        </div>

        <FilterPanel
          dateRangePreset={dateRangePreset}
          onDateRangePresetChange={setDateRangePreset}
          startDate={startDate}
          endDate={endDate}
          onDateChange={(s, e) => {
            setStartDate(s);
            setEndDate(e);
          }}
          showBranchFilter
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={setSelectedBranch}
          onApply={() => {
            setCurrentPage(1);
            fetchReport();
          }}
          onReset={() => {
            setDateRangePreset("30days");
            setSelectedBranch("all");
            setPaymentMode("all");
            setCurrentPage(1);
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Payment Mode</label>
            <Select value={paymentMode} onValueChange={(value) => setPaymentMode(value)}>
              <SelectTrigger>
                <SelectValue placeholder="All Modes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="Gateway">Gateway</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </FilterPanel>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            title="Total Receipts"
            value={reportData?.summary.totalReceipts?.toString() ?? "0"}
            icon={Receipt}
            variant="default"
            isLoading={isLoading}
          />
          <MetricCard
            title="Total Amount Received"
            value={abbreviateAmount(reportData?.summary.totalAmountReceived ?? 0)}
            icon={DollarSign}
            variant="revenue"
            isLoading={isLoading}
          />
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
