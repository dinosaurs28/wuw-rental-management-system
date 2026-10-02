import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Save, Loader2, Users, Info } from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import apiClient from "@/lib/axios";
import {
  DEFAULT_BRANCH_HOURS,
  formatScheduleTime,
  minutesToDisplay,
  PICKUP_CUTOFF_MINUTES,
  scheduleRowError,
  timeToMinutes,
} from "@/utils/branchScheduleValidator";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface DayScheduleRow {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

interface SchedulePayload {
  days: DayScheduleRow[];
}

/** PATCH /branch/grace takes either or both fields. */
interface GracePayload {
  graceMinutes?: number;
  is24Hours?: boolean;
}

type BookingRestrictionMode = "NONE" | "SAME_CATEGORY" | "ANY_VEHICLE";

interface RestrictionPayload {
  bookingRestrictionMode: BookingRestrictionMode;
}

interface BranchScheduleResponse {
  schedules: DayScheduleRow[];
  graceMinutes: number;
  is24Hours: boolean;
}

// The default hours (8:00 AM – 11:00 PM every day). They are in force for any
// day without saved hours — every day until a schedule is saved — so the
// editor starts from them.
const DEFAULT_SCHEDULE: DayScheduleRow[] = DAY_NAMES.map((_, i) => ({
  dayOfWeek: i,
  isOpen: true,
  openTime: DEFAULT_BRANCH_HOURS.openTime,
  closeTime: DEFAULT_BRANCH_HOURS.closeTime,
}));

const DEFAULT_HOURS_LABEL = `${formatScheduleTime(DEFAULT_BRANCH_HOURS.openTime)} – ${formatScheduleTime(
  DEFAULT_BRANCH_HOURS.closeTime,
)}`;

/** Latest pickup on an open day ("HH:mm" closing − PICKUP_CUTOFF_MINUTES), for display. */
const lastPickupLabel = (closeTime: string) => minutesToDisplay(timeToMinutes(closeTime) - PICKUP_CUTOFF_MINUTES);

async function fetchSchedule(): Promise<BranchScheduleResponse> {
  const res = await apiClient.get("/branchManager/dashboard/branch/schedule");
  return res.data;
}

async function saveSchedule(payload: SchedulePayload) {
  const res = await apiClient.patch("/branchManager/dashboard/branch/schedule", payload);
  return res.data;
}

async function saveGrace(payload: GracePayload) {
  const res = await apiClient.patch("/branchManager/dashboard/branch/grace", payload);
  return res.data;
}

async function fetchRestrictionMode(): Promise<{ bookingRestrictionMode: BookingRestrictionMode }> {
  const res = await apiClient.get("/branchManager/dashboard/branch/booking-restriction");
  return res.data;
}

async function saveRestrictionMode(payload: RestrictionPayload) {
  const res = await apiClient.patch("/branchManager/dashboard/branch/booking-restriction", payload);
  return res.data;
}

function PreviewPanel({ rows, graceMinutes }: { rows: DayScheduleRow[]; graceMinutes: number }) {
  const today = new Date().getDay();
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const isToday = row.dayOfWeek === today;
        return (
          <div
            key={row.dayOfWeek}
            className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm transition-all ${
              isToday ? "border-primary bg-primary/5" : "border-zinc-100 bg-zinc-50"
            }`}
          >
            <span className={`font-medium w-16 ${isToday ? "text-primary" : "text-zinc-700"}`}>
              {DAY_SHORT[row.dayOfWeek]}
              {isToday && <span className="ml-1.5 text-[10px] text-primary font-bold">TODAY</span>}
            </span>
            {row.isOpen ? (
              <span className="text-right text-zinc-600">
                {formatScheduleTime(row.openTime)}{" "}
                <span className="text-zinc-400 mx-1">–</span>{" "}
                {formatScheduleTime(row.closeTime)}
                {graceMinutes > 0 && (
                  <span className="ml-1.5 text-[11px] text-amber-600 font-medium">
                    +{graceMinutes}m grace
                  </span>
                )}
                {!scheduleRowError(row) && (
                  <span className="block text-[11px] text-zinc-400">
                    Last pickup {lastPickupLabel(row.closeTime)}
                  </span>
                )}
              </span>
            ) : (
              <Badge variant="outline" className="text-red-500 border-red-200 bg-red-50 text-[11px] py-0">
                Closed
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function BranchSchedulePage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["branch-schedule-manager"],
    queryFn: fetchSchedule,
    throwOnError: false,
    retry: false,
  });

  const { data: restrictionData } = useQuery({
    queryKey: ["branch-restriction-mode-manager"],
    queryFn: fetchRestrictionMode,
    throwOnError: false,
    retry: false,
  });

  const [rows, setRows] = useState<DayScheduleRow[]>(DEFAULT_SCHEDULE);
  const [graceMinutes, setGraceMinutes] = useState<number>(0);
  const [graceInput, setGraceInput] = useState<string>("0");
  const [restrictionMode, setRestrictionMode] = useState<BookingRestrictionMode>("SAME_CATEGORY");

  // Sync restriction mode from server
  useEffect(() => {
    if (restrictionData?.bookingRestrictionMode) {
      setRestrictionMode(restrictionData.bookingRestrictionMode);
    }
  }, [restrictionData]);

  // Sync from server when loaded
  useEffect(() => {
    if (!data) return;
    if (data.schedules.length > 0) {
      const merged = DEFAULT_SCHEDULE.map((def) => {
        const srv = data.schedules.find((s) => s.dayOfWeek === def.dayOfWeek);
        return srv ?? def;
      });
      setRows(merged);
    }
    setGraceMinutes(data.graceMinutes ?? 0);
    setGraceInput(String(data.graceMinutes ?? 0));
  }, [data]);

  const scheduleMutation = useMutation({
    mutationFn: saveSchedule,
    onSuccess: () => {
      toast.success("Schedule saved");
      queryClient.invalidateQueries({ queryKey: ["branch-schedule-manager"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || "Failed to save schedule"),
  });

  const graceMutation = useMutation({
    mutationFn: saveGrace,
    onSuccess: () => {
      toast.success("Grace period updated");
      queryClient.invalidateQueries({ queryKey: ["branch-schedule-manager"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || "Failed to update grace period"),
  });

  // "Open 24 hours" switch — same endpoint, is24Hours only
  const allDayMutation = useMutation({
    mutationFn: (is24Hours: boolean) => saveGrace({ is24Hours }),
    onSuccess: (_, is24Hours) => {
      toast.success(is24Hours ? "Branch set to open 24 hours" : "Daily hours are enforced again");
      queryClient.invalidateQueries({ queryKey: ["branch-schedule-manager"] });
    },
    onError: (e: Error) =>
      toast.error(
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ||
          "Failed to update 24-hour setting",
      ),
  });

  const is24Hours = !!data?.is24Hours;
  // No saved rows = the default hours (8:00 AM – 11:00 PM every day) are in force
  const hoursNotSet = !!data && data.schedules.length === 0;
  const rowErrors = Object.fromEntries(rows.map((r) => [r.dayOfWeek, scheduleRowError(r)]));
  const hasRowErrors = Object.values(rowErrors).some(Boolean);

  const restrictionMutation = useMutation({
    mutationFn: saveRestrictionMode,
    onSuccess: (_, vars) => {
      toast.success("Booking restriction updated");
      setRestrictionMode(vars.bookingRestrictionMode);
      queryClient.invalidateQueries({ queryKey: ["branch-restriction-mode-manager"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || "Failed to update booking restriction"),
  });

  const updateRow = (dayOfWeek: number, patch: Partial<DayScheduleRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)),
    );
  };

  const handleSaveSchedule = () => {
    if (hasRowErrors) {
      toast.error("Fix the highlighted days first");
      return;
    }
    scheduleMutation.mutate({ days: rows });
  };

  const handleSaveGrace = () => {
    const val = parseInt(graceInput, 10);
    if (isNaN(val) || val < 0 || val > 120) {
      toast.error("Grace period must be between 0 and 120 minutes");
      return;
    }
    setGraceMinutes(val);
    graceMutation.mutate({ graceMinutes: val });
  };

  if (isLoading) {
    return (
      <ManagerLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        </div>
      </ManagerLayout>
    );
  }

  return (
    <ManagerLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Clock className="size-6 text-primary" />
            Branch Operating Hours
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Set the opening and closing times for each day. Pickups must be between
            opening time and {PICKUP_CUTOFF_MINUTES} minutes before closing; a return
            after closing (beyond the grace period) or on a closed day is moved to the
            next time the branch is open. Extensions must end within these hours.
          </p>
        </div>

        {hoursNotSet && !is24Hours && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
            <Info className="size-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">Default hours apply: {DEFAULT_HOURS_LABEL} every day</p>
              <p className="mt-0.5 text-amber-800">
                The last pickup is {PICKUP_CUTOFF_MINUTES} minutes before closing (
                {lastPickupLabel(DEFAULT_BRANCH_HOURS.closeTime)}). Change the times below
                and save to set your branch's own hours.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Schedule editor — takes 3 columns */}
          <div className="lg:col-span-3 space-y-6">
            {/* Open 24 hours */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Open 24 hours</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Accept pickups and returns at any time, every day. Your weekly
                      schedule is kept and applies again when you switch this off.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={is24Hours}
                    aria-label="Open 24 hours"
                    disabled={allDayMutation.isPending}
                    onClick={() => allDayMutation.mutate(!is24Hours)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
                      is24Hours ? "bg-primary" : "bg-zinc-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                        is24Hours ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                {is24Hours && (
                  <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                    The branch is open 24 hours — the daily hours below are not enforced.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className={is24Hours ? "opacity-60" : undefined}>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Weekly Schedule</CardTitle>
                <CardDescription>
                  Toggle a day off to mark it as closed. Times use 24-hour format; an
                  open day must close after it opens (use 23:59 for midnight).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {rows.map((row) => (
                  <div key={row.dayOfWeek} className="space-y-1">
                  {/* Wraps the times under the day on a phone instead of overflowing the card */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* Day toggle */}
                    <div className="w-28 flex items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.isOpen}
                        onClick={() => updateRow(row.dayOfWeek, { isOpen: !row.isOpen })}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                          row.isOpen ? "bg-primary" : "bg-zinc-200"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                            row.isOpen ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <label
                        onClick={() => updateRow(row.dayOfWeek, { isOpen: !row.isOpen })}
                        className={`text-sm font-medium cursor-pointer select-none ${
                          row.isOpen ? "text-zinc-800" : "text-zinc-400"
                        }`}
                      >
                        {DAY_NAMES[row.dayOfWeek]}
                      </label>
                    </div>

                    {/* Time inputs */}
                    {row.isOpen ? (
                      <div className="flex items-center gap-3 flex-1">
                        <Input
                          type="time"
                          value={row.openTime}
                          onChange={(e) =>
                            updateRow(row.dayOfWeek, { openTime: e.target.value })
                          }
                          className="h-9 w-32 text-sm"
                        />
                        <span className="text-zinc-400 text-sm">to</span>
                        <Input
                          type="time"
                          value={row.closeTime}
                          onChange={(e) =>
                            updateRow(row.dayOfWeek, { closeTime: e.target.value })
                          }
                          aria-invalid={!!rowErrors[row.dayOfWeek]}
                          className="h-9 w-32 text-sm"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-400 italic">Closed all day</span>
                    )}
                  </div>
                  {rowErrors[row.dayOfWeek] && (
                    <p className="ml-32 text-xs text-red-600">{rowErrors[row.dayOfWeek]}</p>
                  )}
                  </div>
                ))}

                <div className="pt-4 border-t border-zinc-100">
                  <Button
                    onClick={handleSaveSchedule}
                    disabled={scheduleMutation.isPending || hasRowErrors}
                    className="w-full sm:w-auto"
                  >
                    {scheduleMutation.isPending ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="size-4 mr-2" />
                    )}
                    Save Schedule
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Grace period */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Grace Period</CardTitle>
                <CardDescription>
                  Allow returns up to this many minutes after closing time before the
                  return is moved to the next open day. Set to 0 to disable.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="grace-input" className="text-sm font-medium text-zinc-700">
                      Minutes after closing
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="grace-input"
                        type="number"
                        min={0}
                        max={120}
                        value={graceInput}
                        onChange={(e) => setGraceInput(e.target.value)}
                        className="h-9 w-28 text-sm"
                      />
                      <span className="text-sm text-zinc-500">min (max 120)</span>
                    </div>
                  </div>
                  <Button
                    onClick={handleSaveGrace}
                    disabled={graceMutation.isPending}
                    variant="outline"
                  >
                    {graceMutation.isPending ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="size-4 mr-2" />
                    )}
                    Update
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Booking restriction */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="size-4 text-primary" />
                  Booking Restriction
                </CardTitle>
                <CardDescription>
                  Control how many active bookings a customer can have at this branch at the same time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(["NONE", "SAME_CATEGORY", "ANY_VEHICLE"] as BookingRestrictionMode[]).map((mode) => {
                  const labels: Record<BookingRestrictionMode, { title: string; desc: string }> = {
                    NONE: {
                      title: "No restriction",
                      desc: "Customers can have multiple active bookings simultaneously.",
                    },
                    SAME_CATEGORY: {
                      title: "Same category only",
                      desc: "One booking per vehicle category (two-wheeler / four-wheeler) at a time.",
                    },
                    ANY_VEHICLE: {
                      title: "Any vehicle (strict)",
                      desc: "If a customer has any active booking at this branch, they cannot make another.",
                    },
                  };
                  const selected = restrictionMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRestrictionMode(mode)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                        selected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-zinc-200 bg-zinc-50 hover:border-zinc-300"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selected ? "border-primary" : "border-zinc-300"
                          }`}
                        >
                          {selected && <span className="size-2 rounded-full bg-primary" />}
                        </span>
                        <span className={`text-sm font-semibold ${selected ? "text-primary" : "text-zinc-700"}`}>
                          {labels[mode].title}
                        </span>
                      </div>
                      <p className="mt-1 ml-6 text-xs text-zinc-500 leading-relaxed">
                        {labels[mode].desc}
                      </p>
                    </button>
                  );
                })}
                <div className="pt-3 border-t border-zinc-100">
                  <Button
                    onClick={() => restrictionMutation.mutate({ bookingRestrictionMode: restrictionMode })}
                    disabled={restrictionMutation.isPending || restrictionMode === restrictionData?.bookingRestrictionMode}
                    variant="outline"
                  >
                    {restrictionMutation.isPending ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="size-4 mr-2" />
                    )}
                    Save Restriction
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Live preview — takes 2 cols */}
          <div className="lg:col-span-2">
            <Card className="sticky top-24">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Live Preview</CardTitle>
                <CardDescription>How customers will see your hours</CardDescription>
              </CardHeader>
              <CardContent>
                {is24Hours ? (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                    Open 24 hours, every day
                  </p>
                ) : (
                  <>
                    {hoursNotSet && (
                      <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Default hours apply ({DEFAULT_HOURS_LABEL} every day) until you save
                        your own schedule.
                      </p>
                    )}
                    <PreviewPanel rows={rows} graceMinutes={graceMinutes} />
                  </>
                )}
                <p className="mt-4 text-[11px] text-zinc-400 leading-relaxed">
                  The last pickup is {PICKUP_CUTOFF_MINUTES} minutes before closing. A
                  return after closing (beyond grace), before opening or on a closed day
                  is moved to the next open day at the pickup time. Pickup on closed days
                  is blocked.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ManagerLayout>
  );
}
