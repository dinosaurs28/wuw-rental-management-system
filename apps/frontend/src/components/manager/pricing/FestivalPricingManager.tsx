import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { AlertCircle, Info, Loader2, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import {
  SPECIAL_PRICING_MAX_DAYS,
  SPECIAL_PRICING_NAME_MAX,
  formatGroupChange,
  formatSpecialChange,
  isCalendarDate,
  istToday,
  specialPricingRuleIssues,
  vehicleGroupKey,
  type SpecialPricingChangeValue,
  type SpecialPricingListFilter,
  type SpecialPricingStatus,
} from "@repo/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type SpecialPricingGroup,
  type SpecialPricingItem,
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

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "20 Oct – 22 Oct 2026", "20 Oct 2026" */
function dateRangeLabel(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (startDate === endDate) return format(start, "d MMM yyyy");
  return start.getFullYear() === end.getFullYear()
    ? `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
    : `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

/** A per-group rule's changes in one line: "+10%", "up to +10%", "up to +10% · ₹100/day off". */
function groupChangeSummary(items: SpecialPricingItem[]): string {
  const parts: string[] = [];
  for (const type of ["PERCENT", "FLAT"] as const) {
    for (const sign of [1, -1]) {
      const values = items.filter((i) => i.type === type && Math.sign(i.value) === sign).map((i) => Math.abs(i.value));
      if (values.length === 0) continue;
      const max = Math.max(...values);
      parts.push(`${values.every((v) => v === max) ? "" : "up to "}${formatGroupChange(type, sign * max)}`);
    }
  }
  return parts.join(" · ");
}

/** The list's "Change" and "Applies to" cells for a rule (a per-group one, or one from before). */
function ruleSummary(rule: SpecialPricingRule): {
  change: string;
  tone: "up" | "off" | "mixed";
  appliesTo: string;
  title?: string;
} {
  if (rule.scope === "GROUPS") {
    const up = rule.items.every((i) => i.value > 0);
    const off = rule.items.every((i) => i.value < 0);
    return {
      change: groupChangeSummary(rule.items),
      tone: up ? "up" : off ? "off" : "mixed",
      appliesTo: plural(rule.items.length, "group"),
      title: rule.items
        .map((i) => `${i.make} ${i.model}${i.categoryName ? ` (${i.categoryName})` : ""}: ${formatGroupChange(i.type, i.value)}`)
        .join("\n"),
    };
  }
  const tone =
    rule.percent <= 0 && rule.flatAmount <= 0 ? "off" : rule.percent >= 0 && rule.flatAmount >= 0 ? "up" : "mixed";
  const change = formatSpecialChange(rule.percent, rule.flatAmount);
  if (rule.scope === "CATEGORIES") {
    const names = rule.categories.map((c) => c.name);
    return {
      change,
      tone,
      appliesTo: names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`,
      title: names.join(", "),
    };
  }
  if (rule.scope === "VEHICLES") {
    return {
      change,
      tone,
      appliesTo: plural(rule.vehicles.length, "vehicle"),
      title: rule.vehicles.map((v) => `${v.regNo} · ${v.make} ${v.model}`).join("\n"),
    };
  }
  return { change, tone, appliesTo: "All vehicles" };
}

// ── Pricing types ─────────────────────────────────────────────────────────────

/** A group's pricing type: up or off, by a percentage or a flat ₹ a day. */
type PricingType = "PERCENT" | "FLAT" | "PERCENT_OFF" | "FLAT_OFF";

const PRICING_TYPES: { value: PricingType; label: string }[] = [
  { value: "PERCENT", label: "Percentage" },
  { value: "FLAT", label: "Flat amount" },
  { value: "PERCENT_OFF", label: "Percentage off" },
  { value: "FLAT_OFF", label: "Flat amount off" },
];

const changeOf = (type: PricingType): SpecialPricingChangeValue => (type.startsWith("PERCENT") ? "PERCENT" : "FLAT");
const isOff = (type: PricingType) => type.endsWith("_OFF");
const pricingTypeOf = (type: SpecialPricingChangeValue, value: number): PricingType =>
  value < 0 ? (type === "PERCENT" ? "PERCENT_OFF" : "FLAT_OFF") : type;

interface GroupRow {
  type: PricingType;
  /** As typed, positive (the type carries up / off); empty = no change for the group */
  amount: string;
}

interface FormState {
  name: string;
  startDate: string;
  endDate: string;
  rows: Record<string, GroupRow>;
}

const emptyRow = (): GroupRow => ({ type: "PERCENT", amount: "" });
const emptyForm = (): FormState => ({ name: "", startDate: "", endDate: "", rows: {} });

/**
 * The form an existing rule opens with, and a note when it can't be shown as
 * is: groups that left the branch, or a rule from before per-group pricing
 * (spread over the groups it covered).
 */
function formOf(rule: SpecialPricingRule, options: SpecialPricingOptions): { form: FormState; note: string | null } {
  const base = { name: rule.name, startDate: rule.startDate, endDate: rule.endDate };
  const rows: Record<string, GroupRow> = {};
  if (rule.scope === "GROUPS") {
    for (const i of rule.items) rows[i.groupKey] = { type: pricingTypeOf(i.type, i.value), amount: String(Math.abs(i.value)) };
    const keys = new Set(options.groups.map((g) => g.key));
    const gone = rule.items.filter((i) => !keys.has(i.groupKey)).length;
    return {
      form: { ...base, rows },
      note: gone
        ? `${plural(gone, "vehicle group")} in this offer no longer ${gone === 1 ? "has" : "have"} vehicles at the branch — saving removes ${gone === 1 ? "it" : "them"}.`
        : null,
    };
  }
  const vehicleGroups = new Set(
    options.vehicles.filter((v) => rule.vehicleIds.includes(v.id)).map((v) => vehicleGroupKey(v.make, v.model, v.categoryId)),
  );
  const covered = options.groups.filter(
    (g) =>
      rule.scope === "ALL" ||
      (rule.scope === "CATEGORIES" && rule.categoryIds.includes(g.categoryId)) ||
      (rule.scope === "VEHICLES" && vehicleGroups.has(g.key)),
  );
  const type: SpecialPricingChangeValue = rule.percent !== 0 ? "PERCENT" : "FLAT";
  const value = rule.percent !== 0 ? rule.percent : rule.flatAmount;
  for (const g of covered) rows[g.key] = { type: pricingTypeOf(type, value), amount: String(Math.abs(value)) };
  const dropped = rule.percent !== 0 && rule.flatAmount !== 0 ? ` Its ${formatGroupChange("FLAT", rule.flatAmount)} part isn't carried over.` : "";
  return {
    form: { ...base, rows },
    note: `This offer was set up before per-group pricing. Saving replaces it with the group prices below.${dropped}`,
  };
}

/** The rule the form describes: a GROUPS rule pricing each group with an amount. */
function draftOf(form: FormState, groups: SpecialPricingGroup[], active: boolean): SpecialPricingDraft {
  const items = groups.flatMap((g) => {
    const row = form.rows[g.key];
    if (!row || row.amount.trim() === "") return [];
    // Positive numbers only: the type alone says up or off ("-200" is 200)
    const magnitude = Math.abs(Number(row.amount));
    return [{ groupKey: g.key, type: changeOf(row.type), value: isOff(row.type) ? -magnitude : magnitude }];
  });
  return {
    name: form.name.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    percent: 0,
    flatAmount: 0,
    scope: "GROUPS",
    categoryIds: [],
    vehicleIds: [],
    items,
    active,
  };
}

interface FormErrors {
  name?: string;
  startDate?: string;
  endDate?: string;
  items?: string;
  /** Per vehicle group (groupKey) */
  rows: Record<string, string>;
}

/** The same checks the server runs (schemas), field by field and group by group. */
function draftErrors(draft: SpecialPricingDraft, datesMoved: boolean): FormErrors {
  const errors: FormErrors = { rows: {} };
  if (!draft.name) errors.name = "Give the festive offer a name";
  else if (draft.name.length > SPECIAL_PRICING_NAME_MAX) errors.name = `Use at most ${SPECIAL_PRICING_NAME_MAX} characters`;
  if (!isCalendarDate(draft.startDate)) errors.startDate = "Pick the first day";
  if (!isCalendarDate(draft.endDate)) errors.endDate = "Pick the last day";
  else if (datesMoved && draft.endDate < istToday()) errors.endDate = "The end date is in the past";
  for (const issue of specialPricingRuleIssues(draft)) {
    const index = /^items\.(\d+)\./.exec(issue.path)?.[1];
    const groupKey = index != null ? draft.items[Number(index)]?.groupKey : undefined;
    if (groupKey) errors.rows[groupKey] ??= issue.message;
    else if (issue.path === "items") errors.items ??= issue.message;
    else if (issue.path === "startDate" || issue.path === "endDate") errors[issue.path] ??= issue.message;
  }
  return errors;
}

const hasErrors = (e: FormErrors) =>
  !!(e.name || e.startDate || e.endDate || e.items || Object.keys(e.rows).length > 0);

const errorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;

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
    percent: 0,
    flatAmount: 0,
    scope: "GROUPS",
    categoryIds: [],
    vehicleIds: [],
    items: draft.items,
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
    <div className="rounded-lg bg-zinc-50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Preview</p>
        {isFetching && <Loader2 className="size-3.5 animate-spin text-zinc-400" />}
      </div>
      {!ready ? (
        <p className="text-sm text-zinc-500">Choose dates and configure pricing for the vehicle groups.</p>
      ) : error ? (
        <p className="text-sm text-red-600">{errorMessage(error, "Couldn't load the preview")}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : data.samples.length === 0 ? (
        <p className="text-sm text-zinc-500">None of these vehicle groups has rates set yet.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            24-hour rent on {format(parseISO(data.day), "EEE d MMM")}, incl. GST
          </p>
          <div className="space-y-1.5">
            {data.samples.map((sample) => (
              <div key={sample.groupKey ?? sample.vehicleId} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-zinc-700">
                  {sample.name} <span className="text-xs text-zinc-400">· {sample.category}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-zinc-400 line-through">{rupees(sample.before)}</span>
                  <span className="mx-1.5 text-zinc-400">→</span>
                  <span className="font-semibold text-zinc-900">{rupees(sample.after)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Create / edit dialog ──────────────────────────────────────────────────────

function GroupPricingRow({
  group,
  row,
  error,
  onChange,
}: {
  group: SpecialPricingGroup;
  row: GroupRow;
  error?: string;
  onChange: (row: GroupRow) => void;
}) {
  const percent = changeOf(row.type) === "PERCENT";
  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_170px_150px] sm:items-start sm:gap-3">
      <div className="min-w-0 sm:pt-1.5">
        <p className="truncate text-sm font-semibold text-zinc-900">
          {group.make} {group.model}
        </p>
        <p className="text-xs text-zinc-500">
          {plural(group.vehicleCount, "vehicle")} · {group.categoryName}
        </p>
      </div>
      <Select value={row.type} onValueChange={(type) => onChange({ ...row, type: type as PricingType })}>
        <SelectTrigger className="w-full" aria-label={`Pricing type for ${group.make} ${group.model}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRICING_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div>
        <div className="relative">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={row.amount}
            // Positive numbers only: the pricing type says up or off
            onChange={(e) => onChange({ ...row, amount: e.target.value.replace(/^-/, "") })}
            placeholder="Enter amount"
            className="pr-9"
            aria-label={`Amount for ${group.make} ${group.model}`}
            aria-invalid={!!error}
          />
          <span className="pointer-events-none absolute right-3 top-2 text-sm text-zinc-400">{percent ? "%" : "₹"}</span>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

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
  const [note, setNote] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; rows: Record<string, string> } | null>(null);

  const { data: options, isLoading: loadingOptions } = useQuery({
    queryKey: ["special-pricing-options", portalKey],
    queryFn: () => specialPricingApi.options(portal),
    enabled: open,
    staleTime: 60_000,
  });

  // Opened: the rule's values once the branch's vehicle groups are known (once per opening,
  // so a background refetch of the groups never wipes what was typed)
  const openKey = open ? editing?.publicId ?? "new" : null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!openKey) {
      setLoadedFor(null);
      return;
    }
    if (loadedFor === openKey) return;
    if (editing && !options) {
      // Name and dates straight away; the group rows once the groups arrive
      setForm({ name: editing.name, startDate: editing.startDate, endDate: editing.endDate, rows: {} });
      return;
    }
    setShowErrors(false);
    setServerError(null);
    const opened = editing && options ? formOf(editing, options) : { form: emptyForm(), note: null };
    setForm(opened.form);
    setNote(opened.note);
    setLoadedFor(openKey);
  }, [openKey, loadedFor, editing, options]);

  const groups = options?.groups ?? [];
  const draft = draftOf(form, groups, editing?.active ?? true);
  const datesMoved = !editing || editing.startDate !== draft.startDate || editing.endDate !== draft.endDate;
  const errors = draftErrors(draft, datesMoved);
  const previewReady =
    !errors.startDate && !errors.endDate && draft.items.length > 0 && Object.keys(errors.rows).length === 0;
  const span =
    isCalendarDate(draft.startDate) && isCalendarDate(draft.endDate) && draft.endDate >= draft.startDate
      ? Math.round((parseISO(draft.endDate).getTime() - parseISO(draft.startDate).getTime()) / 86_400_000) + 1
      : null;

  const save = useMutation({
    mutationFn: () => (editing ? specialPricingApi.update(portal, editing.publicId, draft) : specialPricingApi.create(portal, draft)),
    onSuccess: () => {
      toast.success(editing ? "Festive pricing updated" : "Festive offer created");
      queryClient.invalidateQueries({ queryKey: ["special-pricing", portalKey] });
      onClose();
    },
    onError: (e: unknown) => {
      const data = (e as { response?: { data?: { message?: string; errors?: { path: string; message: string }[] } } })
        .response?.data;
      const rows: Record<string, string> = {};
      for (const issue of data?.errors ?? []) {
        const index = /^items\.(\d+)\./.exec(issue.path)?.[1];
        const groupKey = index != null ? draft.items[Number(index)]?.groupKey : undefined;
        if (groupKey) rows[groupKey] ??= issue.message;
      }
      setServerError({ message: data?.message || "Couldn't save the festive pricing", rows });
    },
  });

  const setRow = (key: string, row: GroupRow) => {
    setForm((prev) => ({ ...prev, rows: { ...prev.rows, [key]: row } }));
    setServerError(null);
  };
  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setServerError(null);
  };
  const shown = (message?: string) => (showErrors ? message : undefined);

  const submit = () => {
    if (hasErrors(errors)) {
      setShowErrors(true);
      return;
    }
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit festive pricing" : "Add festive pricing"}</DialogTitle>
          <DialogDescription>Set special pricing for vehicle groups during your festive offer dates.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="festival-name">Name of the festive offer</Label>
            <Input
              id="festival-name"
              value={form.name}
              maxLength={SPECIAL_PRICING_NAME_MAX}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Diwali Special"
              aria-invalid={!!shown(errors.name)}
            />
            {shown(errors.name) && <p className="text-xs text-red-600">{errors.name}</p>}
          </div>

          {/* Dates */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="festival-start">Start date</Label>
                <Input
                  id="festival-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    update({
                      startDate: e.target.value,
                      // A one-day offer by default
                      ...(!form.endDate || form.endDate < e.target.value ? { endDate: e.target.value } : {}),
                    })
                  }
                  aria-invalid={!!shown(errors.startDate)}
                />
                {shown(errors.startDate) && <p className="text-xs text-red-600">{errors.startDate}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="festival-end">End date</Label>
                <Input
                  id="festival-end"
                  type="date"
                  value={form.endDate}
                  min={form.startDate || undefined}
                  onChange={(e) => update({ endDate: e.target.value })}
                  aria-invalid={!!(errors.endDate && (showErrors || form.endDate))}
                />
                {errors.endDate && (showErrors || form.endDate) && <p className="text-xs text-red-600">{errors.endDate}</p>}
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              {span != null ? `${plural(span, "day")} · ` : ""}
              Both days included, up to {SPECIAL_PRICING_MAX_DAYS} days. A rental day (or the last 12 hours) is
              charged the festival price when it starts on one of these dates.
            </p>
          </div>

          {/* Vehicle group pricing */}
          <div className="space-y-2">
            <div>
              <p className="text-sm font-semibold text-zinc-900">Vehicle group pricing</p>
              <p className="text-xs text-zinc-500">Choose a pricing change for each group.</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="hidden grid-cols-[minmax(0,1fr)_170px_150px] gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-500 sm:grid">
                <span>Vehicle group</span>
                <span>Pricing type</span>
                <span>Amount</span>
              </div>
              {loadingOptions || !options ? (
                <div className="space-y-2 p-4">
                  <div className="h-10 animate-pulse rounded-md bg-zinc-100" />
                  <div className="h-10 animate-pulse rounded-md bg-zinc-100" />
                </div>
              ) : groups.length === 0 ? (
                <p className="px-4 py-4 text-sm text-zinc-500">This branch has no vehicles yet.</p>
              ) : (
                <div className="max-h-[42vh] divide-y divide-zinc-100 overflow-y-auto">
                  {groups.map((group) => (
                    <GroupPricingRow
                      key={group.key}
                      group={group}
                      row={form.rows[group.key] ?? emptyRow()}
                      error={serverError?.rows[group.key] ?? shown(errors.rows[group.key])}
                      onChange={(row) => setRow(group.key, row)}
                    />
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Leave the amount empty for no change. Flat amounts are per day: 12 hours get half.
            </p>
            {shown(errors.items) && <p className="text-xs text-red-600">{errors.items}</p>}
          </div>

          <DraftPreview portal={portal} portalKey={portalKey} draft={draft} ready={previewReady} />

          {note && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>{note}</span>
            </div>
          )}
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
          <Button
            type="button"
            onClick={submit}
            disabled={save.isPending || (!!editing && !options)}
            className="bg-orange-500 text-white hover:bg-orange-600"
          >
            {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {editing ? "Save changes" : "Create festive offer"}
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
          A rental day is charged the festival price when it starts on a festival date: each day of a trip
          (counted from pickup) — or its last 12 hours — that starts on an offer's dates is billed at the rent
          changed by its vehicle group's pricing (a flat amount is per day, 12 hours get half; weekend rents apply
          underneath). When offers overlap, the one giving the higher price applies. Free km don't change, bookings
          already made keep their prices, and customers see only the final price.
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
          Add festive pricing
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
                const summary = ruleSummary(rule);
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
                        summary.tone === "off" ? "text-emerald-600" : summary.tone === "up" ? "text-orange-600" : "text-zinc-700",
                      )}
                    >
                      {summary.change}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-zinc-700" title={summary.title}>
                      {summary.appliesTo}
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
