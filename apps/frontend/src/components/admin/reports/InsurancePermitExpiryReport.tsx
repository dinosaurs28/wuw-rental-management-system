import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, Clock, Shield, Car } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDate } from "@/utils/formatters";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { adminService } from "@/services/admin.service";

// ============================================================================
// Types — EXACT backend field names (spec §4.7)
// ============================================================================

type InsuranceStatus = "Expired" | "Expiring Soon" | "Valid";

interface VehicleExpiryRow {
  vehicleId: string;
  regNo: string;
  vehicleName: string;
  category: string;
  branch: string;
  insuranceStatus: InsuranceStatus;
  provider: string;
  policyNumber: string;
  insuranceStartDate: string;
  insuranceExpiryDate: string;
  daysUntilExpiry: number;
}

interface ReportSummary {
  totalVehicles: number;
  expired: number;
  expiringSoon: number;
  valid: number;
}

interface ReportData {
  summary: ReportSummary;
  vehicles: VehicleExpiryRow[];
}

// ============================================================================
// Status presentation helpers
// ============================================================================

// Full-row background per status (Expired = red, Expiring Soon = yellow,
// Valid = normal). DataTable has no per-row class hook, so each cell paints
// the status colour and bleeds into the cell's `p-2` padding via `-m-2 p-2`,
// `h-full` keeps the stripe even across cells of differing content height.
const rowBgClass = (status: InsuranceStatus): string => {
  switch (status) {
    case "Expired":
      return "bg-red-50";
    case "Expiring Soon":
      return "bg-yellow-50";
    default:
      return "";
  }
};

const CellShell = ({
  status,
  children,
}: {
  status: InsuranceStatus;
  children: React.ReactNode;
}) => (
  <div className={`-m-2 p-2 h-full flex items-center ${rowBgClass(status)}`}>
    {children}
  </div>
);

const STATUS_BADGE: Record<InsuranceStatus, string> = {
  Expired: "bg-red-100 text-red-800 border-red-200",
  "Expiring Soon": "bg-yellow-100 text-yellow-800 border-yellow-200",
  Valid: "bg-green-100 text-green-800 border-green-200",
};

const StatusBadge = ({ status }: { status: InsuranceStatus }) => (
  <span
    className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${STATUS_BADGE[status] || ""}`}
  >
    {status}
  </span>
);

// ============================================================================
// Insurance Expiry Report Component
// ============================================================================

export const InsurancePermitExpiryReport = () => {
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  // expiryStatus values accepted by controller: all | expiring | expired | valid
  const [expiryStatus, setExpiryStatus] = useState<string>("all");
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [branches, setBranches] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [categories, setCategories] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch filter options on mount
  useEffect(() => {
    fetchFilters();
  }, []);

  // Fetch report data when filters change
  useEffect(() => {
    fetchReportData();
  }, [selectedBranch, selectedCategory, expiryStatus]);

  const fetchFilters = async () => {
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

  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      const params: {
        expiryStatus: string;
        branchId?: string;
        categories?: string;
      } = {
        expiryStatus,
      };

      if (selectedBranch !== "all") {
        params.branchId = selectedBranch;
      }
      if (selectedCategory !== "all") {
        params.categories = selectedCategory;
      }

      const result = await adminService.getInsurancePermitExpiryReport(params);
      setReportData(result.data);
    } catch (error) {
      console.error("Error fetching report:", error);
      toast.error("Failed to load insurance expiry report. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const getExportUrl = () => {
    const params: Record<string, string> = {
      expiryStatus,
      export: "csv",
    };

    if (selectedBranch !== "all") {
      params.branchId = selectedBranch;
    }
    if (selectedCategory !== "all") {
      params.categories = selectedCategory;
    }

    const queryString = new URLSearchParams(params).toString();
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/insurance-permit-expiry?${queryString}`;
  };

  // Table columns (spec §4.7 order). Every cell is wrapped in CellShell so the
  // status background spans the full row.
  const columns: ColumnDef<VehicleExpiryRow>[] = [
    {
      accessorKey: "regNo",
      header: "Vehicle Reg No",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="font-medium font-mono">{row.original.regNo}</span>
        </CellShell>
      ),
    },
    {
      accessorKey: "vehicleName",
      header: "Vehicle Name",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm">{row.original.vehicleName}</span>
        </CellShell>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm">{row.original.category}</span>
        </CellShell>
      ),
    },
    {
      accessorKey: "branch",
      header: "Branch",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm">{row.original.branch}</span>
        </CellShell>
      ),
    },
    {
      accessorKey: "provider",
      header: "Insurance Provider",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm">
            {row.original.provider || <span className="text-gray-400">—</span>}
          </span>
        </CellShell>
      ),
    },
    {
      accessorKey: "policyNumber",
      header: "Policy Number",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm font-mono">
            {row.original.policyNumber || (
              <span className="text-gray-400">—</span>
            )}
          </span>
        </CellShell>
      ),
    },
    {
      accessorKey: "insuranceStartDate",
      header: "Insurance Start Date",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm">
            {row.original.insuranceStartDate ? (
              formatDate(row.original.insuranceStartDate)
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </span>
        </CellShell>
      ),
    },
    {
      accessorKey: "insuranceExpiryDate",
      header: "Insurance Expiry Date",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm">
            {row.original.insuranceExpiryDate ? (
              formatDate(row.original.insuranceExpiryDate)
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </span>
        </CellShell>
      ),
    },
    {
      accessorKey: "daysUntilExpiry",
      header: "Days Until Expiry",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <span className="text-sm">
            {row.original.daysUntilExpiry < 0
              ? `${Math.abs(row.original.daysUntilExpiry)} days ago`
              : `${row.original.daysUntilExpiry} days`}
          </span>
        </CellShell>
      ),
    },
    {
      accessorKey: "insuranceStatus",
      header: "Status",
      cell: ({ row }) => (
        <CellShell status={row.original.insuranceStatus}>
          <StatusBadge status={row.original.insuranceStatus} />
        </CellShell>
      ),
    },
  ];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="h-8 w-8 text-orange-500" />
            Insurance Expiry Report
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Vehicle insurance compliance status
          </p>
        </div>

        <ExportButton
          apiUrl={getExportUrl()}
          filename={`insurance-expiry-${new Date().toISOString().split("T")[0]}`}
          disabled={isLoading || !reportData}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Branch</label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.value} value={branch.value}>
                      {branch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Category</label>
              <Select
                value={selectedCategory}
                onValueChange={setSelectedCategory}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Expiry Status
              </label>
              <Select value={expiryStatus} onValueChange={setExpiryStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="expiring">Expiring Soon</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="valid">Valid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Insurance Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Expired"
            value={reportData?.summary.expired.toString() || "0"}
            icon={AlertTriangle}
            variant="collection"
            isLoading={isLoading}
          />
          <MetricCard
            title="Expiring within 30 days"
            value={reportData?.summary.expiringSoon.toString() || "0"}
            icon={Clock}
            variant="bookings"
            isLoading={isLoading}
          />
          <MetricCard
            title="Valid"
            value={reportData?.summary.valid.toString() || "0"}
            icon={CheckCircle}
            variant="fleet"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Vehicle List Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Car className="h-5 w-5 text-orange-500" />
            Vehicle Insurance Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={reportData?.vehicles || []}
            isLoading={isLoading}
            emptyMessage="No vehicles found for the selected filters"
          />
        </CardContent>
      </Card>
    </div>
  );
};
