import { Skeleton } from "@/components/ui/skeleton";
import type { KPIStats } from "@/services/managerDashboard.service";
import { Car, WrenchIcon, AlertTriangle, Users } from "lucide-react";

interface DashboardKPIsProps {
  stats: KPIStats | null;
  isLoading: boolean;
}

const kpis = (stats: KPIStats | null) => [
  {
    label: "Available",
    value: stats?.activeVehicles,
    icon: Car,
    accent: "#16a34a",
    bg: "#f0fdf4",
    border: "#bbf7d0",
  },
  {
    label: "Inactive",
    value: stats?.inactiveVehicles,
    icon: Car,
    accent: "#6b7280",
    bg: "#f9fafb",
    border: "#e5e7eb",
  },
  {
    label: "Maintenance",
    value: stats?.maintenanceVehicles,
    icon: WrenchIcon,
    accent: "#d97706",
    bg: "#fffbeb",
    border: "#fde68a",
  },
  {
    label: "Open Damage",
    value: stats?.openDamageReports,
    icon: AlertTriangle,
    accent: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
  },
  {
    label: "Staff",
    value: stats?.staffOnDuty,
    icon: Users,
    accent: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
  },
];

export const DashboardKPIs = ({ stats, isLoading }: DashboardKPIsProps) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {kpis(stats).map(({ label, value, icon: Icon, accent, bg, border }) => (
        <div
          key={label}
          className="rounded-xl border p-4 flex flex-col gap-3 transition-shadow hover:shadow-sm"
          style={{ backgroundColor: bg, borderColor: border }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.12em]"
              style={{ color: accent }}
            >
              {label}
            </span>
            <div
              className="rounded-md p-1.5"
              style={{ backgroundColor: `${accent}18` }}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <span
              className="font-mono text-3xl font-bold leading-none tracking-tight"
              style={{ color: accent }}
            >
              {value ?? 0}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
