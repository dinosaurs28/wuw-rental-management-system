import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Ban, Car, Info, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/counterErrors";
import { formatRupees } from "@/lib/counterPayment";
import { formatIstDateTime } from "@/utils/overdueReturns";
import {
  manualCancelService,
  type ManualCancelOptions,
  type ManualCancelRefundMethod,
  type ManualCancelResult,
  type ManualCancelVehicleLocation,
  type ManualCancelVehicleStatus,
} from "@/services/manualCancel.service";

interface CancelRentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingPublicId: string;
  /** After the rent is cancelled — refresh the lists. */
  onCancelled?: (result: ManualCancelResult) => void;
}

const VEHICLE_STATUS_LABELS: Record<ManualCancelVehicleStatus, string> = {
  AVAILABLE: "Available",
  MAINTENANCE: "Maintenance",
  INACTIVE: "Inactive",
  OUT_FOR_RENTAL: "Out For Rental",
};

/** Where the car is — older servers don't send their labels. */
const VEHICLE_LOCATIONS: { value: ManualCancelVehicleLocation; label: string }[] = [
  { value: "AT_BRANCH", label: "The vehicle is back at the branch" },
  { value: "OUT_OF_BRANCH", label: "The vehicle is out of the branch" },
];

const OUT_OF_BRANCH_HINT = "The car isn't at the branch, so it can't be bookable.";

const toNumber = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Branch Manager: cancel an upcoming or active rent by hand (Fleet tab). Shows
 * the rent and its money, takes the reason (sent to the customer) and the refund
 * paid back now (₹0 for none); an active rent also needs the car confirmed back
 * at the branch and its new status. The rent is kept as Cancelled.
 */
export function CancelRentDialog({ open, onOpenChange, bookingPublicId, onCancelled }: CancelRentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4 text-red-600" />
            Cancel rent
          </DialogTitle>
          <DialogDescription>
            The rent is marked Cancelled and kept in the history. The customer can book again right away.
          </DialogDescription>
        </DialogHeader>
        {/* Rendered only while open, so each opening reads the rent afresh */}
        {open && (
          <CancelRentBody
            bookingPublicId={bookingPublicId}
            onClose={() => onOpenChange(false)}
            onCancelled={onCancelled}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelRentBody({
  bookingPublicId,
  onClose,
  onCancelled,
}: {
  bookingPublicId: string;
  onClose: () => void;
  onCancelled?: (result: ManualCancelResult) => void;
}) {
  const query = useQuery({
    queryKey: ["manual-cancel-options", bookingPublicId],
    queryFn: () => manualCancelService.getOptions(bookingPublicId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const options = query.data;

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" />
        Loading the rent…
      </div>
    );
  }
  if (query.isError || !options) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{apiErrorMessage(query.error, "Couldn't load this rent. Please try again.")}</Notice>
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
  if (!options.cancellable || !options.stage) {
    return (
      <div className="space-y-4">
        <RentSummary options={options} />
        <Notice tone="warning">{options.blockedReason ?? "This rent can't be cancelled right now."}</Notice>
        <Button variant="outline" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  return (
    <CancelRentForm
      options={options}
      stage={options.stage}
      bookingPublicId={bookingPublicId}
      onClose={onClose}
      onCancelled={onCancelled}
      refetch={() => void query.refetch()}
    />
  );
}

function CancelRentForm({
  options,
  stage,
  bookingPublicId,
  onClose,
  onCancelled,
  refetch,
}: {
  options: ManualCancelOptions;
  stage: "UPCOMING" | "ACTIVE";
  bookingPublicId: string;
  onClose: () => void;
  onCancelled?: (result: ManualCancelResult) => void;
  refetch: () => void;
}) {
  const refundable = toNumber(options.money.refundable);
  const onlineRefundable = toNumber(options.money.onlineRefundable);
  const active = stage === "ACTIVE";
  const singleVehicle = options.vehicles.length === 1 ? options.vehicles[0] : null;

  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(refundable.toFixed(2));
  const [method, setMethod] = useState<ManualCancelRefundMethod | "">("");
  const [note, setNote] = useState("");
  const [vehicleLocation, setVehicleLocation] = useState<ManualCancelVehicleLocation | "">("");
  const [vehicleStatus, setVehicleStatus] = useState<ManualCancelVehicleStatus | "">("");
  const [odometer, setOdometer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountTrimmed = amount.trim();
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amountTrimmed);
  const amountNum = amountValid ? toNumber(amountTrimmed) : NaN;
  const refunding = amountValid && amountNum > 0;

  const atBranch = vehicleLocation === "AT_BRANCH";
  const outOfBranch = vehicleLocation === "OUT_OF_BRANCH";

  const problem = (() => {
    if (reason.trim().length < options.limits.reasonMin) {
      return `Enter the reason (at least ${options.limits.reasonMin} characters).`;
    }
    if (!amountValid) return "Enter the refund amount (₹0 for no refund), with at most 2 decimals.";
    if (amountNum > refundable + 0.0001) return `The refund can be at most ${formatRupees(refundable)}.`;
    if (refunding && !method) return "Choose how the refund is paid back.";
    if (refunding && method === "CASH" && !options.cashShiftOpen) {
      return "Open a cash shift to refund cash, or choose UPI or bank transfer.";
    }
    if (refunding && method === "ORIGINAL_PAYMENT" && amountNum > onlineRefundable + 0.0001) {
      return onlineRefundable > 0
        ? `Only ${formatRupees(onlineRefundable)} was paid online through Razorpay. Refund the rest by cash, UPI or bank transfer.`
        : "Nothing on this booking was paid online through Razorpay. Refund by cash, UPI or bank transfer.";
    }
    if (active && !vehicleLocation) return "Say where the vehicle is: back at the branch or out of the branch.";
    if (active && !vehicleStatus) return "Choose the vehicle's status.";
    if (active && outOfBranch && vehicleStatus === "AVAILABLE") return OUT_OF_BRANCH_HINT;
    if (active && atBranch && odometer.trim()) {
      const n = Number(odometer.trim());
      if (!Number.isInteger(n) || n < 0) return "The odometer reading must be a whole number of km.";
      if (singleVehicle && n < singleVehicle.odo) {
        return `The odometer reading can't be less than the last reading (${singleVehicle.odo} km).`;
      }
    }
    return null;
  })();

  const submit = async () => {
    if (problem || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await manualCancelService.cancel(bookingPublicId, {
        reason: reason.trim(),
        refund: {
          amount: amountNum,
          ...(refunding && method ? { method } : {}),
          ...(refunding && note.trim() ? { note: note.trim() } : {}),
        },
        ...(active
          ? {
              vehicleLocation: vehicleLocation as ManualCancelVehicleLocation,
              vehicleStatus: vehicleStatus as ManualCancelVehicleStatus,
              ...(atBranch && singleVehicle && odometer.trim() ? { odometer: Number(odometer.trim()) } : {}),
            }
          : {}),
      });
      // A car whose status was left alone (another rental / damage review) is named in the message
      if (res.data.vehicleNote) toast.warning(res.message, { duration: 10000 });
      else toast.success(res.message || "Rent cancelled.");
      onCancelled?.(res.data);
      onClose();
    } catch (err) {
      // The server re-checks everything (money, state) — show why and re-read the rent
      setError(apiErrorMessage(err, "Couldn't cancel the rent. Please try again."));
      refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const creditPending = toNumber(options.creditPending);
  const refunded = toNumber(options.money.refunded);
  const licenceHeld = options.dlStatus === "COLLECTED";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <RentSummary options={options} />

        {/* Money on the rent */}
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 text-sm">
          <MoneyRow label="Paid" value={formatRupees(toNumber(options.money.paid))} />
          {refunded > 0 && <MoneyRow label="Already refunded / committed" value={`− ${formatRupees(refunded)}`} />}
          <MoneyRow label="Can be refunded" value={formatRupees(refundable)} strong />
        </div>

        {/* What else the cancel does — from this rent's own data */}
        {(creditPending > 0 ||
          options.couponCode ||
          options.openPaymentSessions > 0 ||
          options.openExtensions > 0 ||
          licenceHeld) && (
          <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            {creditPending > 0 && (
              <li>{formatRupees(creditPending)} on counter credit is written off — nothing is owed on a cancelled rent.</li>
            )}
            {options.couponCode && <li>Coupon {options.couponCode} can be used again by the customer.</li>}
            {options.openPaymentSessions > 0 && <li>The open counter payment on this rent is dropped.</li>}
            {options.openExtensions > 0 && <li>The pending extension on this rent is cancelled.</li>}
            {licenceHeld && <li>Hand the customer's original driving licence back.</li>}
          </ul>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">
            Reason <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            maxLength={options.limits.reasonMax}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer called to cancel the trip"
            className="min-h-[72px] text-sm"
          />
          <p className="flex justify-between text-[11px] text-zinc-400">
            <span>Sent to the customer with the cancellation notice.</span>
            <span>
              {reason.length}/{options.limits.reasonMax}
            </span>
          </p>
        </div>

        {/* Refund paid back now */}
        <div className="space-y-3 rounded-xl border border-zinc-200 px-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-refund-amount">Refund to the customer</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">₹</span>
              <Input
                id="cancel-refund-amount"
                type="number"
                inputMode="decimal"
                min="0"
                max={refundable.toFixed(2)}
                step="0.01"
                className="h-10 pl-7"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-zinc-400">
              Up to {formatRupees(refundable)}. Enter 0 for no refund.
            </p>
          </div>

          {refunding && (
            <>
              <div className="space-y-1.5">
                <Label>
                  Refund method <span className="text-red-500">*</span>
                </Label>
                <Select value={method} onValueChange={(v) => setMethod(v as ManualCancelRefundMethod)}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="How is it paid back?" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.refundMethods.map((m) => (
                      <SelectItem
                        key={m.value}
                        value={m.value}
                        disabled={
                          (m.value === "CASH" && !options.cashShiftOpen) ||
                          (m.value === "ORIGINAL_PAYMENT" && onlineRefundable <= 0)
                        }
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-zinc-400">
                  {method === "ORIGINAL_PAYMENT"
                    ? `Up to ${formatRupees(onlineRefundable)} (paid through Razorpay). Saved as an approved refund — refund it in Razorpay, then complete it in Payments → Refunds with the Razorpay refund id.`
                    : method
                      ? "Recorded as paid back now, in Transactions and the reports."
                      : !options.cashShiftOpen
                        ? "Cash needs your open cash shift — open one first, or use UPI or bank transfer."
                        : "Cash, UPI and bank transfer are recorded as paid back now."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cancel-refund-note">Refund note (optional)</Label>
                <Input
                  id="cancel-refund-note"
                  value={note}
                  maxLength={options.limits.noteMax}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. UPI reference or account"
                  className="h-10"
                />
              </div>
            </>
          )}
        </div>

        {/* Active rent: where the car is, and what it becomes */}
        {active && (
          <div className="space-y-3 rounded-xl border border-zinc-200 px-4 py-3">
            <div className="space-y-1.5">
              <Label>
                Where is the vehicle? <span className="text-red-500">*</span>
              </Label>
              <div className="grid gap-2" role="radiogroup" aria-label="Where is the vehicle">
                {(options.vehicleLocations ?? VEHICLE_LOCATIONS).map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    role="radio"
                    aria-checked={vehicleLocation === l.value}
                    onClick={() => {
                      setVehicleLocation(l.value);
                      if (l.value === "OUT_OF_BRANCH") {
                        setOdometer("");
                        if (vehicleStatus === "AVAILABLE") setVehicleStatus("");
                      }
                    }}
                    className={cn(
                      "min-h-10 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors",
                      vehicleLocation === l.value
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>
                Vehicle status after cancelling <span className="text-red-500">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Vehicle status">
                {options.vehicleStatuses.map((s) => {
                  const blocked = outOfBranch && s === "AVAILABLE";
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={vehicleStatus === s}
                      disabled={blocked}
                      title={blocked ? OUT_OF_BRANCH_HINT : undefined}
                      onClick={() => setVehicleStatus(s)}
                      className={cn(
                        "h-10 rounded-lg border text-sm font-medium transition-colors",
                        vehicleStatus === s
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200",
                      )}
                    >
                      {VEHICLE_STATUS_LABELS[s]}
                    </button>
                  );
                })}
              </div>
              {outOfBranch && <p className="text-[11px] text-zinc-500">{OUT_OF_BRANCH_HINT}</p>}
            </div>
            {atBranch && singleVehicle && (
              <div className="space-y-1.5">
                <Label htmlFor="cancel-odometer">Odometer (km, optional)</Label>
                <Input
                  id="cancel-odometer"
                  type="number"
                  inputMode="numeric"
                  min={singleVehicle.odo}
                  step="1"
                  className="h-10"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  placeholder={`Last reading ${singleVehicle.odo} km`}
                />
              </div>
            )}
          </div>
        )}

        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <div className="space-y-2">
        {problem && !error && <p className="text-xs text-zinc-500">{problem}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
            Keep rent
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => void submit()}
            disabled={!!problem || submitting}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : "Cancel rent"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RentSummary({ options }: { options: ManualCancelOptions }) {
  const vehicles = options.vehicles.map((v) => `${v.make} ${v.model} (${v.regNo})`).join(", ") || "—";
  return (
    <div className="space-y-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-zinc-900">
          <Car className="size-3.5 shrink-0 text-zinc-400" />
          {vehicles}
        </p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            options.stage === "ACTIVE" ? "bg-blue-50 text-blue-700" : "bg-zinc-100 text-zinc-600",
          )}
        >
          {options.stage === "ACTIVE" ? "Active rent" : options.stage === "UPCOMING" ? "Upcoming rent" : options.status}
        </span>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-zinc-600">
        <User className="size-3 shrink-0 text-zinc-400" />
        {options.customer.name}
        {options.customer.phone ? ` · ${options.customer.phone}` : ""}
      </p>
      <p className="text-xs text-zinc-500">
        Pickup {formatIstDateTime(options.startAt)} · Return {formatIstDateTime(options.endAt)}
      </p>
      <p className="font-mono text-[11px] text-zinc-400">
        #{options.bookingPublicId.slice(-6).toUpperCase()} · Total {formatRupees(toNumber(options.totalFinal))}
      </p>
    </div>
  );
}

function MoneyRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className={strong ? "font-semibold text-zinc-900" : "text-zinc-600"}>{label}</span>
      <span className={cn("tabular-nums", strong ? "font-semibold text-zinc-900" : "text-zinc-700")}>{value}</span>
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
      {tone === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}
