import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus,
  Tag,
  RefreshCw,
  Calendar,
  BadgePercent,
  Banknote,
  PowerOff,
  Search,
  X,
  UserCheck,
  AlertTriangle,
  Pencil,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { managerDiscountService, type ManagerCoupon } from "@/services/discount.service";

const fmt = (v: string | number) =>
  `₹ ${parseFloat(String(v)).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;

// ── Deactivate Confirm Dialog ─────────────────────────────────────────────────

function DeactivateDialog({
  coupon,
  onClose,
  onConfirm,
  loading,
}: {
  coupon: ManagerCoupon;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <DialogTitle className="text-[15px]">Deactivate Coupon</DialogTitle>
                <p className="text-xs text-neutral-500 font-mono mt-0.5">{coupon.code}</p>
              </div>
            </div>
          </DialogHeader>
        </div>
        <div className="px-6 py-5">
          <DialogDescription className="text-sm text-neutral-600 leading-relaxed">
            Customers will no longer be able to use{" "}
            <span className="font-mono font-semibold text-neutral-900">{coupon.code}</span>.
            This action cannot be undone.
          </DialogDescription>
          <div className="flex gap-2 mt-5">
            <Button variant="outline" className="flex-1 h-11" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white" onClick={onConfirm} disabled={loading}>
              {loading ? "Deactivating…" : "Yes, deactivate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Customer Picker ───────────────────────────────────────────────────────────

interface CustomerResult {
  customerProfileId: number;
  name: string;
  phone: string;
  publicId: string;
}

function CustomerRestrictionPicker({
  selected,
  onChange,
}: {
  selected: CustomerResult[];
  onChange: (customers: CustomerResult[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 3) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await managerDiscountService.searchCustomer(val.trim());
        setResults(res.data);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  };

  const addCustomer = (c: CustomerResult) => {
    if (selected.some((s) => s.customerProfileId === c.customerProfileId)) return;
    onChange([...selected, c]);
    setQuery("");
    setResults([]);
  };

  const removeCustomer = (id: number) => {
    onChange(selected.filter((s) => s.customerProfileId !== id));
  };

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs text-neutral-600">
        <UserCheck className="w-3.5 h-3.5 text-orange-500" />
        Allowed customers
        <span className="text-neutral-400 font-normal">(optional)</span>
      </Label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((c) => (
            <span key={c.customerProfileId} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-medium">
              {c.name} · {c.phone}
              <button type="button" onClick={() => removeCustomer(c.customerProfileId)} className="ml-0.5 text-orange-500 hover:text-orange-800">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
        <Input className="pl-8 h-10 text-sm" placeholder="Search by name or phone…" value={query} onChange={(e) => handleQueryChange(e.target.value)} />
        {searching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 animate-spin" />}
      </div>

      {results.length > 0 && (
        <div className="border border-neutral-200 rounded-xl shadow-sm bg-white max-h-40 overflow-y-auto divide-y divide-neutral-100">
          {results.map((c) => {
            const alreadyAdded = selected.some((s) => s.customerProfileId === c.customerProfileId);
            return (
              <button key={c.customerProfileId} type="button" disabled={alreadyAdded} onClick={() => addCustomer(c)}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between ${alreadyAdded ? "opacity-40 cursor-default" : "hover:bg-neutral-50"}`}>
                <span className="font-medium text-neutral-800">{c.name}</span>
                <span className="text-neutral-500 text-xs">{c.phone}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Edit Coupon Modal ─────────────────────────────────────────────────────────

function EditCouponModal({ coupon, onClose, onSaved }: { coupon: ManagerCoupon; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(coupon.name);
  const [value, setValue] = useState(String(parseFloat(coupon.value)));
  const [usageLimit, setUsageLimit] = useState(String(coupon.totalUsageLimit ?? ""));
  const [perUserLimit, setPerUserLimit] = useState("1");
  const [extendDays, setExtendDays] = useState("");
  const [reason, setReason] = useState("");
  const [targetCustomers, setTargetCustomers] = useState<CustomerResult[]>([]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof managerDiscountService.updateCoupon>[1] = {};
      if (name.trim() !== coupon.name) payload.name = name.trim();
      if (parseFloat(value) !== parseFloat(coupon.value)) payload.value = parseFloat(value);
      if (usageLimit !== "" && parseInt(usageLimit) !== coupon.totalUsageLimit) payload.usageLimit = parseInt(usageLimit);
      if (parseInt(perUserLimit) !== 1) payload.perUserLimit = parseInt(perUserLimit);
      if (extendDays !== "" && parseInt(extendDays) > 0) payload.extendDays = parseInt(extendDays);
      if (reason.trim().length >= 5) payload.reason = reason.trim();
      payload.targetCustomerIds = targetCustomers.map((c) => c.customerProfileId);
      return managerDiscountService.updateCoupon(coupon.publicId, payload);
    },
    onSuccess: () => { toast.success("Coupon updated."); onSaved(); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || "Failed to update coupon."); },
  });

  const currentUsage = coupon._count.usageLogs;
  const usageLimitNum = usageLimit !== "" ? parseInt(usageLimit) : null;
  const usageLimitError = usageLimitNum !== null && usageLimitNum < currentUsage ? `Cannot be below current usage (${currentUsage})` : null;
  const isValid = name.trim().length >= 1 && parseFloat(value) > 0 && !usageLimitError;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60 sticky top-0 z-10">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Edit Coupon</DialogTitle>
            <DialogDescription className="font-mono text-xs text-neutral-500">{coupon.code}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-4">
          {currentUsage > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
              This coupon has been used <strong>{currentUsage}</strong> time(s). Existing usage records are preserved.
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Coupon Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">
              Discount Value <span className="text-neutral-400 font-normal">({coupon.discountType === "PERCENTAGE" ? "%" : "₹"})</span>
            </Label>
            <div className="relative w-36">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
                {coupon.discountType === "PERCENTAGE" ? "%" : "₹"}
              </span>
              <Input type="number" min="0" step="0.01" className="pl-7 h-10" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Total usage limit</Label>
              <Input type="number" min={currentUsage || 1} max="100" className="h-10" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} placeholder={coupon.totalUsageLimit?.toString() ?? ""} />
              {usageLimitError && <p className="text-xs text-red-500">{usageLimitError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Uses per customer</Label>
              <Input type="number" min="1" max="10" className="h-10" value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Extend validity by (days)</Label>
            <Input type="number" min="1" max="90" className="h-10 w-44" value={extendDays} onChange={(e) => setExtendDays(e.target.value)} placeholder="e.g. 7" />
            <p className="text-xs text-neutral-400 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Currently expires: {format(new Date(coupon.endDate), "dd MMM yyyy")}
            </p>
          </div>

          <CustomerRestrictionPicker selected={targetCustomers} onChange={setTargetCustomers} />

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Reason for edit <span className="text-neutral-400 font-normal">(optional, min 5 chars)</span></Label>
            <Input className="h-10" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Extending for loyal customer" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 h-11" disabled={mutation.isPending}>Cancel</Button>
          <Button className="flex-1 h-11 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Coupon Modal ───────────────────────────────────────────────────────

function CreateCouponModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "FLAT">("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("");
  const [validityDays, setValidityDays] = useState("7");
  const [usageLimit, setUsageLimit] = useState("5");
  const [perUserLimit, setPerUserLimit] = useState("1");
  const [reason, setReason] = useState("");
  const [targetCustomers, setTargetCustomers] = useState<CustomerResult[]>([]);

  const mutation = useMutation({
    mutationFn: () =>
      managerDiscountService.createCoupon({
        name: name.trim(),
        discountType,
        value: parseFloat(discountValue),
        reason: reason.trim(),
        validityDays: parseInt(validityDays) || 7,
        usageLimit: parseInt(usageLimit) || 5,
        perUserLimit: parseInt(perUserLimit) || 1,
        targetCustomerIds: targetCustomers.map((c) => c.customerProfileId),
      }),
    onSuccess: () => { toast.success("Coupon created."); onCreated(); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || "Failed to create coupon."); },
  });

  const isValid = name.trim().length >= 1 && parseFloat(discountValue) > 0 && reason.trim().length >= 5;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60 sticky top-0 z-10">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Create Coupon</DialogTitle>
            <p className="text-xs text-neutral-500 mt-0.5">New discount coupon for this branch</p>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Coupon Name</Label>
            <Input className="h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Sale 2026" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Discount Type</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as "PERCENTAGE" | "FLAT")}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                  <SelectItem value="FLAT">Flat Amount (₹)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Value</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
                  {discountType === "PERCENTAGE" ? "%" : "₹"}
                </span>
                <Input type="number" min="0" step="0.01" className="pl-7 h-10" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Valid for (days)</Label>
              <Input type="number" min="1" max="90" className="h-10" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">Total usage limit</Label>
              <Input type="number" min="1" max="100" className="h-10" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Uses per customer</Label>
            <Input type="number" min="1" max="10" className="h-10 w-32" value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} />
            <p className="text-xs text-neutral-400">How many times a single customer can redeem this coupon.</p>
          </div>

          <CustomerRestrictionPicker selected={targetCustomers} onChange={setTargetCustomers} />

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Reason <span className="text-red-500">*</span></Label>
            <Input className="h-10" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Loyalty reward for returning customer" />
            {reason.length > 0 && reason.trim().length < 5 && (
              <p className="text-xs text-red-500">Reason must be at least 5 characters.</p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 h-11" disabled={mutation.isPending}>Cancel</Button>
          <Button className="flex-1 h-11 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create Coupon"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function CouponsTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ManagerCoupon | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ManagerCoupon | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["manager-coupons"],
    queryFn: () => managerDiscountService.getCoupons(),
  });

  const deactivateMutation = useMutation({
    mutationFn: (publicId: string) => managerDiscountService.deactivateCoupon(publicId),
    onSuccess: () => {
      toast.success("Coupon deactivated.");
      setDeactivateTarget(null);
      queryClient.invalidateQueries({ queryKey: ["manager-coupons"] });
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || "Failed to deactivate coupon."); },
  });

  const coupons: ManagerCoupon[] = data?.data ?? [];

  const discountLabel = (c: ManagerCoupon) =>
    c.discountType === "PERCENTAGE" ? `${parseFloat(c.value)}% off` : `${fmt(c.value)} flat`;

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Coupons</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Create and manage discount coupons for this branch</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="h-8 gap-1.5 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button className="h-8 bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-xs px-3" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Create Coupon
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-neutral-100">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-6 bg-neutral-100 rounded-md animate-pulse w-28" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-36 flex-1" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-16" />
                  <div className="h-5 bg-neutral-100 rounded-full animate-pulse w-16" />
                  <div className="h-7 bg-neutral-100 rounded-lg animate-pulse w-24" />
                </div>
              ))}
            </div>
          ) : coupons.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
                <Tag className="w-6 h-6 text-neutral-400" />
              </div>
              <p className="font-medium text-neutral-700">No coupons yet</p>
              <p className="text-sm text-neutral-400 mt-1">Create your first coupon to offer discounts.</p>
              <Button className="mt-4 bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4" /> Create Coupon
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/80">
                      {["Code", "Name", "Discount", "Used / Limit", "Expires", "Status", ""].map((h, i) => (
                        <th key={i} className="px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {coupons.map((c) => {
                      const exhausted = c.totalUsageLimit != null && c._count.usageLogs >= c.totalUsageLimit;
                      return (
                        <tr key={c.publicId} className="hover:bg-neutral-50/60 transition-colors">
                          <td className="px-5 py-3.5">
                            <span className="font-mono font-bold text-neutral-900 text-sm bg-neutral-100 px-2.5 py-1 rounded-md">
                              {c.code}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-neutral-700">{c.name}</td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5 text-sm text-neutral-700">
                              {c.discountType === "PERCENTAGE"
                                ? <BadgePercent className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                : <Banknote className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                              {discountLabel(c)}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-sm">
                            <span className={`font-semibold ${exhausted ? "text-red-600" : "text-neutral-800"}`}>{c._count.usageLogs}</span>
                            <span className="text-neutral-400"> / {c.totalUsageLimit ?? "∞"}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="flex items-center gap-1 text-xs text-neutral-500">
                              <Calendar className="w-3 h-3" />
                              {format(new Date(c.endDate), "dd MMM yyyy")}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            {c.isActive
                              ? <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">Active</Badge>
                              : <Badge variant="outline" className="border-neutral-300 text-neutral-500 text-xs">Inactive</Badge>}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs text-neutral-600 border-neutral-200 hover:bg-neutral-50 gap-1" onClick={() => setEditTarget(c)}>
                                <Pencil className="w-3 h-3" /> Edit
                              </Button>
                              {c.isActive && (
                                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1" onClick={() => setDeactivateTarget(c)}>
                                  <PowerOff className="w-3 h-3" /> Deactivate
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-neutral-100">
                {coupons.map((c) => {
                  const exhausted = c.totalUsageLimit != null && c._count.usageLogs >= c.totalUsageLimit;
                  return (
                    <div key={c.publicId} className="px-4 py-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-neutral-900 bg-neutral-100 px-2.5 py-1 rounded-md text-sm">{c.code}</span>
                        {c.isActive
                          ? <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">Active</Badge>
                          : <Badge variant="outline" className="border-neutral-300 text-neutral-500 text-xs">Inactive</Badge>}
                      </div>
                      <p className="text-sm text-neutral-700">{c.name}</p>
                      <div className="flex items-center justify-between text-xs text-neutral-500">
                        <span>{discountLabel(c)}</span>
                        <span className={exhausted ? "text-red-600 font-semibold" : ""}>{c._count.usageLogs} / {c.totalUsageLimit ?? "∞"} used</span>
                      </div>
                      <p className="text-xs text-neutral-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Expires {format(new Date(c.endDate), "dd MMM yyyy")}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1" onClick={() => setEditTarget(c)}>
                          <Pencil className="w-3 h-3" /> Edit
                        </Button>
                        {c.isActive && (
                          <Button size="sm" variant="outline" className="flex-1 h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1" onClick={() => setDeactivateTarget(c)}>
                            <PowerOff className="w-3 h-3" /> Deactivate
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {createOpen && (
        <CreateCouponModal onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); queryClient.invalidateQueries({ queryKey: ["manager-coupons"] }); }} />
      )}
      {editTarget && (
        <EditCouponModal coupon={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); queryClient.invalidateQueries({ queryKey: ["manager-coupons"] }); }} />
      )}
      {deactivateTarget && (
        <DeactivateDialog coupon={deactivateTarget} onClose={() => setDeactivateTarget(null)} onConfirm={() => deactivateMutation.mutate(deactivateTarget.publicId)} loading={deactivateMutation.isPending} />
      )}
    </>
  );
}
