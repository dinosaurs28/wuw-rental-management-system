import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Route,
  Clock,
  Fuel,
  CreditCard,
  ShieldCheck,
  Wrench,
  UserCog,
  Banknote,
  Save,
  Loader2,
  Settings2,
  AlertCircle,
  CheckCircle2,
  Layers,
} from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  chargeConfigService,
  type BranchChargeConfig,
} from "@/services/charge-config.service";
import { ChargeModuleToggle } from "@/components/charge-config/ChargeModuleToggle";

const DEFAULT_CONFIG: BranchChargeConfig = {
  extraKmEnabled: true,
  extraTimeEnabled: true,
  fuelModuleEnabled: false,
  fastagModuleEnabled: false,
  gracePolicyEnabled: false,
  damageModuleEnabled: true,
  graceType: "AUTOMATIC",
  graceMinutes: 15,
  employeeOverrideEnabled: false,
  maxOverridePercent: null,
  overrideRequiresApproval: false,
  overrideApprovalThreshold: null,
  safetyDepositEnabled: false,
  safetyDepositRequiresApproval: true,
  usePaymentSessions: false,
};

function ActiveModulesBar({ config }: { config: BranchChargeConfig }) {
  const active = [
    config.extraKmEnabled && "Extra KM",
    config.extraTimeEnabled && "Extra Time",
    config.fuelModuleEnabled && "Fuel",
    config.fastagModuleEnabled && "Fastag",
    config.gracePolicyEnabled && "Grace",
    config.damageModuleEnabled && "Damage",
    config.employeeOverrideEnabled && "Overrides",
    config.safetyDepositEnabled && "Safety Deposit",
    config.usePaymentSessions && "Unified Payments",
  ].filter(Boolean) as string[];

  return (
    <div className="bg-white rounded-lg border shadow-sm px-5 py-4 flex items-center gap-3 flex-wrap">
      <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
        Active modules
      </span>
      {active.length === 0 ? (
        <span className="text-xs text-neutral-400">None</span>
      ) : (
        active.map((m) => (
          <span
            key={m}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-50 text-orange-700 text-xs font-medium rounded-full border border-orange-200"
          >
            <CheckCircle2 className="w-3 h-3" />
            {m}
          </span>
        ))
      )}
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-neutral-800 uppercase tracking-wide">
        {title}
      </h2>
      <p className="text-xs text-neutral-400 mt-0.5">{description}</p>
    </div>
  );
}

export function ChargeConfigPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BranchChargeConfig>(DEFAULT_CONFIG);
  const [isDirty, setIsDirty] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["branch-charge-config"],
    queryFn: chargeConfigService.getConfig,
  });

  useEffect(() => {
    if (data?.data) {
      setForm(data.data);
      setIsDirty(false);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => chargeConfigService.upsertConfig(form),
    onSuccess: () => {
      toast.success("Charge configuration saved.");
      queryClient.invalidateQueries({ queryKey: ["branch-charge-config"] });
      setIsDirty(false);
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.message ?? "Failed to save configuration.",
      );
    },
  });

  const update = <K extends keyof BranchChargeConfig>(
    key: K,
    value: BranchChargeConfig[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  if (isLoading) {
    return (
      <ManagerLayout>
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-20 bg-white rounded-lg border animate-pulse"
            />
          ))}
        </div>
      </ManagerLayout>
    );
  }

  if (isError) {
    return (
      <ManagerLayout>
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
          <div className="bg-white rounded-lg border shadow-sm px-5 py-8 flex items-center gap-3 text-neutral-500">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span>Failed to load charge configuration. Please refresh.</span>
          </div>
        </div>
      </ManagerLayout>
    );
  }

  return (
    <ManagerLayout>
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Settings2 className="w-5 h-5 text-orange-500" />
              <h1 className="text-2xl font-bold text-neutral-900">
                Charge Settings
              </h1>
            </div>
            <p className="text-sm text-neutral-500">
              Configure which charge modules are active for this branch. Settings
              are frozen per booking at creation time.
            </p>
          </div>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 flex-shrink-0"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !isDirty}
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isDirty ? "Save Changes" : "Saved"}
          </Button>
        </div>

        {/* Active modules summary bar */}
        <ActiveModulesBar config={form} />

        {/* ── Section: Mileage & Time ─────────────────────────────────── */}
        <div>
          <SectionHeader
            title="Mileage & Time"
            description="Charges applied when customers exceed included distance or rental duration"
          />
          <div className="space-y-2">
            <ChargeModuleToggle
              icon={Route}
              iconColor="text-orange-600"
              iconBg="bg-orange-100"
              title="Extra Kilometre Charges"
              description="Charge customers per km over the included free-km limit"
              enabled={form.extraKmEnabled}
              onToggle={(v) => update("extraKmEnabled", v)}
            />
            <ChargeModuleToggle
              icon={Clock}
              iconColor="text-blue-600"
              iconBg="bg-blue-100"
              title="Extra Time Charges"
              description="Charge customers for hours beyond the booked rental period"
              enabled={form.extraTimeEnabled}
              onToggle={(v) => update("extraTimeEnabled", v)}
            />
          </div>
        </div>

        {/* ── Section: Fuel & Fastag ──────────────────────────────────── */}
        <div>
          <SectionHeader
            title="Fuel & Fastag"
            description="Track fuel consumption and highway toll charges"
          />
          <div className="space-y-2">
            <ChargeModuleToggle
              icon={Fuel}
              iconColor="text-amber-600"
              iconBg="bg-amber-100"
              title="Fuel Module"
              description="Record pickup & return fuel levels; charge for any deficit"
              enabled={form.fuelModuleEnabled}
              onToggle={(v) => update("fuelModuleEnabled", v)}
            />
            <ChargeModuleToggle
              icon={CreditCard}
              iconColor="text-green-600"
              iconBg="bg-green-100"
              title="Fastag Module"
              description="Allow employees to record and charge highway Fastag tolls"
              enabled={form.fastagModuleEnabled}
              onToggle={(v) => update("fastagModuleEnabled", v)}
            />
          </div>
        </div>

        {/* ── Section: Policies ───────────────────────────────────────── */}
        <div>
          <SectionHeader
            title="Policies"
            description="Grace periods and damage handling during returns"
          />
          <div className="space-y-2">
            <ChargeModuleToggle
              icon={ShieldCheck}
              iconColor="text-purple-600"
              iconBg="bg-purple-100"
              title="Grace Policy"
              description="Allow a configurable grace window before late-return charges apply"
              enabled={form.gracePolicyEnabled}
              onToggle={(v) => update("gracePolicyEnabled", v)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-neutral-600">Grace Type</Label>
                  <Select
                    value={form.graceType}
                    onValueChange={(v) =>
                      update("graceType", v as "AUTOMATIC" | "MANUAL")
                    }
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUTOMATIC">
                        Automatic — applies without employee action
                      </SelectItem>
                      <SelectItem value="MANUAL">
                        Manual — employee must trigger
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-neutral-600">
                    Grace Window (minutes)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="120"
                    className="h-9 text-sm"
                    value={form.graceMinutes}
                    onChange={(e) =>
                      update("graceMinutes", parseInt(e.target.value) || 0)
                    }
                  />
                  <p className="text-xs text-neutral-400">Maximum 120 minutes</p>
                </div>
              </div>
            </ChargeModuleToggle>

            <ChargeModuleToggle
              icon={Wrench}
              iconColor="text-red-600"
              iconBg="bg-red-100"
              title="Damage Module"
              description="Include approved damage report costs in final settlement"
              enabled={form.damageModuleEnabled}
              onToggle={(v) => update("damageModuleEnabled", v)}
            />
          </div>
        </div>

        {/* ── Section: Controls ───────────────────────────────────────── */}
        <div>
          <SectionHeader
            title="Controls"
            description="Employee override permissions and safety deposit collection"
          />
          <div className="space-y-2">
            <ChargeModuleToggle
              icon={UserCog}
              iconColor="text-indigo-600"
              iconBg="bg-indigo-100"
              title="Employee Charge Override"
              description="Allow employees to reduce or waive computed charges with a written reason"
              enabled={form.employeeOverrideEnabled}
              onToggle={(v) => update("employeeOverrideEnabled", v)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-neutral-600">
                    Max override (% of charge)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      className="h-9 text-sm pr-8"
                      placeholder="e.g. 50"
                      value={form.maxOverridePercent ?? ""}
                      onChange={(e) =>
                        update(
                          "maxOverridePercent",
                          e.target.value === ""
                            ? null
                            : parseFloat(e.target.value),
                        )
                      }
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">
                      %
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400">
                    Leave blank for no limit
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-neutral-600">
                    Manager approval above (₹)
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">
                      ₹
                    </span>
                    <Input
                      type="number"
                      min="0"
                      className="h-9 text-sm pl-7"
                      placeholder="e.g. 500"
                      value={form.overrideApprovalThreshold ?? ""}
                      onChange={(e) =>
                        update(
                          "overrideApprovalThreshold",
                          e.target.value === ""
                            ? null
                            : parseFloat(e.target.value),
                        )
                      }
                    />
                  </div>
                  <p className="text-xs text-neutral-400">
                    Leave blank to always auto-approve
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Checkbox
                  id="override-approval"
                  checked={form.overrideRequiresApproval}
                  onCheckedChange={(v) =>
                    update("overrideRequiresApproval", !!v)
                  }
                />
                <label
                  htmlFor="override-approval"
                  className="text-sm text-neutral-700 cursor-pointer"
                >
                  Overrides above threshold require manager approval
                </label>
              </div>
            </ChargeModuleToggle>

            <ChargeModuleToggle
              icon={Banknote}
              iconColor="text-teal-600"
              iconBg="bg-teal-100"
              title="Safety Deposit"
              description="Allow employees to request a refundable safety deposit at pickup"
              enabled={form.safetyDepositEnabled}
              onToggle={(v) => update("safetyDepositEnabled", v)}
            >
              <div className="flex items-center gap-3">
                <Checkbox
                  id="deposit-approval"
                  checked={form.safetyDepositRequiresApproval}
                  onCheckedChange={(v) =>
                    update("safetyDepositRequiresApproval", !!v)
                  }
                />
                <label
                  htmlFor="deposit-approval"
                  className="text-sm text-neutral-700 cursor-pointer"
                >
                  Safety deposit requests require manager approval before charging
                </label>
              </div>
            </ChargeModuleToggle>
          </div>
        </div>

        {/* ── Section: Payment Flow ───────────────────────────────────── */}
        <div>
          <SectionHeader
            title="Payment Flow"
            description="Control how payments are collected at pickup and return"
          />
          <div className="space-y-2">
            <ChargeModuleToggle
              icon={Layers}
              iconColor="text-violet-600"
              iconBg="bg-violet-100"
              title="Unified Payment Sessions"
              description="Consolidate all charges (advance balance, extensions, deposits, discounts) into a single payment at the end of pickup and return flows"
              enabled={form.usePaymentSessions}
              onToggle={(v) => update("usePaymentSessions", v)}
            />
          </div>
        </div>

        {/* Sticky save bar when dirty */}
        {isDirty && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 bg-neutral-900 text-white px-5 py-3 rounded-xl shadow-2xl border border-neutral-700">
              <span className="text-sm font-medium">Unsaved changes</span>
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white h-8 gap-1.5"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </ManagerLayout>
  );
}
