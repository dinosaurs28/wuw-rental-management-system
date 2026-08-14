import { useEffect, useState } from "react";
import { Car, Clock, User, AlertTriangle, Calendar, Filter } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { managerDashboardService, type FleetBooking } from "@/services/managerDashboard.service";

// ── Helpers ────────────────────────────────────────────────────────────────────

function toLocalDateValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
  if (diffH <= 24) return { label: `${Math.ceil(diffH)}h left`, color: "#b45309", bg: "#fffbeb" };
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

function BookingRow({ booking, mode }: { booking: FleetBooking; mode: "picked_up" | "upcoming" }) {
  const vehicle = booking.items[0]?.vehicle;
  const thumbUrl = vehicle?.images?.[0]?.file?.url;
  const vehicleName = vehicle ? `${vehicle.make} ${vehicle.model}` : "—";
  const regNo = vehicle?.regNo ?? "—";
  const customerName = booking.customer?.user?.name ?? "Unknown";

  const status =
    mode === "picked_up" ? getReturnStatus(booking.endAt) : getPickupStatus(booking.startAt);

  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#f0ede8] last:border-0 hover:bg-[#faf9f7] transition-colors">
      <div className="w-10 h-10 rounded-lg bg-[#f0ede8] overflow-hidden flex-shrink-0 flex items-center justify-center">
        {thumbUrl ? (
          <img src={thumbUrl} alt={vehicleName} className="w-full h-full object-cover" />
        ) : (
          <Car className="w-4 h-4" style={{ color: "#9ca3af" }} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1a1917] truncate">{vehicleName}</p>
        <p className="text-xs text-[#9ca3af] truncate">{regNo}</p>
      </div>

      <div className="hidden sm:flex items-center gap-1.5 w-36 flex-shrink-0">
        <User className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
        <span className="text-xs text-[#6b6860] truncate">{customerName}</span>
      </div>

      <div className="hidden md:flex items-center gap-1.5 w-40 flex-shrink-0">
        <Calendar className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
        <span className="text-xs text-[#6b6860]">
          {mode === "picked_up"
            ? `Due ${formatDate(booking.endAt)}`
            : `Pickup ${formatDateTime(booking.startAt)}`}
        </span>
      </div>

      <span
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
        style={{ color: status.color, backgroundColor: status.bg }}
      >
        {status.label}
      </span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#f0ede8]">
      <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-36 rounded" />
        <Skeleton className="h-2.5 w-24 rounded" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "picked_up" | "upcoming";

export const FleetStatusPage = () => {
  const today = toLocalDateValue(new Date());
  const [tab, setTab] = useState<Tab>("picked_up");
  const [selectedDate, setSelectedDate] = useState(today);
  const [pickedUp, setPickedUp] = useState<FleetBooking[]>([]);
  const [upcoming, setUpcoming] = useState<FleetBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Fetch both without a backend date filter so all currently PICKED_UP vehicles
    // (including ones picked up on earlier days) are always included.
    Promise.all([
      managerDashboardService.getFleetPickedUp(200),
      managerDashboardService.getFleetUpcoming(200),
    ])
      .then(([pu, uc]) => {
        if (cancelled) return;
        setPickedUp(pu);
        setUpcoming(uc);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Date filter applies client-side to upcoming only — picked_up always shows all active vehicles
  const filteredUpcoming = upcoming.filter((b) => {
    const bookingDate = toLocalDateValue(new Date(b.startAt));
    return bookingDate === selectedDate || new Date(b.startAt).getTime() < Date.now();
  });

  const rows = tab === "picked_up" ? pickedUp : filteredUpcoming;
  const sorted = [...rows].sort((a, b) => {
    const dateA = tab === "picked_up" ? a.endAt : a.startAt;
    const dateB = tab === "picked_up" ? b.endAt : b.startAt;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });

  const overdueCount = pickedUp.filter((b) => new Date(b.endAt).getTime() < Date.now()).length;

  return (
    <ManagerLayout>
      <div className="min-h-screen" style={{ backgroundColor: "#F8F7F5" }}>
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6 space-y-5">

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
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
                Fleet Status
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>
                Live vehicle activity across all bookings
              </p>
            </div>

            {/* Date filter */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Filter className="w-3.5 h-3.5 shrink-0" style={{ color: "#9ca3af" }} />
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-9 text-sm border-[#e8e6e1] bg-white w-44"
              />
              {selectedDate !== today && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs text-[#6b6860] hover:text-[#1a1917]"
                  onClick={() => setSelectedDate(today)}
                >
                  Today
                </Button>
              )}
            </div>
          </div>

          {/* Panel */}
          <div className="rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-[#1a1917]">
                  {tab === "picked_up"
                    ? "All vehicles currently out"
                    : selectedDate === today
                    ? "Today's pickups"
                    : new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                </h2>
              </div>

              {overdueCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
                  <AlertTriangle className="w-3 h-3" />
                  {overdueCount} overdue
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex px-5 pt-3 border-b border-[#e8e6e1]">
              {(
                [
                  { key: "picked_up", label: "Out on Road", count: pickedUp.length },
                  { key: "upcoming", label: "Upcoming Pickups", count: filteredUpcoming.length },
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
            <div>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <Clock className="w-9 h-9 mb-3" style={{ color: "#e8e6e1" }} />
                  <p className="text-sm font-medium text-[#6b6860]">
                    {tab === "picked_up" ? "No vehicles out on road" : "No upcoming pickups"}
                  </p>
                  <p className="text-xs text-[#9ca3af] mt-1">
                    {tab === "picked_up"
                      ? "All vehicles are currently at the branch"
                      : "No confirmed bookings scheduled for this date"}
                  </p>
                </div>
              ) : (
                sorted.map((b) => <BookingRow key={b.publicId} booking={b} mode={tab} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </ManagerLayout>
  );
};
