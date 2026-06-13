import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import type { StaffActivity as StaffActivityType } from "@/services/managerDashboard.service";
import { Activity, ArrowRight } from "lucide-react";

interface StaffActivityProps {
  activities?: StaffActivityType[];
  isLoading?: boolean;
}

const roleColor = (action: string) => {
  if (action.toLowerCase().includes("pickup")) return "#16a34a";
  if (action.toLowerCase().includes("return")) return "#2563eb";
  if (action.toLowerCase().includes("damage")) return "#dc2626";
  if (action.toLowerCase().includes("cancel")) return "#9ca3af";
  return "#e85d04";
};

export const StaffActivity = ({
  activities = [],
  isLoading = false,
}: StaffActivityProps) => {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-1.5">
            <Activity className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="font-bold text-[#1a1917] text-sm">Staff Activity</h2>
            <p className="text-[11px] text-[#9ca3af]">Last 10 actions</p>
          </div>
        </div>
        <button
          onClick={() => navigate("/manager/staff-activity")}
          className="flex items-center gap-1 text-[11px] font-semibold text-[#e85d04] hover:text-[#c2410c] transition-colors"
        >
          View All <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-5 space-y-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-2 h-2 rounded-full mt-1.5 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[#9ca3af]">No recent activity</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[28px] top-4 bottom-4 w-px bg-[#f0ede8]" />

            <div className="py-3 space-y-0">
              {activities.slice(0, 10).map((activity, idx) => {
                const color = roleColor(activity.action);
                const time = new Date(activity.timestamp);
                const isToday = new Date().toDateString() === time.toDateString();

                return (
                  <div
                    key={activity.id}
                    className="relative flex gap-4 px-5 py-3 hover:bg-[#fafaf9] transition-colors"
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    {/* Dot */}
                    <div className="relative z-10 mt-1 shrink-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full ring-2 ring-white"
                        style={{ backgroundColor: color }}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1a1917] leading-snug">
                        <span className="font-semibold">{activity.employeeName}</span>{" "}
                        <span className="text-[#6b6860]">{activity.action}</span>
                      </p>
                      <time className="text-[10px] font-mono text-[#b5b0a8] mt-0.5 block">
                        {isToday
                          ? time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                          : time.toLocaleDateString("en-IN", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                      </time>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
