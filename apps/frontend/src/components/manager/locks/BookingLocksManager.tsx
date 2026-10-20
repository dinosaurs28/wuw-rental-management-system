import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Info, Loader2, Lock, Plus, XCircle } from "lucide-react";
import {
  BOOKING_LOCK_REASON_MAX,
  bookingLockWindowIssues,
  istToday,
  type BookingLockListFilter,
  type BookingLockScopeValue,
  type BookingLockStatus,
} from "@repo/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { TimeSelect } from "@/components/ui/TimeSelect";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { formatIstDateTime } from "@/utils/overdueReturns";
import {
  bookingLockApi,
  type BookingLock,
  type BookingLockDraft,
  type BookingLockOptions,
  type BookingLockPortal,
} from "@/services/bookingLock.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FILTERS: { value: BookingLockListFilter; label: string }[] = [
  { value: "current", label: "Active & upcoming" },
  { value: "past", label: "Past & cancelled" },
  { value: "all", label: "All" },
];

const STATUS_STYLE: Record<BookingLockStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "bg-red-50 text-red-700 border-red-200" },
  UPCOMING: { label: "Upcoming", className: "bg-sky-50 text-sky-700 border-sky-200" },
  ENDED: { label: "Ended", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  CANCELLED: { label: "Cancelled", className: "bg-zinc-100 text-zinc-500 border-zinc-200 line-through" },
};

const SCOPES: { value: BookingLockScopeValue; label: string }[] = [
  { value: "BRANCH", label: "Whole branch" },
  { value: "VEHICLES", label: "Selected vehicles" },
  { value: "GROUPS", label: "Selected vehicle groups" },
];

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const bookingRef = (publicId: string) => `#${publicId.slice(-6).toUpperCase()}`;

const errorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;

/** IST date (YYYY-MM-DD) + time (HH:MM) → ISO instant. */
const istToIso = (date: string, time: string): string => {
  const d = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

/** The lock's "Applies to" cell. */
function appliesTo(lock: BookingLock): { text: string; title?: string } {
  if (lock.scope === "VEHICLES") {
    return {
      text: plural(lock.vehicles.length, "vehicle"),
      title: lock.vehicles.map((v) => `${v.regNo} · ${v.make} ${v.model}`).join("\n"),
    };
  }
  if (lock.scope === "GROUPS") {
    return {
      text: plural(lock.groups.length, "vehicle group"),
      title: lock.groups.map((g) => `${g.make} ${g.model}${g.categoryName ? ` (${g.categoryName})` : ""}`).join("\n"),
    };
  }
  return { text: "Whole branch" };
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface FormState {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
  scope: BookingLockScopeValue;
  vehicleIds: number[];
  groupKeys: string[];
  customersOnly: boolean;
}

const emptyForm = (): FormState => ({
  startDate: istToday(),
  startTime: "10:00",
  endDate: istToday(),
  endTime: "18:00",
  reason: "",
  scope: "BRANCH",
  vehicleIds: [],
  groupKeys: [],
  customersOnly: false,
});

const halfHourOnly = (_hour: number, minute: number) => minute % 30 !== 0;

function LockDialog({
  portal,
  portalKey,
  open,
  onClose,
}: {
  portal: BookingLockPortal;
  portalKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [acknowledged, setAcknowledged] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState("");

  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setAcknowledged(false);
      setVehicleSearch("");
    }
  }, [open]);

  const { data: options, isLoading: optionsLoading } = useQuery<BookingLockOptions>({
    queryKey: ["booking-lock-options", portalKey],
    queryFn: () => bookingLockApi.options(portal),
    enabled: open,
    staleTime: 60_000,
  });

  const draft: BookingLockDraft = useMemo(
    () => ({
      startAt: istToIso(form.startDate, form.startTime),
      endAt: istToIso(form.endDate, form.endTime),
      reason: form.reason.trim(),
      scope: form.scope,
      vehicleIds: form.scope === "VEHICLES" ? form.vehicleIds : [],
      groupKeys: form.scope === "GROUPS" ? form.groupKeys : [],
      customersOnly: form.customersOnly,
    }),
    [form],
  );

  const windowIssues = draft.startAt && draft.endAt ? bookingLockWindowIssues(draft) : [{ path: "startAt", message: "Pick the window" }];
  const scopeIssue =
    draft.scope === "VEHICLES" && draft.vehicleIds.length === 0
      ? "Pick at least one vehicle"
      : draft.scope === "GROUPS" && draft.groupKeys.length === 0
        ? "Pick at least one vehicle group"
        : null;
  const scopeReady = windowIssues.length === 0 && !scopeIssue;

  // The preview doesn't need the reason; it re-runs when the window or scope changes
  const previewKey = useDebounce(
    JSON.stringify({ startAt: draft.startAt, endAt: draft.endAt, scope: draft.scope, v: draft.vehicleIds, g: draft.groupKeys }),
    400,
  );
  const {
    data: preview,
    isFetching: previewLoading,
    error: previewError,
  } = useQuery({
    queryKey: ["booking-lock-preview", portalKey, previewKey],
    queryFn: () => bookingLockApi.preview(portal, { ...draft, reason: draft.reason || "preview" }),
    enabled: open && scopeReady,
    retry: false,
  });
  const overlapping = scopeReady ? (preview?.overlapping ?? []) : [];

  // A changed window or scope needs a fresh acknowledgement
  useEffect(() => setAcknowledged(false), [previewKey]);

  const create = useMutation({
    mutationFn: () => bookingLockApi.create(portal, { ...draft, acknowledgeOverlaps: overlapping.length > 0 ? acknowledged : undefined }),
    onSuccess: () => {
      toast.success("Bookings locked for the window");
      queryClient.invalidateQueries({ queryKey: ["booking-locks", portalKey] });
      onClose();
    },
    onError: (e: unknown) => {
      toast.error(errorMessage(e, "Couldn't create the booking lock"));
      queryClient.invalidateQueries({ queryKey: ["booking-lock-preview", portalKey] });
    },
  });

  const canSave =
    scopeReady &&
    draft.reason.length > 0 &&
    !!preview &&
    !previewLoading &&
    (overlapping.length === 0 || acknowledged) &&
    !create.isPending;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const q = vehicleSearch.trim().toLowerCase();
  const vehicles = (options?.vehicles ?? []).filter(
    (v) => !q || `${v.regNo} ${v.make} ${v.model} ${v.categoryName}`.toLowerCase().includes(q),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-5 text-orange-600" />
            Lock bookings
          </DialogTitle>
          <DialogDescription>
            Cars in the lock can't be booked for any time inside the window. Bookings already made are not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lock-start-date">From (IST)</Label>
              <div className="flex items-center gap-3 rounded-md border px-3 py-1.5">
                <input
                  id="lock-start-date"
                  type="date"
                  value={form.startDate}
                  min={istToday()}
                  onChange={(e) => set("startDate", e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                <TimeSelect value={form.startTime} onChange={(v) => set("startTime", v)} isDisabled={halfHourOnly} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lock-end-date">Until (IST)</Label>
              <div className="flex items-center gap-3 rounded-md border px-3 py-1.5">
                <input
                  id="lock-end-date"
                  type="date"
                  value={form.endDate}
                  min={form.startDate || istToday()}
                  onChange={(e) => set("endDate", e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                <TimeSelect value={form.endTime} onChange={(v) => set("endTime", v)} isDisabled={halfHourOnly} />
              </div>
            </div>
          </div>
          {windowIssues.length > 0 && <p className="-mt-3 text-xs text-red-600">{windowIssues[0]!.message}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="lock-reason">Reason</Label>
            <Input
              id="lock-reason"
              value={form.reason}
              maxLength={BOOKING_LOCK_REASON_MAX}
              placeholder="e.g. Branch closed for Diwali"
              onChange={(e) => set("reason", e.target.value)}
            />
            <p className="text-xs text-zinc-500">Staff see the reason; customers only see the cars as unavailable.</p>
          </div>

          <div className="space-y-2">
            <Label>Applies to</Label>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <Button
                  key={s.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(form.scope === s.value && "border-orange-500 bg-orange-50 text-orange-700")}
                  onClick={() => set("scope", s.value)}
                >
                  {s.label}
                </Button>
              ))}
            </div>

            {form.scope !== "BRANCH" && optionsLoading && <Loader2 className="size-4 animate-spin text-zinc-400" />}

            {form.scope === "VEHICLES" && options && (
              <div className="space-y-2 rounded-md border p-3">
                <Input
                  value={vehicleSearch}
                  placeholder="Search registration, make or model"
                  onChange={(e) => setVehicleSearch(e.target.value)}
                />
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {vehicles.length === 0 ? (
                    <p className="py-2 text-sm text-zinc-500">No vehicles match.</p>
                  ) : (
                    vehicles.map((v) => (
                      <label key={v.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-50">
                        <Checkbox
                          checked={form.vehicleIds.includes(v.id)}
                          onCheckedChange={() => set("vehicleIds", toggleIn(form.vehicleIds, v.id))}
                        />
                        <span className="font-medium text-zinc-900">{v.regNo}</span>
                        <span className="text-zinc-600">
                          {v.make} {v.model}
                        </span>
                        <span className="text-xs text-zinc-400">{v.categoryName}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-zinc-500">{plural(form.vehicleIds.length, "vehicle")} picked</p>
              </div>
            )}

            {form.scope === "GROUPS" && options && (
              <div className="space-y-1 rounded-md border p-3">
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {options.groups.length === 0 ? (
                    <p className="py-2 text-sm text-zinc-500">This branch has no vehicles yet.</p>
                  ) : (
                    options.groups.map((g) => (
                      <label key={g.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-50">
                        <Checkbox
                          checked={form.groupKeys.includes(g.key)}
                          onCheckedChange={() => set("groupKeys", toggleIn(form.groupKeys, g.key))}
                        />
                        <span className="font-medium text-zinc-900">
                          {g.make} {g.model}
                        </span>
                        <span className="text-xs text-zinc-400">
                          {g.categoryName} · {plural(g.vehicleCount, "vehicle")}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-zinc-500">{plural(form.groupKeys.length, "group")} picked</p>
              </div>
            )}
            {scopeIssue && windowIssues.length === 0 && <p className="text-xs text-red-600">{scopeIssue}</p>}
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.customersOnly}
              onCheckedChange={(v) => set("customersOnly", v === true)}
            />
            <span>
              <span className="font-medium text-zinc-900">Hide from customers only</span>
              <span className="block text-xs text-zinc-500">
                Staff walk-ins, reschedules and swaps are still allowed. Leave unticked to lock everyone, walk-ins too.
              </span>
            </span>
          </label>

          {scopeReady && (
            <div className="space-y-2">
              {previewLoading && !preview ? (
                <p className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="size-4 animate-spin" /> Checking bookings in this window…
                </p>
              ) : previewError ? (
                <p className="text-sm text-red-600">{errorMessage(previewError, "Couldn't check the bookings in this window")}</p>
              ) : preview ? (
                <>
                  <p className="text-sm text-zinc-600">
                    Locks {plural(preview.vehicleCount, "vehicle")} for this window.
                  </p>
                  {overlapping.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                        <AlertTriangle className="size-4" />
                        {plural(overlapping.length, "existing booking")} inside this window
                      </p>
                      <p className="text-xs text-amber-800">
                        They are kept as they are — the lock only stops new bookings and changes. Contact these
                        customers or swap their cars if needed.
                      </p>
                      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-900">
                        {overlapping.map((b) => (
                          <li key={b.bookingPublicId}>
                            <span className="font-semibold">{bookingRef(b.bookingPublicId)}</span>{" "}
                            {b.status === "PICKED_UP" ? "(on rent)" : "(confirmed)"} ·{" "}
                            {b.vehicles.map((v) => v.regNo).join(", ")} · {formatIstDateTime(b.startAt)} –{" "}
                            {formatIstDateTime(b.endAt)}
                            {b.customerName ? ` · ${b.customerName}` : ""}
                          </li>
                        ))}
                      </ul>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-amber-900">
                        <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />I
                        understand these bookings stay as they are
                      </label>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            className="gap-2 bg-orange-500 text-white hover:bg-orange-600"
            disabled={!canSave}
            onClick={() => create.mutate()}
          >
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Lock bookings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * Booking locks for one branch: the list (active / upcoming, past) with a
 * cancel action, and the "Lock bookings" dialog. The branch manager's page and
 * the admin page (with a branch picked) both use it.
 */
export function BookingLocksManager({ portal }: { portal: BookingLockPortal }) {
  const queryClient = useQueryClient();
  const portalKey = portal.kind === "manager" ? "manager" : `admin:${portal.branchId}`;
  const [filter, setFilter] = useState<BookingLockListFilter>("current");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState<BookingLock | null>(null);

  const { data: locks = [], isLoading, error } = useQuery({
    queryKey: ["booking-locks", portalKey, filter],
    queryFn: () => bookingLockApi.list(portal, filter),
    retry: false,
  });

  const cancel = useMutation({
    mutationFn: (lock: BookingLock) => bookingLockApi.cancel(portal, lock.publicId),
    onSuccess: () => {
      toast.success("Booking lock cancelled — the cars can be booked again");
      setCancelling(null);
      queryClient.invalidateQueries({ queryKey: ["booking-locks", portalKey] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Couldn't cancel the booking lock")),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5 text-sm text-orange-900">
        <Info className="mt-0.5 size-4 shrink-0 text-orange-600" />
        <p>
          While a lock is on, the cars it covers can't be booked, rescheduled, swapped onto or extended into any time
          inside its window — online, and at the counter unless it is set to hide from customers only. Bookings already
          made are not changed. Customers just see the cars as unavailable; staff see the reason.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as BookingLockListFilter)}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button onClick={() => setDialogOpen(true)} className="gap-2 bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="size-4" />
          Lock bookings
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Window (IST)</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-zinc-400" />
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-red-600">
                  {errorMessage(error, "Couldn't load booking locks")}
                </TableCell>
              </TableRow>
            ) : locks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  {filter === "current" ? "No active or upcoming booking locks." : "Nothing here for this filter."}
                </TableCell>
              </TableRow>
            ) : (
              locks.map((lock) => {
                const status = STATUS_STYLE[lock.status];
                const scope = appliesTo(lock);
                return (
                  <TableRow key={lock.publicId}>
                    <TableCell className="whitespace-nowrap text-zinc-800">
                      {formatIstDateTime(lock.startAt)}
                      <span className="block text-xs text-zinc-500">until {formatIstDateTime(lock.endAt)}</span>
                    </TableCell>
                    <TableCell className="max-w-[240px] font-medium text-zinc-900">{lock.reason}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-zinc-700" title={scope.title}>
                      {scope.text}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-zinc-600">
                      {lock.customersOnly ? "Customers only" : "Everyone"}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", status.className)}>
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-zinc-600">
                      {lock.createdBy?.name ?? "—"}
                      <span className="block text-xs text-zinc-400">{formatIstDateTime(lock.createdAt)}</span>
                      {lock.cancelledAt && (
                        <span className="block text-xs text-zinc-400">
                          Cancelled{lock.cancelledBy ? ` by ${lock.cancelledBy.name}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {(lock.status === "ACTIVE" || lock.status === "UPCOMING") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setCancelling(lock)}
                        >
                          <XCircle className="size-3.5" />
                          Cancel lock
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <LockDialog portal={portal} portalKey={portalKey} open={dialogOpen} onClose={() => setDialogOpen(false)} />

      <AlertDialog open={!!cancelling} onOpenChange={(next) => !next && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking lock?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling?.reason}. The cars can be booked for this window again straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancel.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (cancelling) cancel.mutate(cancelling);
              }}
            >
              {cancel.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Cancel lock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
