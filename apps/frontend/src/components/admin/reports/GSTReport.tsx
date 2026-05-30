import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  FileText,
  TrendingUp,
  Building2,
  CreditCard,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
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
import { formatDate, formatCurrency } from "@/utils/formatters";
import {
  getDateRangeFromPreset,
  type DateRangePreset,
} from "@/utils/exportHelpers";
import type { ColumnDef } from "@tanstack/react-table";

interface GSTReportProps {
  startDate: string;
  endDate: string;
  branchId?: string;
}

interface Summary {
  totalInvoices: number;
  totalTaxableAmount: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  totalGST: number;
  totalInvoiceAmount: number;
  totalInputGST: number;
  netLiability: number;
  effectiveGSTRate: number;
}

interface MonthlyBreakdown {
  month: string;
  invoiceCount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  totalAmount: number;
}

interface BranchBreakdown {
  branchName: string;
  invoiceCount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  totalAmount: number;
}

// Section A (Output GST) row — exact backend field names (spec §4.9)
interface SectionARow {
  section: string;
  date: string;
  documentNo: string;
  partyName: string;
  gstin: string;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  invoiceTotal: number;
}

interface GSTReportData {
  metadata: {
    generatedAt: string;
    dateRange: {
      startDate: string;
      endDate: string;
    };
    branch: string;
    gstType?: string;
  };
  summary: Summary;
  monthlyBreakdown: MonthlyBreakdown[];
  branchBreakdown: BranchBreakdown[];
  // Two-section structure (spec §4.9)
  sectionA_output: SectionARow[];
  sectionB_input: unknown[];
  inputNote: string;
  netLiability: number;
}

export const GSTReport = ({
  startDate: initialStartDate,
  endDate: initialEndDate,
  branchId: initialBranchId = "all",
}: GSTReportProps) => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("30days");
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialStartDate ? new Date(initialStartDate) : undefined,
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    initialEndDate ? new Date(initialEndDate) : undefined,
  );
  const [selectedBranch, setSelectedBranch] = useState(initialBranchId);
  const [selectedGstType, setSelectedGstType] = useState<string>("both");
  const [data, setData] = useState<GSTReportData | null>(null);
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
  }, [startDate, endDate, selectedBranch, selectedGstType]);

  const fetchReportData = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = {
        startDate: startDate!.toISOString().split("T")[0],
        endDate: endDate!.toISOString().split("T")[0],
        branchId: selectedBranch,
        gstType: selectedGstType,
      };

      const result = await adminService.getGSTReport(params);
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
      gstType: selectedGstType,
    });
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/gst?${params.toString()}`;
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
    setSelectedGstType("both");
  };

  // Section A (Output GST) columns — spec §4.9 order.
  const columns: ColumnDef<SectionARow>[] = [
    {
      accessorKey: "section",
      header: "Section",
      cell: ({ row }) => (
        <span className="text-xs font-medium">{row.original.section}</span>
      ),
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => <span>{formatDate(row.original.date)}</span>,
    },
    {
      accessorKey: "documentNo",
      header: "Document No",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.documentNo}</span>
      ),
    },
    {
      accessorKey: "partyName",
      header: "Party Name",
    },
    {
      accessorKey: "gstin",
      header: "GSTIN",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.gstin || "—"}
        </span>
      ),
    },
    {
      accessorKey: "taxableAmount",
      header: "Taxable Amount",
      cell: ({ row }) => (
        <span className="font-medium">
          {formatCurrency(row.original.taxableAmount)}
        </span>
      ),
    },
    {
      accessorKey: "cgst",
      header: "CGST",
      cell: ({ row }) => (
        <span className="text-green-700">
          {formatCurrency(row.original.cgst)}
        </span>
      ),
    },
    {
      accessorKey: "sgst",
      header: "SGST",
      cell: ({ row }) => (
        <span className="text-blue-700">
          {formatCurrency(row.original.sgst)}
        </span>
      ),
    },
    {
      accessorKey: "igst",
      header: "IGST",
      cell: ({ row }) => (
        <span className="text-amber-700">
          {formatCurrency(row.original.igst)}
        </span>
      ),
    },
    {
      accessorKey: "totalGST",
      header: "Total GST",
      cell: ({ row }) => (
        <span className="font-medium text-orange-600">
          {formatCurrency(row.original.totalGST)}
        </span>
      ),
    },
    {
      accessorKey: "invoiceTotal",
      header: "Invoice Total",
      cell: ({ row }) => (
        <span className="font-bold">
          {formatCurrency(row.original.invoiceTotal)}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
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

        {/* Summary Cards Skeleton */}
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

        {/* Table Skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
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

  // Prepare GST type breakdown chart data
  const gstTypeData = [
    { name: "CGST", value: data.summary.totalCGST },
    { name: "SGST", value: data.summary.totalSGST },
    { name: "IGST", value: data.summary.totalIGST },
  ].filter((item) => item.value > 0);

  const COLORS = {
    CGST: "#10b981",
    SGST: "#3b82f6",
    IGST: "#f59e0b",
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">GST Report</h1>
          <p className="text-muted-foreground mt-1">
            {data.metadata.dateRange.startDate} to{" "}
            {data.metadata.dateRange.endDate}
          </p>
        </div>
        <ExportButton
          apiUrl={getExportUrl()}
          filename={`gst-report-${startDate?.toISOString().split("T")[0]}-${endDate?.toISOString().split("T")[0]}`}
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
        {/* GST Type filter (Both / Output Only / Input Only) */}
        <div className="space-y-2">
          <label className="text-sm font-medium">GST Type</label>
          <Select value={selectedGstType} onValueChange={setSelectedGstType}>
            <SelectTrigger>
              <SelectValue placeholder="Both" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Both</SelectItem>
              <SelectItem value="output">Output Only</SelectItem>
              <SelectItem value="input">Input Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterPanel>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total GST"
          value={data ? formatCurrency(data.summary.totalGST) : "₹0"}
          icon={DollarSign}
          variant="revenue"
          trend={{
            value: data ? data.summary.effectiveGSTRate : 0,
            label: "effective rate",
          }}
          isLoading={loading}
        />
        <MetricCard
          title="Taxable Amount"
          value={data ? formatCurrency(data.summary.totalTaxableAmount) : "₹0"}
          icon={TrendingUp}
          variant="default"
          isLoading={loading}
        />
        <MetricCard
          title="Total Invoices"
          value={data?.summary.totalInvoices.toString() || "0"}
          icon={FileText}
          variant="collection"
          isLoading={loading}
        />
        <MetricCard
          title="Total Amount"
          value={data ? formatCurrency(data.summary.totalInvoiceAmount) : "₹0"}
          icon={Building2}
          variant="default"
          isLoading={loading}
        />
      </div>

      {/* GST Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-700">
              CGST (Central)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ₹{data.summary.totalCGST.toLocaleString("en-IN")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              9% on intra-state
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-700">
              SGST (State)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              ₹{data.summary.totalSGST.toLocaleString("en-IN")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              9% on intra-state
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-700">
              IGST (Integrated)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              ₹{data.summary.totalIGST.toLocaleString("en-IN")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              18% on inter-state
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Net GST Liability */}
      <Card className="border-orange-200 bg-orange-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-orange-700">
            Net GST Liability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-orange-600">
            ₹{(data.netLiability ?? 0).toLocaleString("en-IN")}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Output GST ({formatCurrency(data.summary.totalGST)}) − Input GST (
            {formatCurrency(data.summary.totalInputGST)})
          </p>
        </CardContent>
      </Card>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GST Type Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>GST Tax Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={gstTypeData}
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
                  {gstTypeData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={COLORS[entry.name as keyof typeof COLORS]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) =>
                    `₹${value.toLocaleString("en-IN")}`
                  }
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Monthly GST Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly GST Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.monthlyBreakdown}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) =>
                    `₹${value.toLocaleString("en-IN")}`
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="totalGST"
                  stroke="#FF5F00"
                  strokeWidth={2}
                  name="Total GST"
                />
                <Line
                  type="monotone"
                  dataKey="taxableAmount"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  name="Taxable Amount"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Branch-wise GST */}
      <Card>
        <CardHeader>
          <CardTitle>Branch-wise GST Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.branchBreakdown}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="branchName" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) =>
                  `₹${value.toLocaleString("en-IN")}`
                }
              />
              <Legend />
              <Bar dataKey="cgst" stackId="a" fill={COLORS.CGST} name="CGST" />
              <Bar dataKey="sgst" stackId="a" fill={COLORS.SGST} name="SGST" />
              <Bar dataKey="igst" stackId="a" fill={COLORS.IGST} name="IGST" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Section A — Output GST */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-orange-500" />
            Section A — Output GST
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data.sectionA_output || []}
            isLoading={loading}
            emptyMessage="No output GST records found"
          />
        </CardContent>
      </Card>

      {/* Section B — Input GST (deferred) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Section B — Input GST
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              {data.inputNote || "Input GST not configured"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Input GST is deferred. Net liability equals total output GST.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
