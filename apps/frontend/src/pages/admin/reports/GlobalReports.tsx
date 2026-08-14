import { useEffect, useState } from "react";

import { KPICard } from "../../../components/admin/reports/KPICard";
import {
  Activity,
  Car,
  CreditCard,
  DollarSign,
  TrendingUp,
  Users,
  AlertCircle,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { toast } from "sonner";
import { DashboardFilters } from "../../../components/admin/DashboardFilters";
import { adminService } from "@/services/admin.service";
import apiClient from "@/lib/axios";

interface GlobalKPIStats {
  totalFleetUtilization: {
    current: number;
    trend: number;
  };
  revenueThisMonth: {
    current: number;
    previous: number;
    trend: number;
  };
  activeBookings: {
    count: number;
    trend: number;
  };
  pendingRevenue: {
    amount: number;
    count: number;
  };
  totalCustomers: {
    count: number;
    allTime?: number;
    growth: number;
  };
  avgBookingValue: {
    amount: number;
    trend: number;
  };
}

export const GlobalReports = () => {
  const [data, setData] = useState<GlobalKPIStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Filter State
  const [branches, setBranches] = useState<
    { publicId: string; name: string }[]
  >([]);
  const [categories, setCategories] = useState<
    { publicId: string; name: string }[]
  >([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{
    start: Date | null;
    end: Date | null;
  }>({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default last 30 days
    end: new Date(),
  });

  // Fetch filter options
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [branchesData, categoriesData] = await Promise.all([
          adminService.getBranches(),
          adminService.getCategories(),
        ]);
        setBranches(branchesData);
        setCategories(categoriesData);
      } catch (err) {
        console.error("Failed to load filter options", err);
      }
    };
    fetchOptions();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(false);

      const params = new URLSearchParams();
      if (selectedBranchId !== "all")
        params.append("branchId", selectedBranchId);
      if (selectedCategories.length > 0)
        params.append("categories", selectedCategories.join(","));
      if (dateRange.start)
        params.append("startDate", dateRange.start.toISOString());
      if (dateRange.end) params.append("endDate", dateRange.end.toISOString());

      const response = await apiClient.get(
        `/admin/dashboard/reports/global-kpi?${params.toString()}`,
      );

      if (response.data) {
        setData(response.data);
      }
    } catch (err) {
      console.error("Failed to fetch global KPI stats:", err);
      setError(true);
      toast.error("Failed to load dashboard metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleApplyFilters = () => {
    fetchStats();
  };

  const handleResetFilters = () => {
    setSelectedBranchId("all");
    setSelectedCategories([]);
    setDateRange({
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end: new Date(),
    });
    // Need to wait for state update or pass defaults directly.
    // Effect dependency on these would trigger auto-fetch,
    // but typical pattern here is manual apply or effect driven.
    // Let's trigger fetch after state update via effect or manual call with defaults?
    // State updates are async. Easiest is to let user click Apply, or auto-fetch.
    // Let's rely on user clicking Apply for now, or use an effect listener if instant update desired.
    // But Reset should probably re-fetch immediately with defaults.

    // To ensure clean reset, we can clear state AND call fetch with explicit defaults
    setTimeout(() => {
      // slight delay to allow state verification or just call with defaults
      // Actually best to just set state and let user click Apply or trigger effect?
      // DashboardFilters pattern usually has explicit Apply.
      // However, Reset usually implies "Restore defaults and Show".
      // Let's trigger a fetch with empty params manually or wait for re-render if we add deps.
      // For now, let's just reload page concept or simpler:
      // window.location.reload(); // Too aggressive.
    }, 0);

    // Better:
    fetchStatsWithDefaults();
  };

  const fetchStatsWithDefaults = async () => {
    // Re-implementation of fetch with default values
    try {
      setLoading(true);
      const params = new URLSearchParams();
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = new Date();
      params.append("startDate", start.toISOString());
      params.append("endDate", end.toISOString());
      const response = await apiClient.get(
        `/api/admin/dashboard/reports/global-kpi?${params.toString()}`,
      );
      if (response.data) setData(response.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-dashed text-center min-h-[300px]">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">Failed to load reports</h3>
        <p className="text-sm text-muted-foreground mb-4">
          There was a problem fetching the latest data.
        </p>
        <Button onClick={fetchStats} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  // Format currency
  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) {
      return `₹${(amount / 10000000).toFixed(2)}Cr`;
    }
    if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(1)}L`;
    }
    if (amount >= 1000) {
      return `₹${(amount / 1000).toFixed(1)}K`;
    }
    return `₹${amount.toLocaleString()}`;
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const isFiltered =
    selectedBranchId !== "all" ||
    selectedCategories.length > 0 ||
    dateRange.start !== null;

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12 space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
            Global Reports
          </h1>
          <p className="text-neutral-500 mt-1 text-sm md:text-base">
            Key performance indicators and system-wide metrics.
          </p>
        </div>
      </div>

      <DashboardFilters
        selectedBranch={selectedBranchId}
        branches={branches}
        onBranchChange={setSelectedBranchId}
        selectedCategories={selectedCategories}
        categories={categories}
        onCategoriesChange={setSelectedCategories}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* 1. Total Fleet Utilization */}
        <div className="animate-in slide-in-from-bottom-3 duration-500 delay-75 fill-mode-backwards">
          <KPICard
            title="Fleet Utilization"
            value={loading ? "0" : `${data?.totalFleetUtilization.current}%`}
            icon={Car}
            colorTheme="blue"
            loading={loading}
            trend={data?.totalFleetUtilization.trend}
            subtitle={loading ? undefined : "Current fleet active"}
          />
        </div>

        {/* 2. Revenue This Month */}
        <div className="animate-in slide-in-from-bottom-3 duration-500 delay-100 fill-mode-backwards">
          <KPICard
            title={isFiltered ? "Revenue (Selected)" : "Revenue (MTD)"}
            value={
              loading
                ? "0"
                : formatCurrency(data?.revenueThisMonth.current || 0)
            }
            icon={DollarSign}
            colorTheme="emerald"
            loading={loading}
            trend={data?.revenueThisMonth.trend}
            subtitle={
              loading
                ? undefined
                : `vs ${formatCurrency(data?.revenueThisMonth.previous || 0)} prev. period`
            }
          />
        </div>

        {/* 3. Active Bookings */}
        <div className="animate-in slide-in-from-bottom-3 duration-500 delay-150 fill-mode-backwards">
          <KPICard
            title="Active Bookings"
            value={
              loading ? "0" : formatNumber(data?.activeBookings.count || 0)
            }
            icon={Activity}
            colorTheme="violet"
            loading={loading}
            trend={data?.activeBookings.trend}
            subtitle={loading ? undefined : "Currently ongoing trips"}
          />
        </div>

        {/* 4. Pending Revenue */}
        <div className="animate-in slide-in-from-bottom-3 duration-500 delay-200 fill-mode-backwards">
          <KPICard
            title="Pending Revenue"
            value={
              loading ? "0" : formatCurrency(data?.pendingRevenue.amount || 0)
            }
            icon={CreditCard}
            colorTheme="amber"
            loading={loading}
            subtitle={
              loading
                ? undefined
                : `${data?.pendingRevenue.count} confirmed bookings`
            }
          />
        </div>

        {/* 5. Total Customers */}
        <div className="animate-in slide-in-from-bottom-3 duration-500 delay-300 fill-mode-backwards">
          <KPICard
            title="Total Customers"
            value={
              loading ? "0" : formatNumber(data?.totalCustomers.count || 0)
            }
            icon={Users}
            colorTheme="cyan"
            loading={loading}
            trend={data?.totalCustomers.growth}
            subtitle={
              loading
                ? undefined
                : `${formatNumber(data?.totalCustomers.allTime || 0)} all-time registered`
            }
          />
        </div>

        {/* 6. Avg Booking Value */}
        <div className="animate-in slide-in-from-bottom-3 duration-500 delay-500 fill-mode-backwards">
          <KPICard
            title="Avg Booking Value"
            value={
              loading ? "0" : formatCurrency(data?.avgBookingValue.amount || 0)
            }
            icon={TrendingUp}
            colorTheme="rose"
            loading={loading}
            trend={data?.avgBookingValue.trend}
            subtitle={loading ? undefined : "Per booking (in range)"}
          />
        </div>
      </div>
    </div>
  );
};
