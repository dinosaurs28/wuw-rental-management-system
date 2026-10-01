import { AlertTriangle, ArrowUpRight, Car, Key, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmployeeDashboardStats } from "@/services/employee.service";
import { Skeleton } from "@/components/ui/skeleton";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: {
    value: string;
    positive: boolean;
    label: string;
  };
  alert?: boolean;
  /** Text shown next to the value while `alert` is on. */
  alertLabel?: string;
  active?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
}

function StatsCard({
  title,
  value,
  icon: Icon,
  trend,
  alert,
  alertLabel,
  active,
  isLoading,
  onClick,
}: StatsCardProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "p-6 rounded-xl bg-card border shadow-sm transition-all duration-200",
        onClick && "cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active && "border-primary/50 ring-1 ring-primary/20",
        alert && "border-orange-200 bg-orange-50/30",
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center",
            alert
              ? "bg-orange-100 text-orange-600"
              : "bg-muted text-muted-foreground",
            active && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        {alert ? (
          <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </div>
        ) : trend ? (
          <div
            className={cn(
              "flex items-center text-xs font-medium px-2 py-1 rounded-full",
              trend.positive
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700",
              trend.value === "No change" && "bg-gray-100 text-gray-600",
            )}
          >
            {trend.positive && <ArrowUpRight className="h-3 w-3 mr-1" />}
            {trend.value}
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <p
          className={cn(
            "text-sm font-medium",
            alert ? "text-orange-700" : "text-muted-foreground",
          )}
        >
          {title}
        </p>
        <div className="flex items-baseline gap-2">
          {isLoading ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <h3 className="text-3xl font-bold tracking-tight">{value}</h3>
          )}
          {alert && alertLabel && !isLoading && (
            <span className="text-sm font-medium text-orange-600">
              {alertLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface DashboardStatsProps {
  stats?: EmployeeDashboardStats;
  isLoading: boolean;
  /** Opens the overdue returns list. */
  onOverdueClick?: () => void;
  /** Highlights the overdue tile while that list is shown. */
  overdueActive?: boolean;
}

export function DashboardStats({
  stats,
  isLoading,
  onOverdueClick,
  overdueActive,
}: DashboardStatsProps) {
  const overdueReturns = stats?.overdueReturns ?? 0;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Today's Pickups"
        value={stats?.todaysPickups ?? 0}
        icon={Car}
        isLoading={isLoading}
      />
      <StatsCard
        title="Today's Returns"
        value={stats?.todaysReturns ?? 0}
        icon={RotateCcw}
        isLoading={isLoading}
      />
      <StatsCard
        title="Overdue Returns"
        value={overdueReturns}
        icon={AlertTriangle}
        alert={overdueReturns > 0}
        alertLabel="Not returned yet"
        active={overdueActive}
        isLoading={isLoading}
        onClick={onOverdueClick}
      />
      <StatsCard
        title="Active Rentals"
        value={stats?.activeRentals ?? 0}
        icon={Key}
        isLoading={isLoading}
      />
    </div>
  );
}

