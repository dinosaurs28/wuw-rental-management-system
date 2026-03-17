import { AlertTriangle, ArrowUpRight, Car, Key, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

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
  active?: boolean;
}

function StatsCard({
  title,
  value,
  icon: Icon,
  trend,
  alert,
  active,
}: StatsCardProps) {
  return (
    <div
      className={cn(
        "p-6 rounded-xl bg-card border shadow-sm transition-all duration-200",
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
          <h3 className="text-3xl font-bold tracking-tight">{value}</h3>
          {alert && (
            <span className="text-sm font-medium text-orange-600">
              Pending Approvals
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function DashboardStats() {
  // Mock data based on reference image
  // In real app, props would be passed or fetched here
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Today's Pickups"
        value="12"
        icon={Car}
        trend={{ value: "+12% vs yst", positive: true, label: "vs yesterday" }}
      />
      <StatsCard
        title="Today's Returns"
        value="8"
        icon={RotateCcw}
        trend={{ value: "No change", positive: true, label: "vs yesterday" }}
      />
      <StatsCard
        title="ACTION REQUIRED"
        value="3"
        icon={AlertTriangle}
        alert={true}
        active={true}
      />
      <StatsCard
        title="Active Rentals"
        value="45"
        icon={Key}
        trend={{ value: "+5% vs yst", positive: true, label: "vs yesterday" }}
      />
    </div>
  );
}
