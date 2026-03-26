import { useState } from "react";
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
} from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
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

function SlabModal({
  slab,
  onClose,
  onSaved,
}: {
  slab?: DurationSlab;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!slab;
  const [minDays, setMinDays] = useState(String(slab?.minDays ?? ""));
  const [maxDays, setMaxDays] = useState(slab?.maxDays != null ? String(slab.maxDays) : "");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "FLAT">(slab?.discountType ?? "PERCENTAGE");
  const [discountValue, setDiscountValue] = useState(slab ? String(parseFloat(slab.discountValue)) : "");
  const [label, setLabel] = useState(slab?.label ?? "");
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        minDays: parseInt(minDays),
        ...(maxDays ? { maxDays: parseInt(maxDays) } : {}),
        discountType,
        discountValue: parseFloat(discountValue),
        ...(label ? { label } : {}),
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
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to save slab.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => managerDiscountService.deleteSlab(slab!.id),
    onSuccess: () => {
      toast.success("Slab deleted.");
      queryClient.invalidateQueries({ queryKey: ["discount-slabs"] });
      onSaved();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to delete slab.");
    },
  });

  const isValid = parseInt(minDays) > 0 && parseFloat(discountValue) > 0;
  const isLoading = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Duration Slab" : "Add Duration Slab"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Min Days</Label>
              <Input
                type="number"
                min="1"
                value={minDays}
                onChange={(e) => setMinDays(e.target.value)}
                placeholder="e.g. 3"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Days (blank = unlimited)</Label>
              <Input
                type="number"
                min="1"
                value={maxDays}
                onChange={(e) => setMaxDays(e.target.value)}
                placeholder="e.g. 6"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Discount Type</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as "PERCENTAGE" | "FLAT")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                  <SelectItem value="FLAT">Flat Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
                  {discountType === "PERCENTAGE" ? "%" : "₹"}
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="pl-7"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Label (optional)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Short stay discount"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          {isEdit && (
            <Button
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50 sm:mr-auto"
              onClick={() => deleteMutation.mutate()}
              disabled={isLoading}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              <span className="ml-1.5">Delete</span>
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => saveMutation.mutate()}
            disabled={!isValid || isLoading}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
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
  const [form, setForm] = useState<DiscountConfig>({ ...config });

  const mutation = useMutation({
    mutationFn: () => managerDiscountService.updateConfig(form),
    onSuccess: () => {
      toast.success("Configuration saved.");
      queryClient.invalidateQueries({ queryKey: ["discount-config"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to save configuration.");
    },
  });

  return (
    <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b bg-neutral-50/50 flex items-center gap-2">
        <Settings className="w-4 h-4 text-neutral-500" />
        <h2 className="font-semibold text-neutral-900">Discount Settings</h2>
      </div>
      <div className="px-5 py-4 space-y-5">
        {/* Toggles */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="duration-enabled"
              checked={form.durationDiscountEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, durationDiscountEnabled: !!v }))}
            />
            <div>
              <label htmlFor="duration-enabled" className="text-sm font-medium text-neutral-800 cursor-pointer">
                Duration discounts enabled
              </label>
              <p className="text-xs text-neutral-500 mt-0.5">Apply automatic discounts based on rental duration</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id="stack-coupons"
              checked={form.stackWithCoupons}
              onCheckedChange={(v) => setForm((f) => ({ ...f, stackWithCoupons: !!v }))}
            />
            <div>
              <label htmlFor="stack-coupons" className="text-sm font-medium text-neutral-800 cursor-pointer">
                Stack duration with coupons
              </label>
              <p className="text-xs text-neutral-500 mt-0.5">Allow both duration and coupon discounts on same booking</p>
            </div>
          </div>
        </div>

        {/* Numeric settings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Max combined discount (%)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              value={form.maxCombinedDiscountPercent}
              onChange={(e) => setForm((f) => ({ ...f, maxCombinedDiscountPercent: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Manager approval threshold</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
              <Input
                type="number"
                min="0"
                className="pl-7"
                value={form.managerApprovalThreshold}
                onChange={(e) => setForm((f) => ({ ...f, managerApprovalThreshold: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <p className="text-xs text-neutral-400">Manual discounts above this require approval</p>
          </div>
          <div className="space-y-2">
            <Label>Max manual discounts / employee / day</Label>
            <Input
              type="number"
              min="0"
              value={form.maxManualDiscountsPerDay}
              onChange={(e) => setForm((f) => ({ ...f, maxManualDiscountsPerDay: parseInt(e.target.value) || 0 }))}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Config
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DiscountConfigPage() {
  const [slabModal, setSlabModal] = useState<DurationSlab | true | null>(null);

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

  return (
    <ManagerLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Discount Configuration</h1>
          <p className="text-sm text-neutral-500 mt-1">Configure duration slabs and discount rules for this branch</p>
        </div>

        {/* Config section */}
        {loadingConfig ? (
          <div className="bg-white rounded-lg border h-48 animate-pulse" />
        ) : config ? (
          <ConfigSection config={config} />
        ) : (
          <div className="bg-white rounded-lg border shadow-sm px-5 py-8 flex items-center gap-3 text-neutral-500">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <span>No discount configuration found for this branch.</span>
          </div>
        )}

        {/* Duration Slabs */}
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-neutral-50/50 flex items-center justify-between">
            <h2 className="font-semibold text-neutral-900">Duration Discount Slabs</h2>
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white gap-1 h-8"
              onClick={() => setSlabModal(true)}
            >
              <Plus className="w-3.5 h-3.5" /> Add Slab
            </Button>
          </div>

          {loadingSlabs ? (
            <div className="p-5 space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-neutral-100 rounded animate-pulse" />)}
            </div>
          ) : slabs.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-neutral-400">No duration slabs configured.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1"
                onClick={() => setSlabModal(true)}
              >
                <Plus className="w-3.5 h-3.5" /> Add First Slab
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-5 py-3 font-medium text-neutral-500">Days</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Discount</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Label</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {slabs.map((s) => (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="px-5 py-3.5 font-medium text-neutral-900">
                        {s.minDays}{s.maxDays != null ? `–${s.maxDays}` : "+"} days
                      </td>
                      <td className="px-4 py-3.5 font-semibold">
                        {s.discountType === "PERCENTAGE"
                          ? `${parseFloat(s.discountValue)}%`
                          : `₹ ${parseFloat(s.discountValue).toLocaleString("en-IN")}`}
                      </td>
                      <td className="px-4 py-3.5 text-neutral-500 capitalize">
                        {s.discountType === "PERCENTAGE" ? "Percentage" : "Flat Amount"}
                      </td>
                      <td className="px-4 py-3.5 text-neutral-500">{s.label ?? "—"}</td>
                      <td className="px-4 py-3.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-neutral-400 hover:text-neutral-700"
                          onClick={() => setSlabModal(s)}
                        >
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
          onClose={() => setSlabModal(null)}
          onSaved={() => setSlabModal(null)}
        />
      )}
    </ManagerLayout>
  );
}
