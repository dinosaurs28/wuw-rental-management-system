import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  Wallet,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { DataTable } from "@/components/ui/DataTable";
import { formatDate, formatCurrency } from "@/utils/formatters";
import {
  getDateRangeFromPreset,
  type DateRangePreset,
} from "@/utils/exportHelpers";
import type { ColumnDef } from "@tanstack/react-table";
import { adminService } from "@/services/admin.service";

type PaymentModeFilter = "all" | "Cash" | "UPI" | "Gateway" | "Credit";

interface CollectionReportProps {
  startDate: string;
  endDate: string;
  branchId?: string;
  paymentMode?: PaymentModeFilter;
}

interface CollectionRow {
  date: string;
  bookingId: string;
  customerName: string;
  vehicleRegNo: string;
  paymentMode: string;
  amountCollected: number;
  collectedBy: string;
  branch: string;
  referenceNo: string;
}

interface CollectionSummary {
  totalCash: number;
  totalUpi: number;
  totalGateway: number;
  totalCredit: number;
  grandTotalCollected: number;
  totalTransactions: number;
}

interface CollectionReportData {
  metadata: {
    generatedAt: string;
    dateRange: {
      startDate: string;
      endDate: string;
    };
    branch: string;
    paymentMode: string;
    staff: string;
  };
  summary: CollectionSummary;
  data: CollectionRow[];
}

export const CollectionReport = ({
  startDate: initialStartDate,
  endDate: initialEndDate,
  branchId: initialBranchId = "all",
  paymentMode: initialPaymentMode = "all",
}: CollectionReportProps) => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialStartDate ? new Date(initialStartDate) : undefined,
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    initialEndDate ? new Date(initialEndDate) : undefined,
  );
  const [selectedBranch, setSelectedBranch] = useState(initialBranchId);
  const [paymentMode, setPaymentMode] =
    useState<PaymentModeFilter>(initialPaymentMode);
  const [data, setData] = useState<CollectionReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<
    Array<{ value: string; label: string }>
  >([]);

  // Initialize date range from preset if not provided
  useEffect(() => {
    if (!initialStartDate && !initialEndDate && dateRangePreset !== "custom") {
      const { startDate: start, endDate: end } =
        getDateRangeFromPreset(dateRangePreset);
      setStartDate(start);
      setEndDate(end);
    }
  }, [dateRangePreset, initialStartDate, initialEndDate]);

  // Fetch branches
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const branchData = await adminService.getBranches();
        setBranches(
          branchData.map((b: any) => ({ value: b.publicId, label: b.name })),
        );
      } catch (err) {
        console.error("Failed to load branches", err);
      }
    };
    loadBranches();
  }, []);

  useEffect(() => {
    if (startDate && endDate) {
      fetchReportData();
    }
  }, [startDate, endDate, selectedBranch, paymentMode]);

  const fetchReportData = async () => {
    setLoading(true);
    setError(null);

    try {
      const params: {
        startDate: string;
        endDate: string;
        branchId: string;
        paymentMode?: string;
      } = {
        startDate: startDate!.toISOString().split("T")[0],
        endDate: endDate!.toISOString().split("T")[0],
        branchId: selectedBranch,
      };

      if (paymentMode !== "all") {
        params.paymentMode = paymentMode;
      }

      const result = await adminService.getCollectionReport(params);
      setData(result.data);
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
      branchId: selectedBranch,
      export: "csv",
    });
    if (paymentMode !== "all") {
      params.set("paymentMode", paymentMode);
    }
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/collection?${params.toString()}`;
  };

  const handleApplyFilters = () => {
    fetchReportData();
  };

  const handleResetFilters = () => {
    setDateRangePreset("30days");
    const { startDate: start, endDate: end } = getDateRangeFromPreset("30days");
    setStartDate(start);
    setEndDate(end);
    setSelectedBranch("all");
    setPaymentMode("all");
  };

  const columns: ColumnDef<CollectionRow>[] = [
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => (
        <span className="text-sm">{formatDate(row.original.date)}</span>
      ),
    },
    {
      accessorKey: "bookingId",
      header: "Booking ID",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.bookingId}</span>
      ),
    },
    {
      accessorKey: "customerName",
      header: "Customer Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.customerName}</span>
      ),
    },
    {
      accessorKey: "vehicleRegNo",
      header: "Vehicle Reg No",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.vehicleRegNo}</span>
      ),
    },
    {
      accessorKey: "paymentMode",
      header: "Payment Mode",
      cell: ({ row }) => <span>{row.original.paymentMode}</span>,
    },
    {
      accessorKey: "amountCollected",
      header: "Amount Collected",
      cell: ({ row }) => (
        <span className="font-semibold font-mono">
          {formatCurrency(row.original.amountCollected)}
        </span>
      ),
    },
    {
      accessorKey: "collectedBy",
      header: "Collected By",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.collectedBy}</span>
      ),
    },
    {
      accessorKey: "branch",
      header: "Branch",
      cell: ({ row }) => <span className="text-sm">{row.original.branch}</span>,
    },
    {
      accessorKey: "referenceNo",
      header: "Reference No",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.referenceNo || "—"}
        </span>
      ),
    },
  ];

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const summary = data?.summary;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign className="h-8 w-8 text-orange-500" />
            Collection Report
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {startDate && endDate
              ? `${formatDate(startDate)} - ${formatDate(endDate)}`
              : "Select date range to view report"}
          </p>
        </div>
        <ExportButton
          apiUrl={getExportUrl()}
          filename={`collection-report-${startDate?.toISOString().split("T")[0]}-${endDate?.toISOString().split("T")[0]}`}
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
        <div className="space-y-2">
          <label className="text-sm font-medium">Payment Mode</label>
          <Select
            value={paymentMode}
            onValueChange={(value) =>
              setPaymentMode(value as PaymentModeFilter)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All Modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modes</SelectItem>
              <SelectItem value="Cash">Cash</SelectItem>
              <SelectItem value="UPI">UPI</SelectItem>
              <SelectItem value="Gateway">Gateway</SelectItem>
              <SelectItem value="Credit">Credit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterPanel>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Cash"
          value={formatCurrency(summary?.totalCash || 0)}
          icon={Banknote}
          variant="revenue"
          isLoading={loading}
        />
        <MetricCard
          title="Total UPI"
          value={formatCurrency(summary?.totalUpi || 0)}
          icon={Smartphone}
          variant="bookings"
          isLoading={loading}
        />
        <MetricCard
          title="Total Gateway"
          value={formatCurrency(summary?.totalGateway || 0)}
          icon={CreditCard}
          variant="fleet"
          isLoading={loading}
        />
        <MetricCard
          title="Total Credit"
          value={formatCurrency(summary?.totalCredit || 0)}
          icon={Wallet}
          variant="collection"
          isLoading={loading}
        />
        <MetricCard
          title="Grand Total Collected"
          value={formatCurrency(summary?.grandTotalCollected || 0)}
          icon={DollarSign}
          variant="default"
          isLoading={loading}
        />
      </div>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-orange-500" />
            Collection Transactions
            {summary ? ` (${summary.totalTransactions})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data?.data || []}
            isLoading={loading}
            emptyMessage="No transactions found"
          />
        </CardContent>
      </Card>
    </div>
  );
};
