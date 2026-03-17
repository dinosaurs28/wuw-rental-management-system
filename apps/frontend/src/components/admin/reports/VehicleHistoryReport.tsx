import { useState, useEffect } from "react";
import {
  Car,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Calendar,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard } from "@/components/ui/MetricCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  formatCurrency,
  formatDate,
  abbreviateAmount,
} from "@/utils/formatters";
import { toast } from "sonner";
import { adminService } from "@/services/admin.service";
import type {
  VehicleHistoryData,
  VehicleHistoryBooking,
} from "@/services/admin.service";
import type { ColumnDef } from "@tanstack/react-table";

// ============================================================================
// Vehicle History Report Component
// ============================================================================

export interface VehicleHistoryReportProps {
  vehicleId: string; // Public ID of the vehicle
}

export const VehicleHistoryReport = ({
  vehicleId,
}: VehicleHistoryReportProps) => {
  const [reportData, setReportData] = useState<VehicleHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (vehicleId) {
      fetchReportData();
    }
  }, [vehicleId]);

  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      const result = await adminService.getVehicleHistory(vehicleId);
      if (typeof result !== "object" || result instanceof Blob) {
        throw new Error("Unexpected response format");
      }
      setReportData(result.data);
    } catch (error) {
      console.error("Error fetching vehicle history:", error);
      toast.error("Failed to load vehicle history. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Booking history table columns
  const bookingColumns: ColumnDef<VehicleHistoryBooking>[] = [
    {
      accessorKey: "bookingId",
      header: "Booking ID",
      cell: ({ row }) => (
        <div className="font-mono text-sm">{row.original.bookingId}</div>
      ),
    },
    {
      accessorKey: "customerName",
      header: "Customer",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.customerName}</div>
          <div className="text-xs text-gray-500">
            {row.original.customerPhone}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "startDate",
      header: "Period",
      cell: ({ row }) => (
        <div className="text-sm">
          <div>{formatDate(row.original.startDate)}</div>
          <div className="text-xs text-gray-500">
            to {formatDate(row.original.endDate)}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "days",
      header: "Days",
      cell: ({ row }) => <div className="text-sm">{row.original.days}</div>,
    },
    {
      accessorKey: "revenue",
      header: "Revenue",
      cell: ({ row }) => (
        <div className="font-semibold font-mono">
          {formatCurrency(row.original.revenue)}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "returnCondition",
      header: "Condition",
      cell: ({ row }) => (
        <span
          className={`text-sm ${
            row.original.returnCondition === "Good"
              ? "text-green-600"
              : "text-red-600"
          }`}
        >
          {row.original.returnCondition}
        </span>
      ),
    },
  ];

  // Prepare revenue trend data (last 10 bookings)
  const revenueTrendData =
    reportData?.bookingHistory.data
      .slice(0, 10)
      .reverse()
      .map((booking, index) => ({
        index: index + 1,
        revenue: booking.revenue,
        date: formatDate(booking.startDate).split("-").slice(0, 2).join("-"), // DD-MM
      })) || [];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Car className="h-8 w-8 text-orange-500" />
            {isLoading ? "Loading..." : reportData?.vehicle.regNo}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {reportData
              ? `${reportData.vehicle.make} ${reportData.vehicle.model}`
              : ""}
          </p>
          <p className="text-xs text-gray-500">
            {reportData?.vehicle.category} • {reportData?.vehicle.branch}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-2 items-center">
            <span className="text-sm font-medium">Status:</span>
            {reportData && <StatusBadge status={reportData.vehicle.status} />}
          </div>
          <ExportButton
            apiUrl={`${import.meta.env.VITE_API_URL || "http://localhost:3000/api"}/admin/dashboard/reports/vehicle-history/${vehicleId}`}
            filename={`vehicle-history-${reportData?.vehicle.regNo.replace(/\s/g, "-") || vehicleId}`}
            disabled={isLoading || !reportData}
          />
        </div>
      </div>

      {/* Performance Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-orange-500" />
          Performance Metrics
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Revenue"
            value={abbreviateAmount(
              reportData?.performanceMetrics.totalRevenue || 0,
            )}
            icon={DollarSign}
            variant="revenue"
            isLoading={isLoading}
          />
          <MetricCard
            title="Total Bookings"
            value={
              reportData?.performanceMetrics.totalBookings.toString() || "0"
            }
            icon={FileText}
            variant="bookings"
            isLoading={isLoading}
          />
          <MetricCard
            title="Utilization Rate"
            value={`${reportData?.performanceMetrics.utilizationRate.toFixed(1) || "0.0"}%`}
            icon={TrendingUp}
            variant="fleet"
            isLoading={isLoading}
          />
          <MetricCard
            title="ROI"
            value={`${reportData?.performanceMetrics.roi.toFixed(1) || "0.0"}%`}
            icon={DollarSign}
            variant="default"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Financial Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-orange-500" />
            Financial Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Total Revenue:</span>
                  <span className="font-semibold">
                    {formatCurrency(
                      reportData?.performanceMetrics.totalRevenue || 0,
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">
                    Avg Revenue/Booking:
                  </span>
                  <span className="font-semibold">
                    {formatCurrency(
                      reportData?.performanceMetrics.avgRevenuePerBooking || 0,
                    )}
                  </span>
                </div>
                {/* purchasePrice field removed - not in schema */}
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">
                    Maintenance Cost:
                  </span>
                  <span className="font-semibold text-orange-600">
                    {formatCurrency(
                      reportData?.performanceMetrics.totalMaintenanceCost || 0,
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Damage Cost:</span>
                  <span className="font-semibold text-red-600">
                    {formatCurrency(
                      reportData?.performanceMetrics.totalDamageCost || 0,
                    )}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="text-sm font-medium">
                    Net Profitability:
                  </span>
                  <span
                    className={`font-bold text-lg ${(reportData?.performanceMetrics.netProfitability || 0) >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {formatCurrency(
                      reportData?.performanceMetrics.netProfitability || 0,
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Alerts */}
      {reportData?.upcomingAlerts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Upcoming Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reportData.upcomingAlerts.insuranceExpiry && (
              <div
                className={`flex items-center gap-3 p-3 rounded-md ${reportData.upcomingAlerts.insuranceExpiry.daysRemaining <= 30 ? "bg-red-50 border border-red-200" : "bg-yellow-50 border border-yellow-200"}`}
              >
                <Calendar
                  className={`h-5 w-5 flex-shrink-0 ${reportData.upcomingAlerts.insuranceExpiry.daysRemaining <= 30 ? "text-red-600" : "text-yellow-600"}`}
                />
                <div>
                  <p className="text-sm font-medium">Insurance Expiry</p>
                  <p className="text-xs text-gray-600">
                    {formatDate(reportData.upcomingAlerts.insuranceExpiry.date)}{" "}
                    ({reportData.upcomingAlerts.insuranceExpiry.daysRemaining}{" "}
                    days)
                  </p>
                </div>
              </div>
            )}

            {/* permitExpiry and nextServiceDue not available in schema */}
          </CardContent>
        </Card>
      )}

      {/* Tabs for detailed history */}
      <Tabs defaultValue="bookings" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bookings">Booking History</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="damages">Damages</TabsTrigger>
        </TabsList>

        {/* Booking History Tab */}
        <TabsContent value="bookings" className="space-y-4">
          {/* Revenue Trend Chart */}
          {revenueTrendData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  Revenue Trend (Last 10 Bookings)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={revenueTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip
                      formatter={(value: any) => formatCurrency(value)}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#FF5F00"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Booking Data Table */}
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={bookingColumns}
                data={reportData?.bookingHistory.data || []}
                isLoading={isLoading}
                emptyMessage="No booking history available"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance">
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : reportData?.maintenanceHistory.length ? (
                <div className="space-y-3">
                  {reportData.maintenanceHistory.map((record) => (
                    <div key={record.id} className="border rounded-md p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium">{record.description}</p>
                          <p className="text-xs text-gray-500">
                            {formatDate(record.date)}
                          </p>
                        </div>
                        <span className="font-semibold text-orange-600">
                          {formatCurrency(record.cost)}
                        </span>
                      </div>
                      {/* odometer, servicedBy fields removed - not in schema */}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  No maintenance records available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Damages Tab */}
        <TabsContent value="damages">
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : reportData?.damageHistory.length ? (
                <div className="space-y-3">
                  {reportData.damageHistory.map((damage) => (
                    <div
                      key={damage.id}
                      className="border rounded-md p-4 bg-red-50"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-red-900">
                            {damage.severity
                              ? `${damage.severity} damage`
                              : "Damage reported"}
                          </p>
                          <p className="text-xs text-gray-600">
                            Booking: {damage.bookingId} • {damage.customerName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatDate(damage.reportedDate)}
                          </p>
                        </div>
                        <StatusBadge status={damage.status} />
                      </div>
                      <div className="flex gap-4 text-sm">
                        <span className="text-red-700">
                          Estimated: {formatCurrency(damage.estimatedCost)}
                        </span>
                        {damage.finalCost && damage.finalCost > 0 && (
                          <span className="text-red-900 font-semibold">
                            Final: {formatCurrency(damage.finalCost)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  No damage reports available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
