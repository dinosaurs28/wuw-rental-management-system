import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, CalendarClock, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  rescheduleService,
  type RescheduleOptions,
  type RescheduleResult,
  type RescheduleRole,
} from "@/services/reschedule.service";
import { formatPackageReturn } from "@/components/booking/PackagePicker";
import { formatScheduleTime } from "@/utils/branchScheduleValidator";
import { istCalendarParts } from "@/utils/bookingPickers";
import {
  canStartNow,
  istWallClock,
  periodEndDays,
  periodStartDays,
  rescheduleDays,
  type PeriodDay,
  type RescheduleSlot,
} from "@/utils/rescheduleSlots";
import { BOOKING_TURNAROUND_HOURS } from "@repo/schemas";

const REASON_MAX = 500;

interface RescheduleBookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingPublicId: string;
  /** Fleet (own branch) or Branch Manager. */
  role: RescheduleRole;
  /** After a successful move — refresh the booking / list. */
  onRescheduled?: (result: RescheduleResult) => void;
}

/**
 * Reschedule a confirmed booking that hasn't been picked up (P4c): pick a new
 * pickup day and time — only slots the server would accept are offered — and
 * the return moves by the same amount. Length and price don't change. A 75vh
 * bottom sheet on small screens, a centred dialog on desktop.
 */
export function RescheduleBookingSheet({
  open,
  onOpenChange,
  bookingPublicId,
  role,
  onRescheduled,
}: RescheduleBookingSheetProps) {
  const isMobile = useIsMobile();
  const title = "Reschedule rental period";
  const description =
    "Change the rental start, the return or both. Allowed times follow branch hours and other bookings; the price follows the new period.";
  // Rendered only while open, so each opening starts fresh (and refetches the free times)
  const body = (
    <RescheduleBody
      bookingPublicId={bookingPublicId}
      role={role}
      onClose={() => onOpenChange(false)}
      onRescheduled={onRescheduled}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[75vh] gap-3 rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="p-0 pr-8">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {open && body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && body}
      </DialogContent>
    </Dialog>
  );
}

function RescheduleBody({
  bookingPublicId,
  role,
  onClose,
  onRescheduled,
}: {
  bookingPublicId: string;
  role: RescheduleRole;
  onClose: () => void;
  onRescheduled?: (result: RescheduleResult) => void;
}) {
  const query = useQuery({
    queryKey: ["reschedule-options", role, bookingPublicId],
    queryFn: () => rescheduleService.getOptions(role, bookingPublicId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const options = query.data;

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" />
        Loading free pickup times…
      </div>
    );
  }
  if (query.isError || !options) {
    return (
      <div className="space-y-4">
        <Notice tone="error">
          {apiErrorMessage(query.error, "Couldn't load this booking's pickup times. Please try again.")}
        </Notice>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button className="flex-1" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!options.reschedulable) {
    return (
      <div className="space-y-4">
        <CurrentTimes options={options} />
        <Notice tone="warning">{options.reason ?? "This booking can't be rescheduled right now."}</Notice>
        <Button variant="outline" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  if (options.periodReschedule) {
    return (
      <PeriodForm
        options={options}
        role={role}
        bookingPublicId={bookingPublicId}
        onClose={onClose}
        onRescheduled={onRescheduled}
        refetch={() => void query.refetch()}
      />
    );
  }
  return (
    <RescheduleForm
      options={options}
      role={role}
      bookingPublicId={bookingPublicId}
      onClose={onClose}
      onRescheduled={onRescheduled}
      refetch={() => void query.refetch()}
    />
  );
}

function RescheduleForm({
  options,
  role,
  bookingPublicId,
  onClose,
  onRescheduled,
  refetch,
}: {
  options: RescheduleOptions;
  role: RescheduleRole;
  bookingPublicId: string;
  onClose: () => void;
  onRescheduled?: (result: RescheduleResult) => void;
  refetch: () => void;
}) {
  const days = useMemo(() => rescheduleDays(options), [options]);
  // Start on the current pickup's day when it has a free time, else the first day that does
  const currentDayKey = istCalendarParts(new Date(options.startAt)).day.getTime();
  const [dayKey, setDayKey] = useState<number | null>(() => {
    const sameDay = days.find((d) => d.day.getTime() === currentDayKey && d.slots.length > 0);
    return (sameDay ?? days.find((d) => d.slots.length > 0))?.day.getTime() ?? null;
  });
  const [slot, setSlot] = useState<RescheduleSlot | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const day = days.find((d) => d.day.getTime() === dayKey) ?? null;
  // A refetch can take the picked slot away — drop it then
  useEffect(() => {
    if (slot && !day?.slots.some((s) => s.startAt.getTime() === slot.startAt.getTime())) setSlot(null);
  }, [day, slot]);

  const noSlotsAtAll = days.every((d) => d.slots.length === 0);
  const vehicleName = options.vehicles.map((v) => `${v.make} ${v.model} (${v.regNo})`).join(", ");

  const submit = async () => {
    if (!slot || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await rescheduleService.reschedule(role, bookingPublicId, {
        newStartAt: istWallClock(slot.startAt),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(res.message || "Booking rescheduled.");
      onRescheduled?.(res.data);
      onClose();
    } catch (err) {
      // The server re-checks everything (a hold may have appeared) — show why and refresh the times
      setError(apiErrorMessage(err, "Couldn't reschedule the booking. Please try again."));
      refetch();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <CurrentTimes options={options} vehicleName={vehicleName} />

        {noSlotsAtAll ? (
          <Notice tone="warning">
            No pickup time is free for this booking before {formatPackageReturn(new Date(options.latestStartAt))}:
            the vehicle or the customer's licence is booked, or the branch is closed at the matching return.
          </Notice>
        ) : (
          <>
            {/* Day strip (IST) */}
            <div className="space-y-1.5">
              <Label>New pickup day</Label>
              <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="New pickup day">
                {days.map((d) => {
                  const key = d.day.getTime();
                  const active = key === dayKey;
                  const empty = d.slots.length === 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={empty}
                      title={empty ? (d.closed ? "Branch closed" : "No free pickup time") : undefined}
                      onClick={() => {
                        setDayKey(key);
                        setSlot(null);
                      }}
                      className={cn(
                        "flex min-w-[64px] shrink-0 flex-col items-center rounded-xl border px-2.5 py-2 text-xs transition-colors",
                        active
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200",
                      )}
                    >
                      <span className="font-semibold">{format(d.day, "EEE")}</span>
                      <span>{format(d.day, "d MMM")}</span>
                      {key === currentDayKey && (
                        <span className={cn("text-[10px]", active ? "text-zinc-300" : "text-zinc-400")}>current</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Free pickup times that day */}
            <div className="space-y-1.5">
              <Label>New pickup time</Label>
              {day && day.slots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="New pickup time">
                  {day.slots.map((s) => {
                    const active = slot?.startAt.getTime() === s.startAt.getTime();
                    return (
                      <button
                        key={s.time}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSlot(s)}
                        className={cn(
                          "h-9 rounded-lg border text-xs font-semibold transition-colors",
                          active
                            ? "border-orange-500 bg-orange-500 text-white"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                        )}
                      >
                        {formatScheduleTime(s.time)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">Pick a day to see its free pickup times.</p>
              )}
            </div>
          </>
        )}

        {/* Preview */}
        {slot && (
          <div className="space-y-1 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-1.5 text-zinc-900">
              <span className="font-semibold">New pickup:</span> {formatPackageReturn(slot.startAt)}
              <ArrowRight className="size-3.5 text-zinc-400" />
              <span className="font-semibold">New return:</span> {formatPackageReturn(slot.returnAt)}
            </p>
            <p className="text-xs text-zinc-600">
              {options.halfDayPackage
                ? "12-hour package — the return is 12 hours after pickup, or the branch's closing time that day if 12 hours would run past it. Price unchanged."
                : `Same length (${options.durationLabel}) — price unchanged.`}
            </p>
          </div>
        )}

        <BusyList options={options} />

        <div className="space-y-1.5">
          <Label htmlFor="reschedule-reason">Reason (optional)</Label>
          <Textarea
            id="reschedule-reason"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer asked to come 2 hours later"
            className="min-h-[64px] text-sm"
          />
          <p className="text-[11px] text-zinc-400">
            For the branch records — the customer isn't shown it.
          </p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          className="flex-1 bg-orange-500 text-white hover:bg-orange-600"
          onClick={() => void submit()}
          disabled={!slot || submitting}
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : "Reschedule"}
        </Button>
      </div>
    </div>
  );
}

const rupees = (v: string | number) =>
  `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Reschedule rental period (TODO 4): a new start AND a new end, picked on
 * their own ("Now" for an immediate pickup). The server checks the period and
 * prices it (quote); the FE sees the old total, the new total and the
 * difference, then confirms.
 */
function PeriodForm({
  options,
  role,
  bookingPublicId,
  onClose,
  onRescheduled,
  refetch,
}: {
  options: RescheduleOptions;
  role: RescheduleRole;
  bookingPublicId: string;
  onClose: () => void;
  onRescheduled?: (result: RescheduleResult) => void;
  refetch: () => void;
}) {
  const [now] = useState(() => new Date());
  const startDays = useMemo(() => periodStartDays(options, now), [options, now]);
  const nowOk = useMemo(() => canStartNow(options, now), [options, now]);
  const ownStart = new Date(options.startAt);
  const ownEnd = new Date(options.endAt);
  const ownStartFree = startDays.some((d) => d.times.some((x) => x.at.getTime() === ownStart.getTime()));
  const [start, setStart] = useState<Date | null>(ownStartFree ? ownStart : null);
  const [startDayKey, setStartDayKey] = useState<number | null>(
    () => (ownStartFree ? istCalendarParts(ownStart).day.getTime() : startDays.find((d) => d.times.length > 0)?.day.getTime()) ?? null,
  );
  const [end, setEnd] = useState<Date | null>(ownStartFree ? ownEnd : null);
  const [endDayKey, setEndDayKey] = useState<number | null>(ownStartFree ? istCalendarParts(ownEnd).day.getTime() : null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endDays = useMemo(() => (start ? periodEndDays(options, start) : []), [options, start]);
  useEffect(() => {
    if (end && !endDays.some((d) => d.times.some((x) => x.at.getTime() === end.getTime()))) setEnd(null);
  }, [endDays, end]);

  const changed =
    !!start && !!end &&
    (Math.abs(start.getTime() - ownStart.getTime()) >= MINUTE || Math.abs(end.getTime() - ownEnd.getTime()) >= MINUTE);
  const quote = useQuery({
    queryKey: ["reschedule-quote", role, bookingPublicId, start?.getTime(), end?.getTime()],
    queryFn: () => rescheduleService.quote(role, bookingPublicId, { newStartAt: istWallClock(start!), newEndAt: istWallClock(end!) }),
    enabled: changed,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const pricing = quote.data?.pricing;
  const diff = pricing ? Number(pricing.difference) : 0;

  const submit = async () => {
    if (!start || !end || !pricing || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await rescheduleService.reschedule(role, bookingPublicId, {
        newStartAt: istWallClock(start),
        newEndAt: istWallClock(end),
        acceptPriceChange: true,
        expectedNewTotal: pricing.newTotal,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(res.message || "Booking rescheduled.");
      onRescheduled?.(res.data);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't reschedule the booking. Please try again."));
      refetch();
      void quote.refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const vehicleName = options.vehicles.map((v) => `${v.make} ${v.model} (${v.regNo})`).join(", ");
  const todayKey = istCalendarParts(now).day.getTime();
  const startDay = startDays.find((d) => d.day.getTime() === startDayKey) ?? null;
  const endDay = endDays.find((d) => d.day.getTime() === endDayKey) ?? null;
  const nowSlot = new Date(Math.ceil(now.getTime() / MINUTE) * MINUTE);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <CurrentTimes options={options} vehicleName={vehicleName} />

        <DayStrip
          label="Rental start (pickup)"
          days={startDays}
          activeKey={startDayKey}
          extraEnabledKey={nowOk ? todayKey : null}
          onPick={(k) => {
            setStartDayKey(k);
            setStart(null);
          }}
        />
        {startDay && (
          <TimeGrid
            label="Start time"
            times={[
              ...(nowOk && startDay.day.getTime() === todayKey ? [{ at: nowSlot, time: "NOW" }] : []),
              ...startDay.times,
            ]}
            active={start}
            onPick={(at) => setStart(at)}
          />
        )}

        {start && (
          <>
            <DayStrip
              label="Rental end (return)"
              days={endDays}
              activeKey={endDayKey}
              onPick={(k) => {
                setEndDayKey(k);
                setEnd(null);
              }}
            />
            {endDays.every((d) => d.times.length === 0) && (
              <Notice tone="warning">No return time is free after this start — another booking, a lock or branch hours are in the way.</Notice>
            )}
            {endDay && <TimeGrid label="Return time" times={endDay.times} active={end} onPick={(at) => setEnd(at)} />}
          </>
        )}

        {changed && start && end && (
          <div className="space-y-1.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-1.5 text-zinc-900">
              <span className="font-semibold">New pickup:</span> {formatPackageReturn(start)}
              <ArrowRight className="size-3.5 text-zinc-400" />
              <span className="font-semibold">New return:</span> {formatPackageReturn(end)}
            </p>
            {quote.isFetching ? (
              <p className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" /> Checking the period and its price…
              </p>
            ) : quote.isError ? (
              <p className="text-xs text-red-700">{apiErrorMessage(quote.error, "This period is not available.")}</p>
            ) : pricing ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-zinc-700">
                <span>Length</span>
                <span className="text-right">{quote.data!.previous.durationLabel} → {quote.data!.next.durationLabel}</span>
                <span>Current total</span>
                <span className="text-right">{rupees(pricing.oldTotal)}</span>
                <span className="font-semibold">New total</span>
                <span className="text-right font-semibold">{rupees(pricing.newTotal)}</span>
                <span className="font-semibold">Difference</span>
                <span className={cn("text-right font-semibold", diff > 0 ? "text-orange-700" : diff < 0 ? "text-emerald-700" : "")}>
                  {diff === 0 ? "No change" : `${diff > 0 ? "+" : "−"}${rupees(Math.abs(diff))}`}
                </span>
                {Number(pricing.dueAtPickup) > 0 && (
                  <>
                    <span>Due at pickup</span>
                    <span className="text-right">{rupees(pricing.dueAtPickup)}</span>
                  </>
                )}
                {Number(pricing.refundable) > 0 && (
                  <>
                    <span>To refund to the customer</span>
                    <span className="text-right">{rupees(pricing.refundable)}</span>
                  </>
                )}
                <p className="col-span-2 pt-1 text-[11px] text-zinc-500">
                  {diff > 0
                    ? "The difference is collected with the remaining balance at pickup."
                    : diff < 0
                      ? 'The customer has paid more than the new total: refund it with "Refund to customer" (not automatic).'
                      : "Same price; only the dates change."}
                  {pricing.couponCode && pricing.couponAppliesToNewWindow === false
                    ? ` Coupon ${pricing.couponCode} doesn't apply to the new period.`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>
        )}

        <BusyList options={options} />

        <div className="space-y-1.5">
          <Label htmlFor="reschedule-reason">Reason (optional)</Label>
          <Textarea
            id="reschedule-reason"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer arrived a day early"
            className="min-h-[64px] text-sm"
          />
        </div>

        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          className="flex-1 bg-orange-500 text-white hover:bg-orange-600"
          onClick={() => void submit()}
          disabled={!changed || !pricing || quote.isFetching || submitting}
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : !pricing ? (
            "Reschedule"
          ) : diff > 0 ? (
            `Reschedule · ${rupees(diff)} more`
          ) : diff < 0 ? (
            `Reschedule · ${rupees(-diff)} less`
          ) : (
            "Reschedule · same price"
          )}
        </Button>
      </div>
    </div>
  );
}

const MINUTE = 60_000;

function DayStrip({
  label,
  days,
  activeKey,
  extraEnabledKey = null,
  onPick,
}: {
  label: string;
  days: PeriodDay[];
  activeKey: number | null;
  extraEnabledKey?: number | null;
  onPick: (key: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label={label}>
        {days.map((d) => {
          const key = d.day.getTime();
          const active = key === activeKey;
          const empty = d.times.length === 0 && key !== extraEnabledKey;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={empty}
              title={empty ? (d.closed ? "Branch closed" : "No free time") : undefined}
              onClick={() => onPick(key)}
              className={cn(
                "flex min-w-[64px] shrink-0 flex-col items-center rounded-xl border px-2.5 py-2 text-xs transition-colors",
                active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200",
              )}
            >
              <span className="font-semibold">{format(d.day, "EEE")}</span>
              <span>{format(d.day, "d MMM")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({
  label,
  times,
  active,
  onPick,
}: {
  label: string;
  times: Array<{ at: Date; time: string }>;
  active: Date | null;
  onPick: (at: Date) => void;
}) {
  if (times.length === 0) return <p className="text-xs text-zinc-500">No free time that day.</p>;
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={label}>
        {times.map((x) => {
          const on = active?.getTime() === x.at.getTime();
          return (
            <button
              key={x.time}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(x.at)}
              className={cn(
                "h-9 rounded-lg border text-xs font-semibold transition-colors",
                on ? "border-orange-500 bg-orange-500 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
              )}
            >
              {x.time === "NOW" ? "Now" : formatScheduleTime(x.time)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CurrentTimes({ options, vehicleName }: { options: RescheduleOptions; vehicleName?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-zinc-400" />
      <div className="space-y-0.5">
        <p className="text-zinc-700">
          <span className="font-semibold text-zinc-900">Now:</span> pickup {formatPackageReturn(new Date(options.startAt))}
          {" · "}return {formatPackageReturn(new Date(options.endAt))}
        </p>
        <p className="text-xs text-zinc-500">
          {options.durationLabel}
          {options.isMonthly ? " · monthly rental" : ""}
          {vehicleName ? ` · ${vehicleName}` : ""}
        </p>
      </div>
    </div>
  );
}

/** What is in the way: other bookings / checkouts on the vehicle and the customer's licence. */
function BusyList({ options }: { options: RescheduleOptions }) {
  const vehicleLabel = (publicId: string) => {
    const v = options.vehicles.find((x) => x.publicId === publicId);
    return v ? `${v.make} ${v.model} (${v.regNo})` : "The vehicle";
  };
  const rows = [
    ...options.vehicleBusy.map((b) => ({
      key: `v-${b.vehiclePublicId}-${b.startAt}-${b.bookingPublicId ?? "hold"}`,
      text:
        b.kind === "LOCK"
          ? `${vehicleLabel(b.vehiclePublicId)} is locked for bookings: ${b.lockReason ?? "booking lock"}`
          : b.kind === "HOLD" && !b.bookingPublicId
          ? `${vehicleLabel(b.vehiclePublicId)} is being booked online`
          : `${vehicleLabel(b.vehiclePublicId)} is booked${b.bookingPublicId ? ` (#${b.bookingPublicId.slice(-6).toUpperCase()})` : ""}, plus the ${BOOKING_TURNAROUND_HOURS} h turnaround`,
      startAt: b.startAt,
      endAt: b.endAt,
    })),
    ...options.dlBusy.map((b) => ({
      key: `dl-${b.bookingPublicId}`,
      text: `The customer's licence has booking #${b.bookingPublicId.slice(-6).toUpperCase()}`,
      startAt: b.startAt,
      endAt: b.endAt,
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1 rounded-xl border border-zinc-200 px-4 py-3">
      <p className="text-xs font-semibold text-zinc-700">Not free</p>
      {rows.slice(0, 5).map((r) => (
        <p key={r.key} className="text-[11px] text-zinc-500">
          {r.text}: {formatPackageReturn(new Date(r.startAt))} – {formatPackageReturn(new Date(r.endAt))}
        </p>
      ))}
      {rows.length > 5 && <p className="text-[11px] text-zinc-400">…and {rows.length - 5} more</p>}
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
        tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800",
      )}
    >
      {tone === "error" ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}
