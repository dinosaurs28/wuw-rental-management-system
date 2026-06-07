import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Save, Loader2 } from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import apiClient from "@/lib/axios";
import { formatScheduleTime } from "@/utils/branchScheduleValidator";

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

interface GracePayload {
  graceMinutes: number;
}

interface BranchScheduleResponse {
  schedules: DayScheduleRow[];
  graceMinutes: number;
  is24Hours: boolean;
}

const DEFAULT_SCHEDULE: DayScheduleRow[] = DAY_NAMES.map((_, i) => ({
  dayOfWeek: i,
  isOpen: i !== 0, // Sun closed by default
  openTime: "09:00",
  closeTime: "22:00",
}));

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
              <span className="text-zinc-600">
                {formatScheduleTime(row.openTime)}{" "}
                <span className="text-zinc-400 mx-1">–</span>{" "}
                {formatScheduleTime(row.closeTime)}
                {graceMinutes > 0 && (
                  <span className="ml-1.5 text-[11px] text-amber-600 font-medium">
                    +{graceMinutes}m grace
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

  const [rows, setRows] = useState<DayScheduleRow[]>(DEFAULT_SCHEDULE);
  const [graceMinutes, setGraceMinutes] = useState<number>(0);
  const [graceInput, setGraceInput] = useState<string>("0");

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

  const updateRow = (dayOfWeek: number, patch: Partial<DayScheduleRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)),
    );
  };

  const handleSaveSchedule = () => {
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
            Set the opening and closing times for each day. Bookings outside these
            hours will be flagged or automatically extended to 24 hours.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Schedule editor — takes 3 columns */}
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Weekly Schedule</CardTitle>
                <CardDescription>
                  Toggle a day off to mark it as closed. Times use 24-hour format.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {rows.map((row) => (
                  <div key={row.dayOfWeek} className="flex items-center gap-4">
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
                          className="h-9 w-32 text-sm"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-400 italic">Closed all day</span>
                    )}
                  </div>
                ))}

                <div className="pt-4 border-t border-zinc-100">
                  <Button
                    onClick={handleSaveSchedule}
                    disabled={scheduleMutation.isPending}
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
                  Allow returns up to this many minutes after closing time before
                  the booking is bumped to 24 hours. Set to 0 to disable.
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
          </div>

          {/* Live preview — takes 2 columns */}
          <div className="lg:col-span-2">
            <Card className="sticky top-24">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Live Preview</CardTitle>
                <CardDescription>How customers will see your hours</CardDescription>
              </CardHeader>
              <CardContent>
                <PreviewPanel rows={rows} graceMinutes={graceMinutes} />
                <p className="mt-4 text-[11px] text-zinc-400 leading-relaxed">
                  Bookings with a return time after closing (beyond grace) will be
                  automatically extended to 24 hours. Pickup on closed days is blocked.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ManagerLayout>
  );
}
