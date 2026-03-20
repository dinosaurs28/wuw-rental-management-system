import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import { DashboardKPIs } from "@/components/manager/dashboard/DashboardKPIs";
import { DamageReports } from "@/components/manager/dashboard/DamageReports";
import { ManagerConfirmations } from "@/components/manager/dashboard/ManagerConfirmations";
import { StaffActivity } from "@/components/manager/dashboard/StaffActivity";
import { RecentVehicleSwaps } from "@/components/manager/dashboard/RecentVehicleSwaps";
import { QuickActions } from "@/components/manager/dashboard/QuickActions";
import { DashboardActiveBookings } from "@/components/manager/dashboard/DashboardActiveBookings";
import { QrScannerModal } from "@/components/employee/QrScannerModal";
import {
  managerDashboardService,
  type KPIStats,
  type DamageReport,
} from "@/services/managerDashboard.service";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Search, QrCode } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

export const DashboardPage = () => {
  const navigate = useNavigate();

  // State for all data
  const [stats, setStats] = useState<KPIStats | null>(null);
  const [damageReports, setDamageReports] = useState<DamageReport[]>([]);
  const [damagePage, setDamagePage] = useState(1);
  const [hasMoreDamages, setHasMoreDamages] = useState(true);
  const [staffActivity, setStaffActivity] = useState<any[]>([]);

  // Search State
  const [damageSearchId, setDamageSearchId] = useState("");
  const debouncedSearch = useDebounce(damageSearchId, 500);

  // QR Scanner State
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDamages, setIsLoadingDamages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effect to reload reports when search changes
  useEffect(() => {
    loadDamageReports(1, true);
  }, [debouncedSearch]);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setIsLoading(true);
        // Parallel fetching of required data
        const [dashboardStats, activity] = await Promise.all([
          managerDashboardService.getDashboardStats(),
          managerDashboardService.getStaffActivity(),
        ]);

        setStats(dashboardStats);
        setStaffActivity(activity || []);

        // Load initial damage reports
        loadDamageReports(1, true);
      } catch (err: any) {
        console.error("Failed to load dashboard data", err);
        const errorMessage =
          err.response?.data?.message ||
          err.message ||
          "Failed to load dashboard data.";
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboardData();
  }, []);

  const loadDamageReports = async (page: number, reset = false) => {
    try {
      setIsLoadingDamages(true);
      const limit = 5;
      const newReports = await managerDashboardService.getDamageReports(
        page,
        limit,
        debouncedSearch,
      );

      if (reset) {
        setDamageReports(newReports);
      } else {
        setDamageReports((prev) => [...prev, ...newReports]);
      }

      if (newReports.length < limit) {
        setHasMoreDamages(false);
      } else {
        setHasMoreDamages(true);
      }
      setDamagePage(page);
    } catch (err) {
      console.error("Failed to load damage reports", err);
      toast.error("Failed to load damage reports");
    } finally {
      setIsLoadingDamages(false);
    }
  };

  const handleLoadMoreDamages = () => {
    if (!isLoadingDamages && hasMoreDamages) {
      loadDamageReports(damagePage + 1);
    }
  };

  const handleScanQR = () => {
    setIsScannerOpen(true);
  };

  const handleQrScan = (data: string | null) => {
    if (data) {
      // Extract damage ID from scanned data
      // Assuming QR code contains just the damage ID (e.g., "1", "2", etc.)
      const damageId = data.trim();
      toast.success(`Scanned Damage Report #${damageId}`);
      navigate(`/damage/${damageId}`);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border max-w-md w-full text-center space-y-4">
          <div className="text-red-500 font-bold text-lg">
            Error Loading Dashboard
          </div>
          <p className="text-neutral-600">{error}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8">
        {/* Page Header */}
        <div className="mb-8">
          <Breadcrumb className="mb-4">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/dashboard">
                  Dashboard
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Branch Overview</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
                Branch Operations Dashboard
              </h1>
              <p className="text-neutral-500 mt-2 text-lg">
                Overview of vehicles, damage reports, and staff activity.
              </p>
            </div>
          </div>
        </div>

        {/* KPI Summary Cards */}
        <section className="mb-8">
          <DashboardKPIs stats={stats} isLoading={isLoading} />
        </section>

        {/* Quick Actions */}
        <section className="mb-8">
          <QuickActions />
        </section>

        {/* Damage Reports & Tools Section */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column (2/3 width) - Damage Reports */}
          <div className="xl:col-span-2 space-y-6">
            {/* Search & Tools Bar */}
            <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col md:flex-row gap-4 items-center">
              <div className="flex-1 w-full flex items-center gap-2">
                <Search className="w-5 h-5 text-neutral-400" />
                <Input
                  placeholder="Search Damage Report by ID..."
                  className="flex-1 border-none shadow-none focus-visible:ring-0 px-0 h-auto text-base"
                  value={damageSearchId}
                  onChange={(e) => setDamageSearchId(e.target.value)}
                />
              </div>
              <div className="w-px h-8 bg-neutral-200 hidden md:block"></div>
              <Button
                variant="outline"
                className="w-full md:w-auto gap-2"
                onClick={handleScanQR}
              >
                <QrCode className="w-4 h-4" />
                Scan QR Code
              </Button>
            </div>

            <section id="active-bookings-section">
              <DashboardActiveBookings />
            </section>

            <section id="damage-reports-section">
              <DamageReports
                reports={damageReports}
                isLoading={
                  isLoading || (isLoadingDamages && damageReports.length === 0)
                }
                onLoadMore={handleLoadMoreDamages}
                hasMore={hasMoreDamages}
              />
            </section>

            <section>
              <ManagerConfirmations />
            </section>

            <section id="recent-swaps-section">
              <RecentVehicleSwaps limit={5} />
            </section>
          </div>

          {/* Right Column (1/3 width) - Staff Activity */}
          <div className="xl:col-span-1 space-y-8">
            <section>
              <StaffActivity activities={staffActivity} isLoading={isLoading} />
            </section>
          </div>
        </div>
      </div>

      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleQrScan}
      />
    </ManagerLayout>
  );
};
