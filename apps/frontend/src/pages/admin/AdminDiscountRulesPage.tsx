import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus,
  Tag,
  RefreshCw,
  Shuffle,
  BadgePercent,
  Banknote,
  Globe,
  Building2,
  Eye,
  PowerOff,
  Pencil,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import {
  adminDiscountService,
  type AdminDiscountRule,
  type AdminManagerCoupon,
} from "@/services/discount.service";

const fmtAmt = (v: string | number) =>
  `₹ ${parseFloat(String(v)).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;

const fmtDate = (d: string) => format(new Date(d), "dd MMM yyyy");

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="border-neutral-300 text-neutral-500 text-xs">
      Inactive
    </Badge>
  );
}

function ScopeBadge({ scope }: { scope: "GLOBAL" | "BRANCH" }) {
  return scope === "GLOBAL" ? (
    <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
      <Globe className="w-3 h-3" /> Global
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
      <Building2 className="w-3 h-3" /> Branch
    </span>
  );
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

interface RuleFormProps {
  initial?: AdminDiscountRule;
  onClose: () => void;
  onSaved: () => void;
}

function RuleFormModal({ initial, onClose, onSaved }: RuleFormProps) {
  const isEdit = !!initial;

  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "FLAT">(
    initial?.discountType ?? "PERCENTAGE",
  );
  const [value, setValue] = useState(initial ? parseFloat(initial.value).toString() : "");
  const [maxCap, setMaxCap] = useState(
    initial?.maxDiscountCap ? parseFloat(initial.maxDiscountCap).toString() : "",
  );
  const [scope, setScope] = useState<"GLOBAL" | "BRANCH">(initial?.scope ?? "GLOBAL");
  const [startDate, setStartDate] = useState(
    initial ? initial.startDate.slice(0, 10) : "",
  );
  const [endDate, setEndDate] = useState(
    initial ? initial.endDate.slice(0, 10) : "",
  );
  const [totalLimit, setTotalLimit] = useState(
    initial?.totalUsageLimit?.toString() ?? "",
  );
  const [perUser, setPerUser] = useState(initial?.perUserLimit?.toString() ?? "");
  const [minAmount, setMinAmount] = useState(
    initial?.minBookingAmount ? parseFloat(initial.minBookingAmount).toString() : "",
  );
  const [minDays, setMinDays] = useState(initial?.minRentalDays?.toString() ?? "");
  const [stackable, setStackable] = useState(initial?.stackable ?? false);
  const [priority, setPriority] = useState(initial?.priority?.toString() ?? "0");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        return adminDiscountService.updateRule(initial!.publicId, {
          name: name.trim(),
          description: description.trim() || undefined,
          value: parseFloat(value),
          ...(discountType === "PERCENTAGE" && maxCap ? { maxDiscountCap: parseFloat(maxCap) } : {}),
          ...(maxCap === "" ? { maxDiscountCap: null } : {}),
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          ...(totalLimit ? { totalUsageLimit: parseInt(totalLimit) } : { totalUsageLimit: null }),
          ...(perUser ? { perUserLimit: parseInt(perUser) } : { perUserLimit: null }),
          ...(minAmount ? { minBookingAmount: parseFloat(minAmount) } : { minBookingAmount: null }),
          ...(minDays ? { minRentalDays: parseInt(minDays) } : { minRentalDays: null }),
          stackable,
          priority: parseInt(priority) || 0,
        });
      } else {
        return adminDiscountService.createRule({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          discountType,
          value: parseFloat(value),
          ...(discountType === "PERCENTAGE" && maxCap ? { maxDiscountCap: parseFloat(maxCap) } : {}),
          scope,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          ...(totalLimit ? { totalUsageLimit: parseInt(totalLimit) } : {}),
          ...(perUser ? { perUserLimit: parseInt(perUser) } : {}),
          ...(minAmount ? { minBookingAmount: parseFloat(minAmount) } : {}),
          ...(minDays ? { minRentalDays: parseInt(minDays) } : {}),
          stackable,
          priority: parseInt(priority) || 0,
        });
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Rule updated." : "Discount rule created.");
      onSaved();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to save discount rule.");
    },
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await adminDiscountService.generateCode();
      setCode(res.data.code);
    } catch {
      // fallback to local random
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      setCode(Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""));
    } finally {
      setGenerating(false);
    }
  };

  const isValid =
    (isEdit || code.trim().length >= 3) &&
    name.trim().length >= 1 &&
    parseFloat(value) > 0 &&
    startDate &&
    endDate;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Discount Rule" : "Create Discount Rule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Code — only on create */}
          {!isEdit && (
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
                  onClick={handleGenerate}
                  disabled={generating}
                  title="Auto-generate"
                >
                  <Shuffle className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {isEdit && (
            <div className="flex items-center gap-2 px-3 py-2 bg-neutral-50 rounded border text-sm font-mono text-neutral-700">
              <Tag className="w-3.5 h-3.5 text-neutral-400" />
              {initial!.code}
              <span className="ml-auto text-xs text-neutral-400">Code cannot be changed</span>
            </div>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Sale 2026"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Internal note"
            />
          </div>

          {/* Discount type + value */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Discount Type</Label>
                <Select
                  value={discountType}
                  onValueChange={(v) => setDiscountType(v as "PERCENTAGE" | "FLAT")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {isEdit && (
            <div className="space-y-2">
              <Label>
                Value ({initial!.discountType === "PERCENTAGE" ? "%" : "₹"})
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
                  {initial!.discountType === "PERCENTAGE" ? "%" : "₹"}
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="pl-7"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            </div>
          )}

          {(isEdit ? initial!.discountType === "PERCENTAGE" : discountType === "PERCENTAGE") && (
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

          {/* Scope — only on create */}
          {!isEdit && (
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as "GLOBAL" | "BRANCH")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOBAL">Global (all branches)</SelectItem>
                  <SelectItem value="BRANCH">Branch-specific</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valid From</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Valid To</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700"
            onClick={() => setShowAdvanced((p) => !p)}
          >
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Advanced settings
          </button>

          {showAdvanced && (
            <div className="space-y-4 border-t pt-4">
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
                    placeholder="Unlimited"
                    value={perUser}
                    onChange={(e) => setPerUser(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Min Booking Amount (₹)</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="None"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Min Rental Days</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="None"
                    value={minDays}
                    onChange={(e) => setMinDays(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Stackable with duration</Label>
                  <Select
                    value={stackable ? "yes" : "no"}
                    onValueChange={(v) => setStackable(v === "yes")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => mutation.mutate()}
            disabled={!isValid || mutation.isPending}
          >
            {mutation.isPending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save Changes"
                : "Create Rule →"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Deactivate confirm ────────────────────────────────────────────────────────

function DeactivateDialog({
  rule,
  onClose,
  onDeactivated,
}: {
  rule: AdminDiscountRule;
  onClose: () => void;
  onDeactivated: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => adminDiscountService.deactivateRule(rule.publicId),
    onSuccess: () => {
      toast.success(`Rule "${rule.code}" deactivated.`);
      onDeactivated();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to deactivate.");
    },
  });

  return (
    <AlertDialog open onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate "{rule.code}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This rule will stop applying to new bookings immediately. This
            cannot be undone from the UI.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Deactivating…" : "Deactivate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Discount Rules Tab ────────────────────────────────────────────────────────

function DiscountRulesTab() {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"ALL" | "GLOBAL" | "BRANCH">("ALL");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "active" | "inactive">("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [editRule, setEditRule] = useState<AdminDiscountRule | null>(null);
  const [deactivateRule, setDeactivateRule] = useState<AdminDiscountRule | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-discount-rules", search, scopeFilter, activeFilter],
    queryFn: () =>
      adminDiscountService.listRules({
        ...(search ? { search } : {}),
        ...(scopeFilter !== "ALL" ? { scope: scopeFilter } : {}),
        ...(activeFilter !== "ALL" ? { isActive: activeFilter === "active" } : {}),
        pageSize: 50,
      }),
    placeholderData: (prev) => prev,
  });

  const rules: AdminDiscountRule[] = data?.data?.rules ?? [];
  const total = data?.data?.total ?? 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-discount-rules"] });
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Input
            className="h-9 w-52 text-sm"
            placeholder="Search code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as any)}>
            <SelectTrigger className="h-9 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All scopes</SelectItem>
              <SelectItem value="GLOBAL">Global</SelectItem>
              <SelectItem value="BRANCH">Branch</SelectItem>
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as any)}>
            <SelectTrigger className="h-9 w-32 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 text-neutral-500"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 h-9"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-4 h-4" /> Create Rule
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg border h-12 animate-pulse" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm flex flex-col items-center py-16 text-center">
          <Tag className="w-10 h-10 text-neutral-200 mb-3" />
          <p className="font-medium text-neutral-600">No discount rules found</p>
          <p className="text-sm text-neutral-400 mt-1">
            Create your first global or branch-specific discount rule.
          </p>
          <Button
            className="mt-4 bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-4 h-4 mr-1.5" /> Create Rule
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-neutral-50 text-xs text-neutral-500 font-medium">
            {total} rule{total !== 1 ? "s" : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-neutral-50">
                  <th className="text-left px-5 py-3 font-medium text-neutral-500">Code</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Discount</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Scope</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Uses</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Validity</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rules.map((r) => (
                  <tr key={r.publicId} className="hover:bg-neutral-50">
                    <td className="px-5 py-3.5">
                      <span className="font-mono font-semibold text-neutral-900 text-sm bg-neutral-100 px-2 py-0.5 rounded">
                        {r.code}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-neutral-800 font-medium leading-tight">{r.name}</div>
                      {r.description && (
                        <div className="text-xs text-neutral-400 mt-0.5 truncate max-w-[180px]">
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {r.discountType === "PERCENTAGE" ? (
                          <BadgePercent className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        ) : (
                          <Banknote className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        )}
                        <span>
                          {r.discountType === "PERCENTAGE"
                            ? `${parseFloat(r.value)}% off`
                            : `${fmtAmt(r.value)} flat`}
                        </span>
                      </div>
                      {r.maxDiscountCap && (
                        <div className="text-xs text-neutral-400 mt-0.5">
                          cap: {fmtAmt(r.maxDiscountCap)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <ScopeBadge scope={r.scope} />
                    </td>
                    <td className="px-4 py-3.5 text-neutral-700">
                      <span className="font-medium">{r._count.usageLogs}</span>
                      {r.totalUsageLimit && (
                        <span className="text-neutral-400"> / {r.totalUsageLimit}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-neutral-500 whitespace-nowrap">
                      <div>{fmtDate(r.startDate)}</div>
                      <div className="text-neutral-400">→ {fmtDate(r.endDate)}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge active={r.isActive} />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-neutral-400 hover:text-neutral-700"
                          title="Edit"
                          onClick={() => setEditRule(r)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {r.isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-neutral-400 hover:text-red-600"
                            title="Deactivate"
                            onClick={() => setDeactivateRule(r)}
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {rules.map((r) => (
          <div key={r.publicId} className="bg-white rounded-lg border shadow-sm px-4 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded text-sm">
                {r.code}
              </span>
              <StatusBadge active={r.isActive} />
            </div>
            <p className="text-sm font-medium text-neutral-800">{r.name}</p>
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <ScopeBadge scope={r.scope} />
              <span>
                {r.discountType === "PERCENTAGE"
                  ? `${parseFloat(r.value)}% off`
                  : `${fmtAmt(r.value)} flat`}
              </span>
              <span>{r._count.usageLogs} uses</span>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-7 text-xs gap-1"
                onClick={() => setEditRule(r)}
              >
                <Pencil className="w-3 h-3" /> Edit
              </Button>
              {r.isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => setDeactivateRule(r)}
                >
                  <PowerOff className="w-3 h-3" /> Deactivate
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {createOpen && (
        <RuleFormModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      )}
      {editRule && (
        <RuleFormModal
          initial={editRule}
          onClose={() => setEditRule(null)}
          onSaved={() => {
            setEditRule(null);
            invalidate();
          }}
        />
      )}
      {deactivateRule && (
        <DeactivateDialog
          rule={deactivateRule}
          onClose={() => setDeactivateRule(null)}
          onDeactivated={() => {
            setDeactivateRule(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ── Manager Coupons Tab ───────────────────────────────────────────────────────

function ManagerCouponsTab() {
  const [activeFilter, setActiveFilter] = useState<"ALL" | "active" | "inactive">("ALL");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-manager-coupons", activeFilter],
    queryFn: () =>
      adminDiscountService.listManagerCoupons({
        ...(activeFilter !== "ALL" ? { isActive: activeFilter === "active" } : {}),
        pageSize: 50,
      }),
    placeholderData: (prev) => prev,
  });

  const coupons: AdminManagerCoupon[] = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as any)}>
            <SelectTrigger className="h-9 w-32 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 text-neutral-500"
          onClick={() => refetch()}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <Eye className="w-4 h-4 flex-shrink-0" />
        Read-only view. These coupons were created by branch managers within admin-configured guardrails.
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-lg border h-12 animate-pulse" />
          ))}
        </div>
      ) : coupons.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm flex flex-col items-center py-12 text-center">
          <Tag className="w-10 h-10 text-neutral-200 mb-3" />
          <p className="text-neutral-500 text-sm">No manager-created coupons found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-neutral-50 text-xs text-neutral-500 font-medium">
            {total} coupon{total !== 1 ? "s" : ""} created by managers
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-neutral-50">
                  <th className="text-left px-5 py-3 font-medium text-neutral-500">Code</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Discount</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Created By</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Uses / Limit</th>
                  <th className="text-left px-4 py-3 font-medium text-neutral-500">Expires</th>
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
                            ? `${parseFloat(c.value)}% off`
                            : `${fmtAmt(c.value)} flat`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-neutral-800 text-sm">{c.createdBy.name}</div>
                      <div className="text-xs text-neutral-400 capitalize">{c.createdBy.role.toLowerCase()}</div>
                    </td>
                    <td className="px-4 py-3.5 text-neutral-700">
                      <span className="font-medium">{c._count.usageLogs}</span>
                      {c.totalUsageLimit && (
                        <span className="text-neutral-400"> / {c.totalUsageLimit}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-neutral-500">
                      {fmtDate(c.endDate)}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge active={c.isActive} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminDiscountRulesPage() {
  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8">
      {/* Header */}
      <div className="mb-8">
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Discount Rules</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Discount Rules</h1>
        <p className="text-neutral-500 mt-2 text-lg">
          Manage global and branch-scoped coupon rules. Monitor manager-created coupons.
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rules">
        <TabsList className="mb-6">
          <TabsTrigger value="rules">Discount Rules</TabsTrigger>
          <TabsTrigger value="manager-coupons">Manager Coupons</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <DiscountRulesTab />
        </TabsContent>

        <TabsContent value="manager-coupons">
          <ManagerCouponsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
