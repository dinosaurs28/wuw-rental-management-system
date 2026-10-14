import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  AlertCircle,
  Info,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  SPECIAL_PRICING_MAX_DAYS,
  SPECIAL_PRICING_NAME_MAX,
  SPECIAL_PRICING_PERCENT_MAX,
  SPECIAL_PRICING_FLAT_MAX,
  calendarDaysBetween,
  formatSpecialChange,
  isCalendarDate,
  istToday,
  specialPricingRuleIssues,
  type SpecialPricingListFilter,
  type SpecialPricingScopeValue,
  type SpecialPricingStatus,
} from "@repo/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  specialPricingApi,
  type SpecialPricingDraft,
  type SpecialPricingOptions,
  type SpecialPricingPortal,
  type SpecialPricingRule,
} from "@/services/specialPricing.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FILTERS: { value: SpecialPricingListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Running now" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
];

const STATUS_STYLE: Record<SpecialPricingStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  UPCOMING: { label: "Upcoming", className: "bg-sky-50 text-sky-700 border-sky-200" },
  PAST: { label: "Past", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  PAUSED: { label: "Paused", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

const SCOPES: { value: SpecialPricingScopeValue; label: string }[] = [
  { value: "ALL", label: "All vehicles" },
  { value: "CATEGORIES", label: "Categories" },
  { value: "VEHICLES", label: "Vehicles" },
];

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "20 Oct – 22 Oct 2026", "20 Oct 2026" */
function dateRangeLabel(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (startDate === endDate) return format(start, "d MMM yyyy");
  return start.getFullYear() === end.getFullYear()
    ? `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
    : `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

function scopeSummary(rule: SpecialPricingRule): { text: string; title?: string } {
  if (rule.scope === "CATEGORIES") {
    const names = rule.categories.map((c) => c.name);
    return {
      text: names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`,
      title: names.join(", "),
    };
  }
  if (rule.scope === "VEHICLES") {
    return {
      text: `${rule.vehicles.length} vehicle${rule.vehicles.length === 1 ? "" : "s"}`,
      title: rule.vehicles.map((v) => `${v.regNo} · ${v.make} ${v.model}`).join("\n"),
    };
  }
  return { text: "All vehicles" };
}

type Direction = "increase" | "decrease";

interface FormState {
  name: string;
  startDate: string;
  endDate: string;
  /** The percentage without its sign, as typed (blank = none) */
  percentDirection: Direction;
  percent: string;
  /** The flat ₹ a day without its sign, as typed (blank = none) */
  flatDirection: Direction;
  flatAmount: string;
  scope: SpecialPricingScopeValue;
  categoryIds: number[];
  vehicleIds: number[];
  active: boolean;
}

const emptyForm = (): FormState => ({
  name: "",
  startDate: "",
  endDate: "",
  percentDirection: "increase",
  percent: "",
  flatDirection: "increase",
  flatAmount: "",
  scope: "ALL",
  categoryIds: [],
  vehicleIds: [],
  active: true,
});

const formOf = (rule: SpecialPricingRule): FormState => ({
  name: rule.name,
  startDate: rule.startDate,
  endDate: rule.endDate,
  percentDirection: rule.percent < 0 ? "decrease" : "increase",
  percent: rule.percent ? String(Math.abs(rule.percent)) : "",
  flatDirection: rule.flatAmount < 0 ? "decrease" : "increase",
  flatAmount: rule.flatAmount ? String(Math.abs(rule.flatAmount)) : "",
  scope: rule.scope,
  categoryIds: rule.categoryIds,
  vehicleIds: rule.vehicleIds,
  active: rule.active,
});

/**
 * A typed amount with its direction: the toggle alone sets the sign (a typed
 * "-200" is 200), blank = 0; anything not a number stays NaN for the checks.
 */
const signed = (typed: string, direction: Direction) => {
  const magnitude = typed.trim() === "" ? 0 : Math.abs(Number(typed));
  return direction === "decrease" && magnitude !== 0 ? -magnitude : magnitude;
};

function draftOf(form: FormState): SpecialPricingDraft {
  return {
    name: form.name.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    percent: signed(form.percent, form.percentDirection),
    flatAmount: signed(form.flatAmount, form.flatDirection),
    scope: form.scope,
    categoryIds: form.scope === "CATEGORIES" ? form.categoryIds : [],
    vehicleIds: form.scope === "VEHICLES" ? form.vehicleIds : [],
    active: form.active,
  };
}

type FieldErrors = Partial<
  Record<"name" | "startDate" | "endDate" | "percent" | "flatAmount" | "categoryIds" | "vehicleIds", string>
>;

/** The same checks the server runs (schemas), field by field. */
function draftErrors(draft: SpecialPricingDraft, datesMoved: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name) errors.name = "Give the festival a name";
  else if (draft.name.length > SPECIAL_PRICING_NAME_MAX) errors.name = `Use at most ${SPECIAL_PRICING_NAME_MAX} characters`;
  if (!isCalendarDate(draft.startDate)) errors.startDate = "Pick the first day";
  if (!isCalendarDate(draft.endDate)) errors.endDate = "Pick the last day";
  else if (datesMoved && draft.endDate < istToday()) errors.endDate = "The end date is in the past";
  for (const issue of specialPricingRuleIssues(draft)) {
    const key = issue.path as keyof FieldErrors;
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

const errorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;

// ── Scope pickers ─────────────────────────────────────────────────────────────

function CategoryPicker({
  options,
  selected,
  onChange,
}: {
  options: SpecialPricingOptions["categories"];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  if (options.length === 0) {
    return <p className="px-1 py-2 text-xs text-zinc-500">This branch has no vehicle categories in use yet.</p>;
  }
  const toggle = (id: number, on: boolean) =>
    onChange(on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id));
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border divide-y divide-zinc-100">
      {options.map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-50">
          <Checkbox checked={selected.includes(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} />
          <span className="text-zinc-800">{c.name}</span>
          <span className="ml-auto text-xs text-zinc-400">
            {c.vehicleCount} vehicle{c.vehicleCount === 1 ? "" : "s"}
          </span>
        </label>
      ))}
    </div>
  );
}

function VehiclePicker({
  options,
  selected,
  onChange,
}: {
  options: SpecialPricingOptions["vehicles"];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((v) => `${v.regNo} ${v.make} ${v.model} ${v.categoryName}`.toLowerCase().includes(q))
    : options;
  if (options.length === 0) {
    return <p className="px-1 py-2 text-xs text-zinc-500">This branch has no vehicles yet.</p>;
  }
  const toggle = (id: number, on: boolean) =>
    onChange(on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 size-4 text-zinc-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by number, make, model or category"
          className="h-9 pl-9 text-sm"
        />
      </div>
      <div className="max-h-52 overflow-y-auto rounded-md border divide-y divide-zinc-100">
        {shown.length === 0 ? (
          <p className="px-3 py-3 text-xs text-zinc-500">No vehicle matches “{query}”.</p>
        ) : (
          shown.map((v) => (
            <label key={v.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-50">
              <Checkbox checked={selected.includes(v.id)} onCheckedChange={(on) => toggle(v.id, !!on)} />
              <span className="font-medium text-zinc-800">{v.regNo}</span>
              <span className="truncate text-zinc-600">
                {v.make} {v.model}
              </span>
              <span className="ml-auto shrink-0 text-xs text-zinc-400">{v.categoryName}</span>
            </label>
          ))
        )}
      </div>
      <p className="text-xs text-zinc-500">{selected.length} selected</p>
    </div>
  );
}

// ── Preview ───────────────────────────────────────────────────────────────────

function DraftPreview({ portal, portalKey, draft, ready }: {
  portal: SpecialPricingPortal;
  portalKey: string;
  draft: SpecialPricingDraft;
  ready: boolean;
}) {
  // Debounced by value (a string), fetched once typing settles on a valid draft
  const inputKey = JSON.stringify({
    startDate: draft.startDate,
    endDate: draft.endDate,
    percent: draft.percent,
    flatAmount: draft.flatAmount,
    scope: draft.scope,
    categoryIds: draft.categoryIds,
    vehicleIds: draft.vehicleIds,
  });
  const debouncedKey = useDebounce(inputKey, 400);
  const { data, isFetching, error } = useQuery({
    queryKey: ["special-pricing-preview", portalKey, debouncedKey],
    queryFn: () => specialPricingApi.preview(portal, JSON.parse(debouncedKey)),
    enabled: ready && debouncedKey === inputKey,
    retry: false,
    staleTime: 30_000,
  });

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Preview</p>
        {isFetching && <Loader2 className="size-3.5 animate-spin text-zinc-400" />}
      </div>
      {!ready ? (
        <p className="text-xs text-zinc-500">Fill in the dates, the change and what it applies to.</p>
      ) : error ? (
        <p className="text-xs text-red-600">{errorMessage(error, "Couldn't load the preview")}</p>
      ) : !data ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : data.samples.length === 0 ? (
        <p className="text-xs text-zinc-500">
          {data.vehiclesInScope === 0 ? "No vehicles match yet." : "None of these vehicles has rates set yet."}
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            24-hour rent on {format(parseISO(data.day), "EEE d MMM")} (incl. GST) · {data.vehiclesInScope} vehicle
            {data.vehiclesInScope === 1 ? "" : "s"} in scope
          </p>
          <div className="space-y-1.5">
            {data.samples.map((s) => (
              <div key={s.vehicleId} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-zinc-700">
                  {s.name} <span className="text-xs text-zinc-400">· {s.category}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-zinc-400 line-through">{rupees(s.before)}</span>
                  <span className="mx-1.5 text-zinc-400">→</span>
                  <span className="font-semibold text-zinc-900">{rupees(s.after)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Change inputs ─────────────────────────────────────────────────────────────

/** One part of a rule's change: Increase / Decrease and the amount (% or ₹ a day). */
function ChangeInput({
  id,
  label,
  unit,
  direction,
  value,
  max,
  placeholder,
  invalid,
  onDirection,
  onValue,
}: {
  id: string;
  label: string;
  unit: "%" | "₹";
  direction: Direction;
  value: string;
  max: number;
  placeholder: string;
  invalid: boolean;
  onDirection: (direction: Direction) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor={id} className="w-36 text-sm font-normal text-zinc-600">
        {label}
      </Label>
      <div className="inline-flex rounded-lg border border-zinc-200 p-0.5">
        {(["increase", "decrease"] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => onDirection(dir)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              direction === dir
                ? dir === "increase"
                  ? "bg-orange-500 text-white"
                  : "bg-emerald-600 text-white"
                : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {dir === "increase" ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            {dir === "increase" ? "Increase" : "Decrease"}
          </button>
        ))}
      </div>
      <div className="relative w-32">
        {unit === "₹" && <span className="pointer-events-none absolute left-3 top-2 text-sm text-zinc-400">₹</span>}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step="0.01"
          value={value}
          // The Increase / Decrease toggle carries the sign: a typed minus is dropped
          onChange={(e) => onValue(e.target.value.replace(/^-/, ""))}
          placeholder={placeholder}
          className={unit === "₹" ? "pl-7" : "pr-8"}
          aria-invalid={invalid}
        />
        {unit === "%" && <span className="pointer-events-none absolute right-3 top-2 text-sm text-zinc-400">%</span>}
      </div>
    </div>
  );
}

// ── Create / edit dialog ──────────────────────────────────────────────────────

function RuleDialog({
  portal,
  portalKey,
  editing,
  open,
  onClose,
}: {
  portal: SpecialPricingPortal;
  portalKey: string;
  editing: SpecialPricingRule | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; fields: FieldErrors } | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? formOf(editing) : emptyForm());
    setShowErrors(false);
    setServerError(null);
  }, [open, editing]);

  const { data: options, isLoading: loadingOptions } = useQuery({
    queryKey: ["special-pricing-options", portalKey],
    queryFn: () => specialPricingApi.options(portal),
    enabled: open,
    staleTime: 60_000,
  });

  const draft = draftOf(form);
  const datesMoved = !editing || editing.startDate !== draft.startDate || editing.endDate !== draft.endDate;
  const errors = draftErrors(draft, datesMoved);
  const previewReady =
    !errors.startDate &&
    !errors.endDate &&
    !errors.percent &&
    !errors.flatAmount &&
    !errors.categoryIds &&
    !errors.vehicleIds;
  const fieldError = (key: keyof FieldErrors) => serverError?.fields[key] ?? (showErrors ? errors[key] : undefined);
  const span = isCalendarDate(draft.startDate) && isCalendarDate(draft.endDate)
    ? calendarDaysBetween(draft.startDate, draft.endDate) + 1
    : null;

  const save = useMutation({
    mutationFn: () => (editing ? specialPricingApi.update(portal, editing.publicId, draft) : specialPricingApi.create(portal, draft)),
    onSuccess: () => {
      toast.success(editing ? "Festival pricing updated" : "Festival pricing created");
      queryClient.invalidateQueries({ queryKey: ["special-pricing", portalKey] });
      onClose();
    },
    onError: (e: unknown) => {
      const data = (e as { response?: { data?: { message?: string; errors?: { path: string; message: string }[] } } })
        .response?.data;
      const fields: FieldErrors = {};
      for (const issue of data?.errors ?? []) fields[issue.path as keyof FieldErrors] ??= issue.message;
      setServerError({ message: data?.message || "Couldn't save the festival pricing", fields });
    },
  });

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setServerError(null);
  };

  const submit = () => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit festival pricing" : "Add festival pricing"}</DialogTitle>
          <DialogDescription>
            Raise (or lower) rents by a percentage, a flat amount a day, or both on festival dates. Bookings
            already made keep their prices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="festival-name">Name</Label>
            <Input
              id="festival-name"
              value={form.name}
              maxLength={SPECIAL_PRICING_NAME_MAX}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Dussehra"
              aria-invalid={!!fieldError("name")}
            />
            {fieldError("name") && <p className="text-xs text-red-600">{fieldError("name")}</p>}
          </div>

          {/* Dates */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="festival-start">First day</Label>
                <Input
                  id="festival-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    update({
                      startDate: e.target.value,
                      // A one-day festival by default
                      ...(!form.endDate || form.endDate < e.target.value ? { endDate: e.target.value } : {}),
                    })
                  }
                  aria-invalid={!!fieldError("startDate")}
                />
                {fieldError("startDate") && <p className="text-xs text-red-600">{fieldError("startDate")}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="festival-end">Last day</Label>
                <Input
                  id="festival-end"
                  type="date"
                  value={form.endDate}
                  min={form.startDate || undefined}
                  onChange={(e) => update({ endDate: e.target.value })}
                  aria-invalid={!!fieldError("endDate")}
                />
                {fieldError("endDate") && <p className="text-xs text-red-600">{fieldError("endDate")}</p>}
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              {span != null && span > 0 ? `${span} day${span === 1 ? "" : "s"} · ` : ""}
              Both days included, up to {SPECIAL_PRICING_MAX_DAYS} days. A day or 12 hours of a trip counts when at
              least half of it falls on these dates.
            </p>
          </div>

          {/* Change: a percentage, a flat ₹ a day, or both */}
          <div className="space-y-2">
            <Label>Change</Label>
            <ChangeInput
              id="festival-percent"
              label="Percentage"
              unit="%"
              direction={form.percentDirection}
              value={form.percent}
              max={form.percentDirection === "decrease" ? 90 : SPECIAL_PRICING_PERCENT_MAX}
              placeholder="10"
              invalid={!!fieldError("percent")}
              onDirection={(percentDirection) => update({ percentDirection })}
              onValue={(percent) => update({ percent })}
            />
            <ChangeInput
              id="festival-flat"
              label="Flat amount a day"
              unit="₹"
              direction={form.flatDirection}
              value={form.flatAmount}
              max={SPECIAL_PRICING_FLAT_MAX}
              placeholder="200"
              invalid={!!fieldError("flatAmount")}
              onDirection={(flatDirection) => update({ flatDirection })}
              onValue={(flatAmount) => update({ flatAmount })}
            />
            <p className="text-xs text-zinc-500">
              Fill in either or both. The flat amount is for a full day: 12 hours get half of it, an hourly trip its
              hours' share.
            </p>
            {fieldError("percent") && <p className="text-xs text-red-600">{fieldError("percent")}</p>}
            {fieldError("flatAmount") && <p className="text-xs text-red-600">{fieldError("flatAmount")}</p>}
          </div>

          {/* Scope */}
          <div className="space-y-2">
            <Label>Applies to</Label>
            <div className="inline-flex flex-wrap rounded-lg border border-zinc-200 p-0.5">
              {SCOPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => update({ scope: s.value })}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    form.scope === s.value ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {form.scope !== "ALL" &&
              (loadingOptions || !options ? (
                <div className="h-24 animate-pulse rounded-md border bg-zinc-50" />
              ) : form.scope === "CATEGORIES" ? (
                <CategoryPicker
                  options={options.categories}
                  selected={form.categoryIds}
                  onChange={(categoryIds) => update({ categoryIds })}
                />
              ) : (
                <VehiclePicker
                  options={options.vehicles}
                  selected={form.vehicleIds}
                  onChange={(vehicleIds) => update({ vehicleIds })}
                />
              ))}
            {fieldError("categoryIds") && <p className="text-xs text-red-600">{fieldError("categoryIds")}</p>}
            {fieldError("vehicleIds") && <p className="text-xs text-red-600">{fieldError("vehicleIds")}</p>}
          </div>

          {/* Active */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">Active</p>
              <p className="mt-0.5 text-xs text-zinc-500">A paused festival isn't charged until you resume it.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.active}
              aria-label="Active"
              onClick={() => update({ active: !form.active })}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                form.active ? "bg-primary" : "bg-zinc-200",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                  form.active ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>

          <DraftPreview portal={portal} portalKey={portalKey} draft={draft} ready={previewReady} />

          {serverError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{serverError.message}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={save.isPending} className="bg-orange-500 text-white hover:bg-orange-600">
            {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * Festival pricing for one branch: the rules table (filter, pause / resume,
 * edit, delete) and the create / edit dialog with a live preview. The branch
 * manager's page and the admin page (with a branch picked) both use it.
 */
export function FestivalPricingManager({ portal }: { portal: SpecialPricingPortal }) {
  const queryClient = useQueryClient();
  const portalKey = portal.kind === "manager" ? "manager" : `admin:${portal.branchId}`;
  const [filter, setFilter] = useState<SpecialPricingListFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SpecialPricingRule | null>(null);
  const [deleting, setDeleting] = useState<SpecialPricingRule | null>(null);

  const { data: rules = [], isLoading, error } = useQuery({
    queryKey: ["special-pricing", portalKey, filter],
    queryFn: () => specialPricingApi.list(portal, filter),
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: (rule: SpecialPricingRule) => specialPricingApi.update(portal, rule.publicId, { active: !rule.active }),
    onSuccess: (rule) => {
      toast.success(rule.active ? `${rule.name} resumed` : `${rule.name} paused`);
      queryClient.invalidateQueries({ queryKey: ["special-pricing", portalKey] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Couldn't update the festival pricing")),
  });

  const remove = useMutation({
    mutationFn: (rule: SpecialPricingRule) => specialPricingApi.remove(portal, rule.publicId),
    onSuccess: () => {
      toast.success("Festival pricing deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["special-pricing", portalKey] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Couldn't delete the festival pricing")),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (rule: SpecialPricingRule) => {
    setEditing(rule);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5 text-sm text-orange-900">
        <Info className="mt-0.5 size-4 shrink-0 text-orange-600" />
        <p>
          On a festival's dates each day of a trip — or its last 12 hours — is billed at the rent changed by the
          festival's percentage and / or flat amount a day (12 hours get half of it), when at least half of it falls
          on those dates (weekend rents apply underneath).
          When festivals overlap, the one giving the higher price applies. Free km don't change, and bookings already
          made keep their prices.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as SpecialPricingListFilter)}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button onClick={openCreate} className="gap-2 bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="size-4" />
          Add festival pricing
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Festival</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Applies to</TableHead>
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
                  {errorMessage(error, "Couldn't load festival pricing")}
                </TableCell>
              </TableRow>
            ) : rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  {filter === "all"
                    ? "No festival pricing yet. Add one before the next festival."
                    : "Nothing here for this filter."}
                </TableCell>
              </TableRow>
            ) : (
              rules.map((rule) => {
                const scope = scopeSummary(rule);
                const status = STATUS_STYLE[rule.status];
                return (
                  <TableRow key={rule.publicId}>
                    <TableCell className="font-medium text-zinc-900">{rule.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-zinc-800">{dateRangeLabel(rule.startDate, rule.endDate)}</span>
                      <span className="block text-xs text-zinc-400">
                        {rule.days} day{rule.days === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap font-semibold tabular-nums",
                        rule.percent <= 0 && rule.flatAmount <= 0
                          ? "text-emerald-600"
                          : rule.percent >= 0 && rule.flatAmount >= 0
                            ? "text-orange-600"
                            : "text-zinc-700",
                      )}
                    >
                      {formatSpecialChange(rule.percent, rule.flatAmount)}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-zinc-700" title={scope.title}>
                      {scope.text}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                          status.className,
                        )}
                      >
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-zinc-600">
                      {rule.createdBy?.name ?? "—"}
                      <span className="block text-xs text-zinc-400">{format(new Date(rule.createdAt), "d MMM yyyy")}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="inline-flex gap-1.5">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(rule)}>
                          <Pencil className="size-3.5" />
                          Edit
                        </Button>
                        {rule.endDate >= istToday() && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={toggle.isPending && toggle.variables?.publicId === rule.publicId}
                            onClick={() => toggle.mutate(rule)}
                          >
                            {rule.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                            {rule.active ? "Pause" : "Resume"}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleting(rule)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <RuleDialog
        portal={portal}
        portalKey={portalKey}
        editing={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />

      <AlertDialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              New quotes stop using it straight away. Bookings already made with it keep their prices. To stop it for
              a while instead, pause it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting);
              }}
            >
              {remove.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
