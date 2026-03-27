import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus,
  Tag,
  RefreshCw,
  Shuffle,
  Calendar,
  BadgePercent,
  Banknote,
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

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ── Create Coupon Modal ───────────────────────────────────────────────────────

function CreateCouponModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState(generateCode());
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "FLAT">("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("");
  const [maxCap, setMaxCap] = useState("");
  const [totalLimit, setTotalLimit] = useState("");
  const [perCustomer, setPerCustomer] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [minDays, setMinDays] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      managerDiscountService.createCoupon({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        discountType,
        discountValue: parseFloat(discountValue),
        ...(maxCap ? { maxDiscountCap: parseFloat(maxCap) } : {}),
        ...(totalLimit ? { totalUsageLimit: parseInt(totalLimit) } : {}),
        ...(perCustomer ? { perCustomerLimit: parseInt(perCustomer) } : {}),
        ...(validFrom ? { validFrom: new Date(validFrom).toISOString() } : {}),
        ...(validTo ? { validTo: new Date(validTo).toISOString() } : {}),
        ...(minAmount ? { minBookingAmount: parseFloat(minAmount) } : {}),
        ...(minDays ? { minRentalDays: parseInt(minDays) } : {}),
      }),
    onSuccess: () => {
      toast.success("Coupon created.");
      onCreated();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to create coupon.");
    },
  });

  const isValid =
    code.trim().length >= 3 &&
    name.trim().length >= 1 &&
    parseFloat(discountValue) > 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Coupon</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Code */}
          <div className="space-y-2">
            <Label>Coupon Code</Label>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono uppercase"
                placeholder="e.g. SUMMER25"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setCode(generateCode())}
                title="Auto-generate"
              >
                <Shuffle className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label>Name / Description</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Sale 2026" />
          </div>

          {/* Discount Type + Value */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Discount Type</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as "PERCENTAGE" | "FLAT")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                  <SelectItem value="FLAT">Flat Amount (₹)</SelectItem>
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

          {discountType === "PERCENTAGE" && (
            <div className="space-y-2">
              <Label>Max Discount Cap (optional)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                <Input
                  type="number"
                  min="0"
                  className="pl-7"
                  placeholder="No cap"
                  value={maxCap}
                  onChange={(e) => setMaxCap(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Limits */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Total Usage Limit</Label>
              <Input
                type="number"
                min="1"
                placeholder="Unlimited"
                value={totalLimit}
                onChange={(e) => setTotalLimit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Per-Customer Limit</Label>
              <Input
                type="number"
                min="1"
                placeholder="1"
                value={perCustomer}
                onChange={(e) => setPerCustomer(e.target.value)}
              />
            </div>
          </div>

          {/* Validity dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valid From</Label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Valid To</Label>
              <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
          </div>

          {/* Min constraints */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Min Booking Amount (optional)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                <Input
                  type="number"
                  min="0"
                  className="pl-7"
                  placeholder="None"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Min Rental Days (optional)</Label>
              <Input
                type="number"
                min="1"
                placeholder="None"
                value={minDays}
                onChange={(e) => setMinDays(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => mutation.mutate()}
            disabled={!isValid || mutation.isPending}
          >
            {mutation.isPending ? "Creating…" : "Create Coupon →"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function CouponsTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["manager-coupons"],
    queryFn: () => managerDiscountService.getCoupons(),
  });

  const coupons: ManagerCoupon[] = data?.data ?? [];

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Coupons</h2>
            <p className="text-sm text-neutral-500 mt-1">Create and manage discount coupons for this branch</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="h-9 px-3 text-neutral-600 border-neutral-200"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 h-9"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4" /> Create Coupon
            </Button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg border h-14 animate-pulse" />
            ))}
          </div>
        ) : coupons.length === 0 ? (
          <div className="bg-white rounded-lg border shadow-sm flex flex-col items-center py-16 text-center">
            <Tag className="w-12 h-12 text-neutral-200 mb-3" />
            <p className="font-medium text-neutral-600">No coupons yet</p>
            <p className="text-sm text-neutral-400 mt-1">Create your first coupon to offer discounts.</p>
            <Button
              className="mt-4 bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" /> Create Coupon
            </Button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-neutral-50">
                    <th className="text-left px-5 py-3 font-medium text-neutral-500">Code</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Discount</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Used / Limit</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Validity</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {coupons.map((c) => (
                    <tr key={c.publicId} className="hover:bg-neutral-50">
                      <td className="px-5 py-3.5">
                        <span className="font-mono font-semibold text-neutral-900 text-sm bg-neutral-100 px-2 py-0.5 rounded">
                          {c.code}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-neutral-700">{c.name}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {c.discountType === "PERCENTAGE" ? (
                            <BadgePercent className="w-3.5 h-3.5 text-blue-500" />
                          ) : (
                            <Banknote className="w-3.5 h-3.5 text-green-500" />
                          )}
                          <span>
                            {c.discountType === "PERCENTAGE"
                              ? `${parseFloat(c.discountValue)}% off`
                              : `${fmt(c.discountValue)} flat`}
                          </span>
                          {c.maxDiscountCap && (
                            <span className="text-xs text-neutral-400">
                              (cap: {fmt(c.maxDiscountCap)})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`font-medium ${c.totalUsageLimit && c.usageCount >= c.totalUsageLimit ? "text-red-600" : "text-neutral-700"}`}>
                          {c.usageCount}
                        </span>
                        <span className="text-neutral-400"> / {c.totalUsageLimit ?? "∞"}</span>
                      </td>
                      <td className="px-4 py-3.5 text-neutral-500">
                        {c.validTo ? (
                          <span className="flex items-center gap-1 text-xs">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(c.validTo), "dd MMM yyyy")}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">No expiry</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {c.isActive ? (
                          <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-neutral-300 text-neutral-500 text-xs">
                            Inactive
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-neutral-100">
              {coupons.map((c) => (
                <div key={c.publicId} className="px-4 py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded text-sm">
                      {c.code}
                    </span>
                    {c.isActive ? (
                      <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="border-neutral-300 text-neutral-500 text-xs">Inactive</Badge>
                    )}
                  </div>
                  <p className="text-sm text-neutral-700">{c.name}</p>
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>
                      {c.discountType === "PERCENTAGE"
                        ? `${parseFloat(c.discountValue)}% off`
                        : `${fmt(c.discountValue)} flat`}
                    </span>
                    <span>{c.usageCount} / {c.totalUsageLimit ?? "∞"} used</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {createOpen && (
        <CreateCouponModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ["manager-coupons"] });
          }}
        />
      )}
    </>
  );
}
