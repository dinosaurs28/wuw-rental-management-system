import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  AlertCircle,
  RefreshCw,
  TrendingDown,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  managerDiscountService,
  type DiscountConfig,
  type DurationSlab,
} from "@/services/discount.service";

// ── Slab Modal ────────────────────────────────────────────────────────────────

/** "3–6 days" / "30+ days" */
const slabRange = (minDays: number, maxDays: number | null) =>
  `${minDays}${maxDays != null ? `–${maxDays}` : "+"} days`;

function SlabModal({
  slab,
  otherSlabs,
  onClose,
  onSaved,
}: {
  slab?: DurationSlab;
  /** The branch's other slabs — a slab's day range may not overlap any of them. */
  otherSlabs: DurationSlab[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!slab;
  const [minDays, setMinDays] = useState(String(slab?.minDays ?? ""));
  const [maxDays, setMaxDays] = useState(slab?.maxDays != null ? String(slab.maxDays) : "");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "FLAT">(slab?.discountType ?? "PERCENTAGE");
  const [discountValue, setDiscountValue] = useState(slab ? String(Number(slab.value)) : "");
  const [label, setLabel] = useState(slab?.label ?? "");
  const queryClient = useQueryClient();

  const minN = Number(minDays);
  const maxN = maxDays.trim() === "" ? null : Number(maxDays);
  const valueN = Number(discountValue);

  // Same rules as the server (which re-checks): whole days, max ≥ min, ≤ 100%, no overlap
  const issues: string[] = [];
  if (minDays.trim() !== "" && (!Number.isInteger(minN) || minN < 1)) issues.push("Min days must be a whole number of at least 1.");
  if (maxN !== null && (!Number.isInteger(maxN) || maxN < 1)) issues.push("Max days must be a whole number of at least 1.");
  else if (maxN !== null && Number.isInteger(minN) && maxN < minN) issues.push("Max days can't be below min days.");
  if (discountType === "PERCENTAGE" && valueN > 100) issues.push("A percentage discount can't be more than 100%.");
  if (Number.isInteger(minN) && minN >= 1 && (maxN === null || maxN >= minN)) {
    const clash = otherSlabs.find(
      (s) => s.minDays <= (maxN ?? Infinity) && (s.maxDays == null || s.maxDays >= minN),
    );
    if (clash) issues.push(`Overlaps the ${slabRange(clash.minDays, clash.maxDays)} slab.`);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        minDays: minN,
        // null = open-ended (also clears Max days on an existing slab)
        maxDays: maxN,
        discountType,
        value: valueN,
        label: label.trim() || null,
      };
      return isEdit
        ? managerDiscountService.updateSlab(slab!.id, payload)
        : managerDiscountService.createSlab(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Slab updated." : "Slab created.");
      queryClient.invalidateQueries({ queryKey: ["discount-slabs"] });
      onSaved();
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || "Failed to save slab."); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => managerDiscountService.deleteSlab(slab!.id),
    onSuccess: () => {
      toast.success("Slab deleted.");
      queryClient.invalidateQueries({ queryKey: ["discount-slabs"] });
      onSaved();
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || "Failed to delete slab."); },
  });

  const isValid = Number.isInteger(minN) && minN > 0 && valueN > 0 && issues.length === 0;
  const isLoading = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{isEdit ? "Edit Duration Slab" : "Add Duration Slab"}</DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Min Days</Label>
              <Input type="number" min="1" className="h-10" value={minDays} onChange={(e) => setMinDays(e.target.value)} placeholder="e.g. 3" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Max Days <span className="text-neutral-400 font-normal">(blank = ∞)</span></Label>
              <Input type="number" min="1" className="h-10" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} placeholder="e.g. 6" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Discount Type</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as "PERCENTAGE" | "FLAT")}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                  <SelectItem value="FLAT">Flat Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">
                Value {discountType === "FLAT" && <span className="text-neutral-400 font-normal">(per vehicle)</span>}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">{discountType === "PERCENTAGE" ? "%" : "₹"}</span>
                <Input type="number" min="0" max={discountType === "PERCENTAGE" ? 100 : undefined} step="0.01" className="pl-7 h-10" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Label <span className="text-neutral-400 font-normal">(optional, shown to customers)</span></Label>
            <Input className="h-10" maxLength={50} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Weekly" />
          </div>

          <p className="text-xs text-neutral-500 leading-relaxed">
            A slab applies when the rental is at least <strong>Min Days</strong> full 24-hour periods —
            7+ days means at least 168 hours (167 h 59 m still counts as 6 days). Only the highest
            matching slab applies.{discountType === "FLAT" && " A flat amount is taken off each vehicle."}
          </p>

          {issues.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {issues.map((msg) => <li key={msg}>{msg}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 gap-2 flex-col sm:flex-row">
          {isEdit && (
            <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 sm:mr-auto gap-1.5 h-10" onClick={() => deleteMutation.mutate()} disabled={isLoading}>
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete
            </Button>
          )}
          <Button variant="outline" className="h-10" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button className="h-10 bg-orange-500 hover:bg-orange-600 text-white gap-1.5" onClick={() => saveMutation.mutate()} disabled={!isValid || isLoading}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Config Section ────────────────────────────────────────────────────────────

function ConfigSection({ config }: { config: DiscountConfig }) {
  const queryClient = useQueryClient();
  // Numeric fields are edited as text: GET sends Decimals as strings, and a
  // blank combined cap means "no cap" (null), not 0.
  const [form, setForm] = useState({
    durationDiscountEnabled: config.durationDiscountEnabled,
    stackWithCoupon: config.stackWithCoupon,
    maxCombinedDiscountPercent:
      config.maxCombinedDiscountPercent == null ? "" : String(Number(config.maxCombinedDiscountPercent)),
    managerApprovalThreshold: String(Number(config.managerApprovalThreshold ?? 0)),
    maxManualDiscountsPerEmployeePerDay: String(config.maxManualDiscountsPerEmployeePerDay ?? ""),
  });

  const capN = form.maxCombinedDiscountPercent.trim() === "" ? null : Number(form.maxCombinedDiscountPercent);
  const thresholdN = Number(form.managerApprovalThreshold);
  const perDayN = Number(form.maxManualDiscountsPerEmployeePerDay);
  const issues: string[] = [];
  if (capN !== null && (!Number.isFinite(capN) || capN < 0 || capN > 100)) issues.push("Max combined discount must be between 0 and 100%, or blank for no cap.");
  if (form.managerApprovalThreshold.trim() === "" || !Number.isFinite(thresholdN) || thresholdN < 0) issues.push("Manager approval threshold must be ₹0 or more.");
  if (!Number.isInteger(perDayN) || perDayN < 1 || perDayN > 50) issues.push("Max manual discounts per employee per day must be a whole number from 1 to 50.");

  const mutation = useMutation({
    mutationFn: () =>
      managerDiscountService.updateConfig({
        durationDiscountEnabled: form.durationDiscountEnabled,
        stackWithCoupon: form.stackWithCoupon,
        maxCombinedDiscountPercent: capN,
        managerApprovalThreshold: thresholdN,
        maxManualDiscountsPerEmployeePerDay: perDayN,
      }),
    onSuccess: () => {
      toast.success("Configuration saved.");
      queryClient.invalidateQueries({ queryKey: ["discount-config"] });
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || "Failed to save configuration."); },
  });

  return (
    <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50/60 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
          <Settings className="w-4 h-4 text-neutral-500" />
        </div>
        <h3 className="font-semibold text-neutral-900 text-sm">Discount Settings</h3>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Toggles */}
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-100">
            <Checkbox
              id="duration-enabled"
              checked={form.durationDiscountEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, durationDiscountEnabled: !!v }))}
              className="mt-0.5"
            />
            <div>
              <label htmlFor="duration-enabled" className="text-sm font-medium text-neutral-800 cursor-pointer">
                Duration discounts enabled
              </label>
              <p className="text-xs text-neutral-500 mt-0.5">Apply automatic discounts based on rental duration</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-100">
            <Checkbox
              id="stack-coupons"
              checked={form.stackWithCoupon}
              onCheckedChange={(v) => setForm((f) => ({ ...f, stackWithCoupon: !!v }))}
              className="mt-0.5"
            />
            <div>
              <label htmlFor="stack-coupons" className="text-sm font-medium text-neutral-800 cursor-pointer">
                Stack duration with coupons
              </label>
              <p className="text-xs text-neutral-500 mt-0.5">
                Allow both duration and coupon discounts on the same booking. When off, the bigger
                saving applies (coupons marked stackable by admin still stack).
              </p>
            </div>
          </div>
        </div>

        {/* Numeric settings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Max combined discount (%)</Label>
            <Input type="number" min="0" max="100" className="h-10" placeholder="No cap" value={form.maxCombinedDiscountPercent}
              onChange={(e) => setForm((f) => ({ ...f, maxCombinedDiscountPercent: e.target.value }))} />
            <p className="text-xs text-neutral-400">
              {capN === 0 ? "0% cancels every discount at this branch." : "Blank = no cap. Manual discounts are trimmed first, then coupons, then slabs."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Manager approval threshold</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
              <Input type="number" min="0" className="pl-7 h-10" value={form.managerApprovalThreshold}
                onChange={(e) => setForm((f) => ({ ...f, managerApprovalThreshold: e.target.value }))} />
            </div>
            <p className="text-xs text-neutral-400">Manual discounts above this require approval</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Max manual discounts / employee / day</Label>
            <Input type="number" min="1" max="50" className="h-10" value={form.maxManualDiscountsPerEmployeePerDay}
              onChange={(e) => setForm((f) => ({ ...f, maxManualDiscountsPerEmployeePerDay: e.target.value }))} />
          </div>
        </div>

        {issues.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {issues.map((msg) => <li key={msg}>{msg}</li>)}
          </ul>
        )}

        <div className="flex justify-end pt-1">
          <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 h-10 px-5" onClick={() => mutation.mutate()} disabled={mutation.isPending || issues.length > 0}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Config
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function DiscountConfigTab() {
  const [slabModal, setSlabModal] = useState<DurationSlab | true | null>(null);
  const queryClient = useQueryClient();
  const location = useLocation();

  const { data: configData, isLoading: loadingConfig } = useQuery({
    queryKey: ["discount-config"],
    queryFn: () => managerDiscountService.getConfig(),
  });

  const { data: slabsData, isLoading: loadingSlabs } = useQuery({
    queryKey: ["discount-slabs"],
    queryFn: () => managerDiscountService.getSlabs(),
  });

  const config: DiscountConfig | undefined = configData?.data;
  const slabs: DurationSlab[] = slabsData?.data ?? [];

  useEffect(() => {
    if (loadingSlabs) return;
    const target = (location.state as any)?.scrollTo;
    if (target) {
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loadingSlabs, location.state]);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Discount Configuration</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Configure duration slabs and discount rules for this branch</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { queryClient.invalidateQueries({ queryKey: ["discount-config"] }); queryClient.invalidateQueries({ queryKey: ["discount-slabs"] }); }} disabled={loadingConfig || loadingSlabs} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingConfig || loadingSlabs ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Config section */}
        {loadingConfig ? (
          <div className="bg-white rounded-xl border border-neutral-200 h-52 animate-pulse" />
        ) : config ? (
          <ConfigSection config={config} />
        ) : (
          <div className="bg-white rounded-xl border border-neutral-200 px-5 py-8 flex items-center gap-3 text-neutral-500">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
            <span className="text-sm">No discount configuration found for this branch.</span>
          </div>
        )}

        {/* Slabs are ignored while duration discounts are off */}
        {config && !config.durationDiscountEnabled && slabs.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <span>
              Duration discounts are turned off, so the slabs below don't apply to any booking. Tick
              "Duration discounts enabled" and save to use them.
            </span>
          </div>
        )}

        {/* Duration Slabs */}
        <div id="duration-discount-slabs" className="bg-white rounded-xl border border-neutral-200 overflow-hidden scroll-mt-6">
          <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50/60 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-neutral-500" />
              </div>
              <h3 className="font-semibold text-neutral-900 text-sm">Duration Discount Slabs</h3>
            </div>
            <Button size="sm" className="h-8 bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-xs px-3" onClick={() => setSlabModal(true)}>
              <Plus className="w-3.5 h-3.5" /> Add Slab
            </Button>
          </div>

          {loadingSlabs ? (
            <div className="p-5 space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-neutral-100 rounded-xl animate-pulse" />)}
            </div>
          ) : slabs.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
                <Tag className="w-5 h-5 text-neutral-400" />
              </div>
              <p className="text-sm text-neutral-500 font-medium">No duration slabs configured</p>
              <Button variant="outline" size="sm" className="mt-3 gap-1 text-xs h-8" onClick={() => setSlabModal(true)}>
                <Plus className="w-3.5 h-3.5" /> Add First Slab
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/80">
                    {["Days Range", "Discount", "Type", "Label", ""].map((h, i) => (
                      <th key={i} className="px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {slabs.map((s) => (
                    <tr key={s.id} className="hover:bg-neutral-50/60 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-neutral-900 text-sm">
                        {slabRange(s.minDays, s.maxDays)}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-neutral-900 text-sm">
                        {s.discountType === "PERCENTAGE"
                          ? `${Number(s.value)}%`
                          : `₹ ${Number(s.value).toLocaleString("en-IN")}`}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-neutral-500">
                        {s.discountType === "PERCENTAGE" ? "Percentage" : "Flat, per vehicle"}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-neutral-500">{s.label ?? <span className="text-neutral-300">—</span>}</td>
                      <td className="px-5 py-3.5">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-neutral-400 hover:text-neutral-700" onClick={() => setSlabModal(s)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {slabModal && (
        <SlabModal
          slab={slabModal === true ? undefined : slabModal}
          otherSlabs={slabs.filter((s) => slabModal === true || s.id !== slabModal.id)}
          onClose={() => setSlabModal(null)}
          onSaved={() => setSlabModal(null)}
        />
      )}
    </>
  );
}
