import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Car, Clock, User, AlertTriangle, Calendar, Filter, Phone, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { BookingQrPhotoButton } from "@/components/booking/BookingQrPhotoButton";
import { DlStatusPanel } from "@/components/booking/DlStatus";
import { SwapVehicleLink } from "@/components/manager/vehicle-swap/SwapVehicleLink";
import { canSwapVehicle, managerSwapPath } from "@/components/manager/vehicle-swap/swapFormat";
import { managerDashboardService, type FleetBooking } from "@/services/managerDashboard.service";
import type { BookingListType, OverdueReturn } from "@/types/overdueReturns";
import { useMinuteTick } from "@/hooks/useMinuteTick";
import {
  RETURN_STATE_META,
  formatIstDateTime,
  formatOverdueDuration,
  liveOverdueMinutes,
  liveReturnState,
  telHref,
} from "@/utils/overdueReturns";

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

function getReturnStatus(endAt: string): { label: string; color: string; bg: string } {
  const now = Date.now();
  const end = new Date(endAt).getTime();
  const diffMs = end - now;
  const diffH = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) {
    const label = `${formatOverdueDuration(Math.floor(-diffMs / 60_000))} overdue`;
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
        <p className="text-sm font-medium text-[#1a1917] truncate">
          {vehicleName}
          {booking.bookingType === "MONTHLY" && <MonthlyPill days={booking.days} />}
        </p>
        <p className="text-xs text-[#9ca3af] truncate">{regNo}</p>
      </div>

      <div className="hidden sm:flex items-center gap-1.5 w-36 flex-shrink-0">
        <User className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
        <span className="text-xs text-[#6b6860] truncate">{customerName}</span>
      </div>

      <div className="hidden md:flex items-center gap-1.5 w-52 flex-shrink-0">
        <Calendar className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
        <span className="text-xs text-[#6b6860]">
          {mode === "picked_up"
            ? `Due ${formatIstDateTime(booking.endAt)}`
            : `Pickup ${formatDateTime(booking.startAt)}`}
        </span>
      </div>

      {/* Original licence custody (#3): the BM can verify / correct it at any status */}
      <DlStatusPanel
        variant="compact"
        role="manager"
        publicId={booking.publicId}
        bookingStatus={booking.status}
        dlStatus={booking.dlStatus}
        dlDepositNote={booking.dlDepositNote}
        bookingLabel={`${vehicleName} · ${customerName}`}
        refreshQueryKeys={[["manager-fleet-status"], ["manager-overdue-returns"]]}
        className="flex-shrink-0"
      />

      <span
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
        style={{ color: status.color, backgroundColor: status.bg }}
      >
        {status.label}
      </span>

      {/* Customer QR code photo (#4): view; capture/replace while CONFIRMED */}
      <BookingQrPhotoButton bookingId={booking.publicId} role="manager" customerName={customerName} />

      {/* Swap the car mid-rental (#13) — overdue rentals must be extended first */}
      {mode === "picked_up" && canSwapVehicle(booking) && (
        <SwapVehicleLink
          to={managerSwapPath(booking.publicId)}
          className="h-7 px-2 text-xs flex-shrink-0 border-[#e8e6e1] text-[#6b6860] hover:text-[#1a1917]"
        />
      )}
    </div>
  );
}

function MonthlyPill({ days }: { days?: number }) {
  return (
    <span className="ml-2 align-middle text-[10px] font-semibold px-1.5 py-px rounded-full bg-indigo-50 text-indigo-700 whitespace-nowrap">
      Monthly{days ? ` · ${days}d` : ""}
    </span>
  );
}

// The branch manager has no drop flow — Fleet processes the return. A return
// Fleet sent for confirmation links to the BM's Confirmations page.
function OverdueRow({ row, fetchedAt, now }: { row: OverdueReturn; fetchedAt: number; now: number }) {
  const minutes = liveOverdueMinutes(row, fetchedAt, now);
  const state = liveReturnState(row, minutes);
  const meta = RETURN_STATE_META[state];
  const thumbUrl = row.vehicles.find((v) => v.imageUrl)?.imageUrl;
  const vehicleNames = row.vehicles.map((v) => `${v.make} ${v.model}`).join(", ") || "—";
  const regNos = row.vehicles.map((v) => v.regNo).join(" · ");
  const { name, phone, alternatePhone } = row.customer;

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 px-5 py-3.5 border-b border-[#f0ede8] last:border-0 hover:bg-[#faf9f7] transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-[#f0ede8] overflow-hidden flex-shrink-0 flex items-center justify-center">
          {thumbUrl ? (
            <img src={thumbUrl} alt={vehicleNames} className="w-full h-full object-cover" />
          ) : (
            <Car className="w-4 h-4" style={{ color: "#9ca3af" }} />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#1a1917] truncate">
            {vehicleNames}
            {row.bookingType === "MONTHLY" && <MonthlyPill days={row.days} />}
          </p>
          <p className="text-xs text-[#9ca3af] truncate">
            {regNos ? `${regNos} · ` : ""}
            <span className="font-mono">#{row.publicId.slice(-6).toUpperCase()}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 md:w-44 flex-shrink-0 min-w-0">
        <span className="flex items-center gap-1.5 text-xs text-[#6b6860] truncate">
          <User className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
          {name || "Unknown customer"}
        </span>
        {phone && (
          <a href={telHref(phone)} className="flex items-center gap-1.5 text-xs text-blue-700 hover:underline w-fit">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {phone}
          </a>
        )}
        {alternatePhone && (
          <a href={telHref(alternatePhone)} className="flex items-center gap-1.5 text-xs text-blue-700 hover:underline w-fit">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {alternatePhone}
            <span className="text-[#9ca3af]">(alt)</span>
          </a>
        )}
      </div>

      <div className="flex flex-col gap-0.5 md:w-52 flex-shrink-0">
        <span className="flex items-center gap-1.5 text-xs text-[#6b6860]">
          <Calendar className="w-3 h-3 text-[#c4c0bb] flex-shrink-0" />
          Due {row.endAtDisplay || formatIstDateTime(row.endAt)}
        </span>
        {row.extensionPending && (
          <span className="text-[10px] font-medium text-blue-700">Extension pending</span>
        )}
      </div>

      {/* Original licence custody (#3); absent from servers that predate it */}
      {row.dlStatus !== undefined && (
        <DlStatusPanel
          variant="compact"
          role="manager"
          publicId={row.publicId}
          bookingStatus="PICKED_UP"
          dlStatus={row.dlStatus}
          dlDepositNote={row.dlDepositNote}
          bookingLabel={`${vehicleNames} · ${name || "Unknown customer"}`}
          refreshQueryKeys={[["manager-overdue-returns"], ["manager-fleet-status"]]}
          className="flex-shrink-0"
        />
      )}

      <div className="flex items-center gap-2 flex-shrink-0 md:w-48 md:justify-end">
        <span className="text-xs font-semibold whitespace-nowrap" style={{ color: meta.color }}>
          {formatOverdueDuration(minutes)} late
        </span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ color: meta.color, backgroundColor: meta.bg }}
        >
          {meta.label}
        </span>
        {/* Fleet sent the return for the BM's confirmation — the one action the BM owns here */}
        {state === "AWAITING_MANAGER_CONFIRMATION" && (
          <Link
            to={`/manager/confirmations?booking=${encodeURIComponent(row.publicId)}`}
            className="text-xs font-semibold text-orange-600 hover:underline whitespace-nowrap"
          >
            Confirm return
          </Link>
        )}
      </div>
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

type Tab = "picked_up" | "upcoming" | "overdue";

const tabFromParam = (value: string | null): Tab =>
  value === "upcoming" ? "upcoming" : value === "overdue" ? "overdue" : "picked_up";

/** Rows fetched per list — the page shows everything out / due, not a page of it. */
const FLEET_LIMIT = 200;

export const FleetStatusPage = () => {
  const today = toLocalDateValue(new Date());
  // `?tab=overdue` / `?type=monthly` deep-link straight to a list.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromParam(searchParams.get("tab"));
  const bookingType: BookingListType =
    searchParams.get("type")?.toUpperCase() === "MONTHLY" ? "MONTHLY" : "DAILY";
  const [selectedDate, setSelectedDate] = useState(today);

  const updateParams = (patch: Record<string, string>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };
  const setTab = (next: Tab) => updateParams({ tab: next });
  const setBookingType = (next: BookingListType) => updateParams({ type: next.toLowerCase() });

  // Both Daily / Monthly tabs of both lists, so switching tabs is instant and
  // every badge is exact. No backend date filter: all PICKED_UP vehicles
  // (including ones picked up on earlier days) are always included.
  const fleetQuery = useQuery({
    queryKey: ["manager-fleet-status"],
    queryFn: async () => {
      const [pickedUpDaily, pickedUpMonthly, upcomingDaily, upcomingMonthly] = await Promise.all([
        managerDashboardService.getFleetTab("picked_up", "DAILY", FLEET_LIMIT),
        managerDashboardService.getFleetTab("picked_up", "MONTHLY", FLEET_LIMIT),
        managerDashboardService.getFleetTab("upcoming", "DAILY", FLEET_LIMIT),
        managerDashboardService.getFleetTab("upcoming", "MONTHLY", FLEET_LIMIT),
      ]);
      return {
        pickedUp: { DAILY: pickedUpDaily, MONTHLY: pickedUpMonthly },
        upcoming: { DAILY: upcomingDaily, MONTHLY: upcomingMonthly },
      };
    },
    refetchInterval: 60_000,
    refetchOnMount: "always",
  });

  // Overdue / no-show returns, most overdue first. Polled every minute.
  const overdueQuery = useQuery({
    queryKey: ["manager-overdue-returns"],
    queryFn: () => managerDashboardService.getOverdueReturns({ limit: FLEET_LIMIT }),
    refetchInterval: 60_000,
    refetchOnMount: "always",
  });
  // Ticks every minute: live overdue durations and the "pickup time passed" filter.
  const now = useMinuteTick();

  const fleet = fleetQuery.data;
  const loading = tab === "overdue" ? overdueQuery.isLoading : fleetQuery.isLoading;
  const loadFailed =
    tab === "overdue"
      ? overdueQuery.isError && !overdueQuery.data
      : fleetQuery.isError && !fleet;

  // Date filter applies client-side to daily upcoming pickups only — picked_up always
  // shows all active vehicles and the Monthly tab lists every monthly booking.
  const filteredUpcomingDaily = (fleet?.upcoming.DAILY.bookings ?? []).filter((b) => {
    const bookingDate = toLocalDateValue(new Date(b.startAt));
    return bookingDate === selectedDate || new Date(b.startAt).getTime() < now;
  });
  const upcomingRows =
    bookingType === "MONTHLY" ? fleet?.upcoming.MONTHLY.bookings ?? [] : filteredUpcomingDaily;
  const pickedUpRows = fleet?.pickedUp[bookingType].bookings ?? [];

  const typeCounts: Record<BookingListType, number> | null = !fleet
    ? null
    : tab === "upcoming"
      ? { DAILY: filteredUpcomingDaily.length, MONTHLY: fleet.upcoming.MONTHLY.total }
      : { DAILY: fleet.pickedUp.DAILY.total, MONTHLY: fleet.pickedUp.MONTHLY.total };

  const rows: FleetBooking[] = tab === "picked_up" ? pickedUpRows : tab === "upcoming" ? upcomingRows : [];
  const sorted = [...rows].sort((a, b) => {
    const dateA = tab === "picked_up" ? a.endAt : a.startAt;
    const dateB = tab === "picked_up" ? b.endAt : b.startAt;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });
  const overdueRows = overdueQuery.data?.data ?? [];

  // Vehicles not back yet (overdue + in grace) — excludes returns already in progress.
  const overdueCount = overdueQuery.data?.overdueCount ?? 0;

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

            {/* Date filter — only the Daily upcoming pickups list is per-date */}
            {tab === "upcoming" && bookingType === "DAILY" && (
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
            )}
          </div>

          {/* Panel */}
          <div className="rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-[#1a1917]">
                  {tab === "overdue"
                    ? "Recovery — customers not back after the rental period"
                    : tab === "picked_up"
                    ? bookingType === "MONTHLY"
                      ? "Monthly rentals currently out"
                      : "Daily rentals currently out"
                    : bookingType === "MONTHLY"
                    ? "All monthly pickups"
                    : selectedDate === today
                    ? "Today's pickups"
                    : new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                </h2>
              </div>

              {overdueCount > 0 && tab !== "overdue" && (
                <button
                  type="button"
                  onClick={() => setTab("overdue")}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-full transition-colors"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {overdueCount} overdue
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="flex px-5 pt-3 border-b border-[#e8e6e1] overflow-x-auto">
              {(
                [
                  {
                    key: "picked_up",
                    label: "Out on Road",
                    count: fleet ? fleet.pickedUp.DAILY.total + fleet.pickedUp.MONTHLY.total : null,
                  },
                  {
                    key: "upcoming",
                    label: "Upcoming Pickups",
                    count: fleet ? filteredUpcomingDaily.length + fleet.upcoming.MONTHLY.total : null,
                  },
                  {
                    key: "overdue",
                    label: "Recovery",
                    count: overdueQuery.data ? overdueCount : null,
                  },
                ] as { key: Tab; label: string; count: number | null }[]
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className="relative pb-2.5 mr-5 text-xs font-medium transition-colors whitespace-nowrap"
                  style={{ color: tab === key ? "#1a1917" : "#9ca3af" }}
                >
                  {label}
                  <span
                    className="ml-1.5 inline-flex items-center justify-center text-[10px] font-bold rounded-full px-1.5 py-px"
                    style={{
                      backgroundColor:
                        key === "overdue" && count
                          ? "#dc2626"
                          : tab === key
                          ? "#1a1917"
                          : "#f0ede8",
                      color: tab === key || (key === "overdue" && count) ? "#fff" : "#9ca3af",
                      minWidth: "18px",
                    }}
                  >
                    {count === null ? "—" : count}
                  </span>
                  {tab === key && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1a1917] rounded-t" />
                  )}
                </button>
              ))}
            </div>

            {/* Daily / Monthly split */}
            {tab !== "overdue" && (
              <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#f0ede8]">
                {(["DAILY", "MONTHLY"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setBookingType(type)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border transition-colors"
                    style={{
                      borderColor: bookingType === type ? "#1a1917" : "#e8e6e1",
                      backgroundColor: bookingType === type ? "#1a1917" : "#fff",
                      color: bookingType === type ? "#fff" : "#6b6860",
                    }}
                  >
                    {type === "DAILY" ? "Daily" : "Monthly"}
                    <span className="text-[10px] font-bold opacity-80">
                      {typeCounts ? typeCounts[type] : "—"}
                    </span>
                  </button>
                ))}
                {bookingType === "MONTHLY" && (
                  <span className="text-[11px] text-[#9ca3af] ml-1">Not limited to a date</span>
                )}
              </div>
            )}

            {/* Rows */}
            <div>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              ) : loadFailed ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <AlertTriangle className="w-9 h-9 mb-3" style={{ color: "#e8e6e1" }} />
                  <p className="text-sm font-medium text-[#6b6860]">Couldn't load this list</p>
                  <p className="text-xs text-[#9ca3af] mt-1">It retries automatically every minute.</p>
                </div>
              ) : tab === "overdue" ? (
                overdueRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                    <CheckCircle2 className="w-9 h-9 mb-3" style={{ color: "#bbf7d0" }} />
                    <p className="text-sm font-medium text-[#6b6860]">Nothing to recover</p>
                    <p className="text-xs text-[#9ca3af] mt-1">
                      Every vehicle out on the road is within its booked time
                    </p>
                  </div>
                ) : (
                  <>
                    {overdueRows.map((row) => (
                      <OverdueRow
                        key={row.publicId}
                        row={row}
                        fetchedAt={overdueQuery.data!.fetchedAt}
                        now={now}
                      />
                    ))}
                    {overdueQuery.data!.pagination.total > overdueRows.length && (
                      <p className="px-5 py-3 text-xs text-[#9ca3af]">
                        Showing the {overdueRows.length} most overdue of{" "}
                        {overdueQuery.data!.pagination.total}.
                      </p>
                    )}
                  </>
                )
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <Clock className="w-9 h-9 mb-3" style={{ color: "#e8e6e1" }} />
                  <p className="text-sm font-medium text-[#6b6860]">
                    {tab === "picked_up"
                      ? bookingType === "MONTHLY"
                        ? "No monthly rentals out on road"
                        : "No daily rentals out on road"
                      : bookingType === "MONTHLY"
                      ? "No monthly pickups waiting"
                      : "No upcoming pickups"}
                  </p>
                  <p className="text-xs text-[#9ca3af] mt-1">
                    {tab === "picked_up"
                      ? bookingType === "MONTHLY"
                        ? "No monthly rental is out right now"
                        : "No daily rental is out right now"
                      : bookingType === "MONTHLY"
                      ? "No confirmed monthly bookings are waiting for pickup"
                      : "No confirmed bookings scheduled for this date"}
                  </p>
                </div>
              ) : (
                sorted.map((b) => (
                  <BookingRow key={b.publicId} booking={b} mode={tab === "picked_up" ? "picked_up" : "upcoming"} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </ManagerLayout>
  );
};
