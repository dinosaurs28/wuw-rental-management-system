import { useEffect, useState } from "react";
import { Car, Clock, User, AlertTriangle, Calendar } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { managerDashboardService, type FleetBooking } from "@/services/managerDashboard.service";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getReturnStatus(endAt: string): { label: string; color: string; bg: string } {
  const now = Date.now();
  const end = new Date(endAt).getTime();
  const diffMs = end - now;
  const diffH = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) {
    const overdueH = Math.abs(diffH);
    const label =
      overdueH >= 24
        ? `${Math.floor(overdueH / 24)}d overdue`
        : `${Math.ceil(overdueH)}h overdue`;
    return { label, color: "#b91c1c", bg: "#fef2f2" };
  }
  if (diffH <= 2) return { label: "Due soon", color: "#b45309", bg: "#fffbeb" };
  if (diffH <= 24) {
    const label = `${Math.ceil(diffH)}h left`;
    return { label, color: "#b45309", bg: "#fffbeb" };
  }
  const days = Math.ceil(diffH / 24);
  return { label: `${days}d left`, color: "#15803d", bg: "#f0fdf4" };
}

function getPickupStatus(startAt: string): { label: string; color: string; bg: string } {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const diffH = (start - now) / (1000 * 60 * 60);

  if (diffH < 0) return { label: "Overdue pickup", color: "#b91c1c", bg: "#fef2f2" };
  if (diffH <= 3) return { label: "Pickup soon", color: "#b45309", bg: "#fffbeb" };
  if (diffH <= 24) return { label: `In ${Math.ceil(diffH)}h`, color: "#1d4ed8", bg: "#eff6ff" };
  const days = Math.ceil(diffH / 24);
  return { label: `In ${days}d`, color: "#6b7280", bg: "#f9fafb" };
}

// ── Row ────────────────────────────────────────────────────────────────────────

function BookingRow({
  booking,
  mode,
}: {
  booking: FleetBooking;
  mode: "picked_up" | "upcoming";
}) {
  const vehicle = booking.items[0]?.vehicle;
  const thumbUrl = vehicle?.images?.[0]?.file?.url;
  const vehicleName = vehicle ? `${vehicle.make} ${vehicle.model}` : "—";
  const regNo = vehicle?.regNo ?? "—";
  const customerName = booking.customer?.user?.name ?? "Unknown";

  const status =
    mode === "picked_up"
      ? getReturnStatus(booking.endAt)
      : getPickupStatus(booking.startAt);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-[#f0ede8] last:border-0 hover:bg-[#faf9f7] transition-colors"
    >
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-lg bg-[#f0ede8] overflow-hidden flex-shrink-0 flex items-center justify-center">
        {thumbUrl ? (
          <img src={thumbUrl} alt={vehicleName} className="w-full h-full object-cover" />
        ) : (
          <Car className="w-4 h-4" style={{ color: "#9ca3af" }} />
        )}
      </div>

      {/* Vehicle + customer */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1a1917] truncate">{vehicleName}</p>
        <p className="text-xs text-[#9ca3af] truncate">{regNo}</p>
      </div>

      {/* Customer */}
      <div className="hidden sm:flex items-center gap-1.5 min-w-0 w-32 flex-shrink-0">
        <User className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
        <span className="text-xs text-[#6b6860] truncate">{customerName}</span>
      </div>

      {/* Date */}
      <div className="hidden md:flex items-center gap-1.5 min-w-0 w-36 flex-shrink-0">
        <Calendar className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
        <span className="text-xs text-[#6b6860]">
          {mode === "picked_up"
            ? `Due ${formatDate(booking.endAt)}`
            : `Pickup ${formatDateTime(booking.startAt)}`}
        </span>
      </div>

      {/* Status badge */}
      <span
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
        style={{ color: status.color, backgroundColor: status.bg }}
      >
        {status.label}
      </span>
    </div>
  );
}

// ── Skeleton rows ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f0ede8]">
      <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-32 rounded" />
        <Skeleton className="h-2.5 w-20 rounded" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = "picked_up" | "upcoming";

export function FleetStatusPanel() {
  const [tab, setTab] = useState<Tab>("picked_up");
  const [pickedUp, setPickedUp] = useState<FleetBooking[]>([]);
  const [upcoming, setUpcoming] = useState<FleetBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      managerDashboardService.getFleetPickedUp(50),
      managerDashboardService.getFleetUpcoming(50),
    ])
      .then(([pu, uc]) => {
        if (cancelled) return;
        setPickedUp(pu);
        setUpcoming(uc);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const rows = tab === "picked_up" ? pickedUp : upcoming;

  // Sort: picked_up by return date asc (overdue first); upcoming by pickup date asc
  const sorted = [...rows].sort((a, b) => {
    const dateA = tab === "picked_up" ? a.endAt : a.startAt;
    const dateB = tab === "picked_up" ? b.endAt : b.startAt;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });

  const overdueCount = pickedUp.filter((b) => new Date(b.endAt).getTime() < Date.now()).length;

  return (
    <div className="rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden">
      {/* Header + tabs */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        <div>
          <h2 className="text-sm font-semibold text-[#1a1917]">Fleet Status</h2>
          <p className="text-xs text-[#9ca3af] mt-0.5">Live vehicle activity</p>
        </div>

        {overdueCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
            <AlertTriangle className="w-3 h-3" />
            {overdueCount} overdue
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-4 pt-3 border-b border-[#e8e6e1]">
        {(
          [
            { key: "picked_up", label: "Out on Road", count: pickedUp.length },
            { key: "upcoming",  label: "Upcoming Pickups", count: upcoming.length },
          ] as { key: Tab; label: string; count: number }[]
        ).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="relative pb-2.5 mr-5 text-xs font-medium transition-colors"
            style={{ color: tab === key ? "#1a1917" : "#9ca3af" }}
          >
            {label}
            <span
              className="ml-1.5 inline-flex items-center justify-center text-[10px] font-bold rounded-full px-1.5 py-px"
              style={{
                backgroundColor: tab === key ? "#1a1917" : "#f0ede8",
                color: tab === key ? "#fff" : "#9ca3af",
                minWidth: "18px",
              }}
            >
              {loading ? "—" : count}
            </span>
            {tab === key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1a1917] rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div className="divide-y-0">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <Clock className="w-8 h-8 mb-3" style={{ color: "#e8e6e1" }} />
            <p className="text-sm font-medium text-[#6b6860]">
              {tab === "picked_up" ? "No vehicles out on road" : "No upcoming pickups"}
            </p>
            <p className="text-xs text-[#9ca3af] mt-1">
              {tab === "picked_up"
                ? "All vehicles are currently at the branch"
                : "No confirmed bookings scheduled"}
            </p>
          </div>
        ) : (
          sorted.map((b) => (
            <BookingRow key={b.publicId} booking={b} mode={tab} />
          ))
        )}
      </div>
    </div>
  );
}
