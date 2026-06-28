import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { DashboardKPIs } from "@/components/manager/dashboard/DashboardKPIs";
import { DamageReports } from "@/components/manager/dashboard/DamageReports";
import { StaffActivity } from "@/components/manager/dashboard/StaffActivity";
import { QuickActions } from "@/components/manager/dashboard/QuickActions";
import { QrScannerModal } from "@/components/employee/QrScannerModal";
import {
  managerDashboardService,
  type KPIStats,
  type DamageReport,
} from "@/services/managerDashboard.service";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Search, QrCode, RefreshCw } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

export const DashboardPage = () => {
  const navigate = useNavigate();

  const [stats, setStats] = useState<KPIStats | null>(null);
  const [damageReports, setDamageReports] = useState<DamageReport[]>([]);
  const [damagePage, setDamagePage] = useState(1);
  const [hasMoreDamages, setHasMoreDamages] = useState(true);
  const [staffActivity, setStaffActivity] = useState<any[]>([]);
  const [damageSearchId, setDamageSearchId] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDamages, setIsLoadingDamages] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const debouncedSearch = useDebounce(damageSearchId, 500);

  useEffect(() => {
    loadDamageReports(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    try {
      setIsLoading(true);
      const [dashboardStats, activity] = await Promise.all([
        managerDashboardService.getDashboardStats(),
        managerDashboardService.getStaffActivity(),
      ]);
      setStats(dashboardStats);
      setStaffActivity(activity || []);
      await loadDamageReports(1, true);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Failed to load dashboard";
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAll();
    setIsRefreshing(false);
  };

  const loadDamageReports = async (page: number, reset = false) => {
    try {
      setIsLoadingDamages(true);
      const limit = 5;
      const newReports = await managerDashboardService.getDamageReports(page, limit, debouncedSearch);
      if (reset) {
        setDamageReports(newReports);
      } else {
        setDamageReports((prev) => [...prev, ...newReports]);
      }
      setHasMoreDamages(newReports.length >= limit);
      setDamagePage(page);
    } catch {
      toast.error("Failed to load damage reports");
    } finally {
      setIsLoadingDamages(false);
    }
  };

  const handleLoadMoreDamages = () => {
    if (!isLoadingDamages && hasMoreDamages) loadDamageReports(damagePage + 1);
  };

  const handleQrScan = (data: string | null) => {
    if (data) {
      const damageId = data.trim();
      toast.success(`Scanned Damage Report #${damageId}`);
      navigate(`/damage/${damageId}`);
    }
  };

  // Current date/time display
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <ManagerLayout>
      <div
        className="min-h-screen"
        style={{ backgroundColor: "#F8F7F5" }}
      >
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 space-y-6">

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <p
                className="text-[10px] font-bold uppercase tracking-[0.18em] mb-1"
                style={{ color: "#9ca3af" }}
              >
                Branch Operations
              </p>
              <h1
                className="text-2xl font-bold tracking-tight"
                style={{ color: "#1a1917", fontFamily: "'DM Sans', sans-serif" }}
              >
                Dashboard
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>
                {dateStr}
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2 self-start sm:self-auto border-[#e8e6e1] bg-white text-[#6b6860] hover:text-[#1a1917] h-9"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* ── KPIs ───────────────────────────────────────────────────────── */}
          <DashboardKPIs stats={stats} isLoading={isLoading} />

          {/* ── Quick Actions ──────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-[#e8e6e1] bg-white px-5 py-4">
            <QuickActions />
          </div>

          {/* ── Main Content ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

            {/* Left: Damage Reports (2/3) */}
            <div className="xl:col-span-2 space-y-3">
              {/* Search bar */}
              <div
                className="flex items-center gap-3 rounded-xl border border-[#e8e6e1] bg-white px-4 py-2.5"
              >
                <Search className="w-4 h-4 shrink-0" style={{ color: "#9ca3af" }} />
                <Input
                  placeholder="Search damage report by vehicle or ID…"
                  className="flex-1 border-none shadow-none focus-visible:ring-0 px-0 h-auto text-sm bg-transparent placeholder:text-[#c4c0bb]"
                  value={damageSearchId}
                  onChange={(e) => setDamageSearchId(e.target.value)}
                />
                <div
                  className="h-5 w-px shrink-0"
                  style={{ backgroundColor: "#e8e6e1" }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs h-8 px-3 shrink-0 text-[#6b6860] hover:text-[#1a1917]"
                  onClick={() => setIsScannerOpen(true)}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  Scan QR
                </Button>
              </div>

              <DamageReports
                reports={damageReports}
                isLoading={isLoading || (isLoadingDamages && damageReports.length === 0)}
                onLoadMore={handleLoadMoreDamages}
                hasMore={hasMoreDamages}
              />
            </div>

            {/* Right: Staff Activity (1/3) */}
            <div className="xl:col-span-1">
              <StaffActivity activities={staffActivity} isLoading={isLoading} />
            </div>
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
