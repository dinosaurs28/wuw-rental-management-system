import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Edit2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminBranchHours, type BranchScheduleRow } from "@/services/branch.service";
import {
  DEFAULT_BRANCH_HOURS,
  formatScheduleTime,
  PICKUP_CUTOFF_MINUTES,
  scheduleRowError,
  usesDefaultHours,
} from "@/utils/branchScheduleValidator";
import { BranchWeeklyHours } from "@/components/branch/BranchWeeklyHours";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
// Editor shows Monday first
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// A day with no saved row keeps the default hours, so the editor starts from them
const defaultRow = (dayOfWeek: number): BranchScheduleRow => ({
  dayOfWeek,
  isOpen: true,
  openTime: DEFAULT_BRANCH_HOURS.openTime,
  closeTime: DEFAULT_BRANCH_HOURS.closeTime,
});
const STARTER_ROWS: BranchScheduleRow[] = WEEK_ORDER.map(defaultRow);

const DEFAULT_HOURS_LABEL = `${formatScheduleTime(DEFAULT_BRANCH_HOURS.openTime)} – ${formatScheduleTime(
  DEFAULT_BRANCH_HOURS.closeTime,
)}`;

function apiMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e?.response?.data?.message || fallback;
}

/**
 * Admin view + edit of a branch's office hours (#2): weekly schedule, return
 * grace and the "Open 24 hours" switch. Empty schedule = the default hours
 * (8:00 AM – 11:00 PM every day) apply; the last pickup is 30 minutes before
 * closing.
 */
export function AdminBranchHoursCard({ branchPublicId }: { branchPublicId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["admin-branch-schedule", branchPublicId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => adminBranchHours.get(branchPublicId),
    retry: false,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [rows, setRows] = useState<BranchScheduleRow[]>(STARTER_ROWS);
  const [graceInput, setGraceInput] = useState("0");
  const [is24Hours, setIs24Hours] = useState(false);

  // Load the saved values into the editor
  const startEditing = () => {
    if (!data) return;
    setRows(
      data.schedules.length > 0
        ? WEEK_ORDER.map((dow) => data.schedules.find((s) => s.dayOfWeek === dow) ?? defaultRow(dow))
        : STARTER_ROWS,
    );
    setGraceInput(String(data.graceMinutes ?? 0));
    setIs24Hours(!!data.is24Hours);
    setIsEditing(true);
  };

  const rowErrors = rows.map((r) => scheduleRowError(r));
  const graceValue = Number(graceInput);
  const graceInvalid = !Number.isInteger(graceValue) || graceValue < 0 || graceValue > 120;

  const saveMutation = useMutation({
    mutationFn: async () => {
      await adminBranchHours.saveSchedule(branchPublicId, rows);
      await adminBranchHours.saveSettings(branchPublicId, { graceMinutes: graceValue, is24Hours });
    },
    onSuccess: () => {
      toast.success("Operating hours updated");
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey });
      // Pickers and banners read the public schedule
      queryClient.invalidateQueries({ queryKey: ["branch-schedule", branchPublicId] });
    },
    onError: (err) => toast.error(apiMessage(err, "Failed to update operating hours")),
  });

  const updateRow = (dayOfWeek: number, patch: Partial<BranchScheduleRow>) =>
    setRows((prev) => prev.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)));

  return (
    <Card className="border border-neutral-200 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-orange-50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-[#FF5F00]" />
            </div>
            <CardTitle className="text-base font-semibold text-neutral-900">Operating Hours</CardTitle>
          </div>
          {!isEditing && data && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-neutral-500 hover:text-[#FF5F00] hover:bg-orange-50"
              onClick={startEditing}
            >
              <Edit2 className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-red-600">Couldn't load this branch's hours.</p>
        ) : !isEditing ? (
          <>
            {usesDefaultHours(data) && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Default hours apply: {DEFAULT_HOURS_LABEL} every day.
              </p>
            )}
            <BranchWeeklyHours schedule={data} showGrace showPickupCutoff />
          </>
        ) : (
          <>
            {/* Open 24 hours */}
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <span>
                <span className="block text-sm font-medium text-neutral-900">Open 24 hours</span>
                <span className="block text-xs text-neutral-500">
                  Daily hours below are kept but not enforced while this is on.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={is24Hours}
                onClick={() => setIs24Hours((v) => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
                  is24Hours ? "bg-[#FF5F00]" : "bg-neutral-200",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    is24Hours ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </button>
            </label>

            {data.schedules.length === 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Default hours apply: {DEFAULT_HOURS_LABEL} every day. Save to set this branch's own hours.
              </p>
            )}
            <p className="text-xs text-neutral-500">
              The last pickup is {PICKUP_CUTOFF_MINUTES} minutes before closing; returns are accepted
              until closing plus the grace below.
            </p>

            <div className={cn("space-y-2.5", is24Hours && "opacity-60")}>
              {rows.map((row, i) => (
                <div key={row.dayOfWeek} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label className="w-24 flex items-center gap-2 text-xs font-medium text-neutral-700 shrink-0">
                      <input
                        type="checkbox"
                        checked={row.isOpen}
                        onChange={(e) => updateRow(row.dayOfWeek, { isOpen: e.target.checked })}
                        className="accent-[#FF5F00]"
                      />
                      {DAY_NAMES[row.dayOfWeek].slice(0, 3)}
                    </label>
                    {row.isOpen ? (
                      <>
                        <Input
                          type="time"
                          value={row.openTime}
                          onChange={(e) => updateRow(row.dayOfWeek, { openTime: e.target.value })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-neutral-400">to</span>
                        <Input
                          type="time"
                          value={row.closeTime}
                          onChange={(e) => updateRow(row.dayOfWeek, { closeTime: e.target.value })}
                          aria-invalid={!!rowErrors[i]}
                          className="h-8 text-xs"
                        />
                      </>
                    ) : (
                      <span className="text-xs italic text-neutral-400">Closed</span>
                    )}
                  </div>
                  {rowErrors[i] && <p className="pl-24 text-[11px] text-red-600">{rowErrors[i]}</p>}
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                Return grace (minutes after closing)
              </Label>
              <Input
                type="number"
                min={0}
                max={120}
                value={graceInput}
                onChange={(e) => setGraceInput(e.target.value)}
                aria-invalid={graceInvalid}
                className="h-9 w-28"
              />
              {graceInvalid && <p className="text-[11px] text-red-600">Enter 0 to 120 minutes</p>}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-9"
                onClick={() => setIsEditing(false)}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 h-9 bg-[#FF5F00] hover:bg-[#E65600] text-white"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || rowErrors.some(Boolean) || graceInvalid}
              >
                {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
