import { useState, useEffect } from "react";
import { AlertTriangle, Calendar, Car, Shield } from "lucide-react";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { formatDate } from "@/utils/formatters";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { adminService } from "@/services/admin.service";

// ============================================================================
// Types
// ============================================================================

interface VehicleExpiryData {
  vehicleId: string;
  regNo: string;
  make: string;
  model: string;
  year: number;
  category: string;
  branch: string;
  status: string;
  insurance: {
    expiryDate: string | null;
    daysRemaining: number | null;
    alertLevel: string | null;
    policyNumber: string | null;
    provider: string | null;
  };
  permit: {
    expiryDate: string | null;
    daysRemaining: number | null;
    alertLevel: string | null;
    permitNumber: string | null;
  };
  overallAlertLevel: string;
}

// ============================================================================
// Insurance/Permit Expiry Report Component
// ============================================================================

const ALERT_COLORS: Record<string, string> = {
  EXPIRED: "#DC2626",
  CRITICAL: "#EF4444",
  HIGH: "#F59E0B",
  MEDIUM: "#FCD34D",
  LOW: "#10B981",
};

export const InsurancePermitExpiryReport = () => {
  const [daysThreshold, setDaysThreshold] = useState<string>("90");
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [alertType, setAlertType] = useState<string>("both");
  const [reportData, setReportData] = useState<any>(null);
  const [branches, setBranches] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch branches on mount
  useEffect(() => {
    fetchBranches();
  }, []);

  // Fetch report data when filters change
  useEffect(() => {
    fetchReportData();
  }, [daysThreshold, selectedBranch, alertType]);

  const fetchBranches = async () => {
    try {
      const data = await adminService.getBranches();
      const branchOptions = data.map((branch: any) => ({
        value: branch.publicId,
        label: branch.name,
      }));
      setBranches(branchOptions);
    } catch (error) {
      console.error("Failed to fetch branches:", error);
    }
  };

  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      const params = {
        daysThreshold: parseInt(String(daysThreshold), 10),
        alertType: alertType as "insurance" | "permit" | "all",
        branchId: selectedBranch !== "all" ? selectedBranch : undefined,
      };

      const result = await adminService.getInsurancePermitExpiryReport(params);
      setReportData(result.data);
    } catch (error) {
      console.error("Error fetching report:", error);
      toast.error("Failed to load expiry report. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const getExportUrl = () => {
    const params: Record<string, any> = {
      daysThreshold,
      alertType,
    };

    if (selectedBranch !== "all") {
      params.branchId = selectedBranch;
    }

    const queryString = new URLSearchParams(params).toString();
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    return `${baseUrl}/admin/dashboard/reports/insurance-permit-expiry?${queryString}`;
  };

  const getAlertBadge = (level: string | null) => {
    if (!level) return null;

    const colors: Record<string, string> = {
      EXPIRED: "bg-red-100 text-red-800 border-red-200",
      CRITICAL: "bg-red-100 text-red-700 border-red-200",
      HIGH: "bg-orange-100 text-orange-700 border-orange-200",
      MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-200",
      LOW: "bg-green-100 text-green-700 border-green-200",
    };

    return (
      <span
        className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${colors[level] || ""}`}
      >
        {level}
      </span>
    );
  };

  // Table columns
  const columns: ColumnDef<VehicleExpiryData>[] = [
    {
      accessorKey: "regNo",
      header: "Vehicle",
      cell: ({ row }) => (
        <div>
          <div className="font-medium font-mono">{row.original.regNo}</div>
          <div className="text-xs text-gray-500">
            {row.original.make} {row.original.model}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "branch",
      header: "Branch",
      cell: ({ row }) => <div className="text-sm">{row.original.branch}</div>,
    },
    {
      accessorKey: "insurance",
      header: "Insurance Expiry",
      cell: ({ row }) => (
        <div>
          {row.original.insurance.expiryDate ? (
            <>
              <div className="text-sm">
                {formatDate(row.original.insurance.expiryDate)}
              </div>
              <div className="text-xs text-gray-500">
                {row.original.insurance.daysRemaining !== null &&
                row.original.insurance.daysRemaining >= 0
                  ? `${row.original.insurance.daysRemaining} days`
                  : "Expired"}
              </div>
            </>
          ) : (
            <span className="text-gray-400">N/A</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "permit",
      header: "Permit Expiry",
      cell: ({ row }) => (
        <div>
          {row.original.permit.expiryDate ? (
            <>
              <div className="text-sm">
                {formatDate(row.original.permit.expiryDate)}
              </div>
              <div className="text-xs text-gray-500">
                {row.original.permit.daysRemaining !== null &&
                row.original.permit.daysRemaining >= 0
                  ? `${row.original.permit.daysRemaining} days`
                  : "Expired"}
              </div>
            </>
          ) : (
            <span className="text-gray-400">N/A</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "overallAlertLevel",
      header: "Alert Level",
      cell: ({ row }) => getAlertBadge(row.original.overallAlertLevel),
    },
  ];

  // Alert distribution chart data
  const alertDistributionData = reportData?.summary.alertDistribution
    ? [
        {
          name: "Expired",
          value: reportData.summary.alertDistribution.expired,
          color: ALERT_COLORS.EXPIRED,
        },
        {
          name: "Critical",
          value: reportData.summary.alertDistribution.critical,
          color: ALERT_COLORS.CRITICAL,
        },
        {
          name: "High",
          value: reportData.summary.alertDistribution.high,
          color: ALERT_COLORS.HIGH,
        },
        {
          name: "Medium",
          value: reportData.summary.alertDistribution.medium,
          color: ALERT_COLORS.MEDIUM,
        },
        {
          name: "Low",
          value: reportData.summary.alertDistribution.low,
          color: ALERT_COLORS.LOW,
        },
      ].filter((item) => item.value > 0)
    : [];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="h-8 w-8 text-orange-500" />
            Insurance & Permit Expiry Alerts
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Vehicles expiring in next {daysThreshold} days
          </p>
        </div>

        <ExportButton
          apiUrl={getExportUrl()}
          filename={`insurance-permit-expiry-${new Date().toISOString().split("T")[0]}`}
          disabled={isLoading || !reportData}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Alert Type
              </label>
              <Select value={alertType} onValueChange={setAlertType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="insurance">Insurance Only</SelectItem>
                  <SelectItem value="permit">Permit Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Days Threshold
              </label>
              <Select value={daysThreshold} onValueChange={setDaysThreshold}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 Days</SelectItem>
                  <SelectItem value="60">60 Days</SelectItem>
                  <SelectItem value="90">90 Days</SelectItem>
                  <SelectItem value="180">180 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
          </div>
        </CardContent>
      </Card>

      {/* Summary Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Alert Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Vehicles"
            value={reportData?.summary.totalVehicles.toString() || "0"}
            icon={Car}
            variant="default"
            isLoading={isLoading}
          />
          <MetricCard
            title="Critical Alerts"
            value={reportData?.summary.criticalAlerts.toString() || "0"}
            icon={AlertTriangle}
            variant="collection"
            isLoading={isLoading}
          />
          <MetricCard
            title="Insurance Expiring"
            value={reportData?.summary.insuranceExpiring.toString() || "0"}
            icon={Shield}
            variant="bookings"
            isLoading={isLoading}
          />
          <MetricCard
            title="Permit Expiring"
            value={reportData?.summary.permitExpiring.toString() || "0"}
            icon={Calendar}
            variant="fleet"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alert Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Alert Distribution by Severity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alertDistributionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={alertDistributionData}
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
                    {alertDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-gray-500">
                No alerts found
              </div>
            )}
          </CardContent>
        </Card>

        {/* Branch Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Branch-wise Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportData?.branchBreakdown &&
            reportData.branchBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={reportData.branchBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="branch" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="critical" fill="#EF4444" name="Critical" />
                  <Bar dataKey="high" fill="#F59E0B" name="High Priority" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-gray-500">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vehicle List Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Car className="h-5 w-5 text-orange-500" />
            Vehicle Expiry Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={reportData?.vehicles || []}
            isLoading={isLoading}
            emptyMessage="No vehicles with upcoming expiry found"
          />
        </CardContent>
      </Card>
    </div>
  );
};
