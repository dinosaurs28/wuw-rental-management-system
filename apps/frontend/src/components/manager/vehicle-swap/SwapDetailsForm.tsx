import React, { useState } from "react";
import type {
  AvailableVehicle,
  SwapContext,
  VehicleSwapRequest,
} from "@/types/vehicleSwap";
import { SwapReason, DEFAULT_CHARGE_DIFFERENCE } from "@/types/vehicleSwap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Gauge, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SWAP_FUEL_BAR_OPTIONS,
  formatKm,
  formatSwapRupees,
  parseOdometer,
  swapAmount,
} from "./swapFormat";

/** Everything the swap request needs except the chosen car. */
export type SwapDetailsData = Omit<VehicleSwapRequest, "newVehicleId">;

interface SwapDetailsFormProps {
  newVehicle: AvailableVehicle;
  /** Reg no of the car being swapped out (labels the readings) */
  currentVehicleRegNo?: string;
  /**
   * From GET …/available-vehicles. Drives the readings (ACTIVE_RENTAL) and the
   * "Charge customer" defaults; null = pre-pickup screen without the context.
   */
  swapContext?: SwapContext | null;
  isSubmitting?: boolean;
  /** Server refusal shown above the buttons */
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (data: SwapDetailsData) => void;
  cancelLabel?: string;
  submitLabel?: string;
}

const REASON_OPTIONS = [
  { value: SwapReason.CUSTOMER_REQUEST, label: "Customer Request" },
  { value: SwapReason.MAINTENANCE, label: "Maintenance Required" },
  { value: SwapReason.UPGRADE, label: "Vehicle Upgrade" },
  { value: SwapReason.DOWNGRADE, label: "Vehicle Downgrade" },
  { value: SwapReason.DAMAGE, label: "Vehicle Damage" },
  { value: SwapReason.OTHER, label: "Other" },
];

/**
 * Reason, handover readings (mid-rental), price difference + "Charge customer",
 * and the maintenance flag for a vehicle swap. Used by the swap confirmation
 * modal (pickup screen, BM swap page) and the Fleet active-rental swap dialog.
 */
export const SwapDetailsForm: React.FC<SwapDetailsFormProps> = ({
  newVehicle,
  currentVehicleRegNo,
  swapContext,
  isSubmitting = false,
  errorMessage,
  onCancel,
  onSubmit,
  cancelLabel = "Cancel",
  submitLabel = "Confirm Swap",
}) => {
  const readingsRequired = swapContext?.readingsRequired === true;
  const chargeDefaults = swapContext?.chargeDifferenceDefaults ?? DEFAULT_CHARGE_DIFFERENCE;
  const segmentStart = swapContext?.currentVehicleStartOdometer ?? null;

  const [reason, setReason] = useState<SwapReason | "">("");
  const [reasonNotes, setReasonNotes] = useState("");
  const [chargeDifference, setChargeDifference] = useState(false);
  const [markOriginalForMaintenance, setMarkOriginalForMaintenance] = useState(false);
  const [originalVehicleNotes, setOriginalVehicleNotes] = useState("");
  // Handover readings (ACTIVE_RENTAL only)
  const [originalEndOdo, setOriginalEndOdo] = useState("");
  const [originalFuel, setOriginalFuel] = useState("");
  const [newStartOdo, setNewStartOdo] = useState(
    typeof newVehicle.odo === "number" ? String(newVehicle.odo) : "",
  );
  const [newFuel, setNewFuel] = useState("");
  const [attempted, setAttempted] = useState(false);

  // undefined = the list didn't carry prices (older server) → nothing shown, nothing billed
  const priceKnown = newVehicle.priceDifference !== undefined;
  const difference = swapAmount(newVehicle.priceDifference);
  const chargeable = difference !== null && difference > 0;
  const remainingPct = swapContext
    ? Math.round((swapAmount(swapContext.remainingFraction) ?? 0) * 100)
    : null;

  // ── Reading validation ─────────────────────────────────────────────────────
  const originalEndValue = parseOdometer(originalEndOdo);
  const newStartValue = parseOdometer(newStartOdo);
  const readingErrors: Partial<Record<"originalEndOdo" | "originalFuel" | "newStartOdo" | "newFuel", string>> = {};
  if (readingsRequired) {
    if (originalEndOdo.trim() === "") readingErrors.originalEndOdo = "Enter the odometer reading";
    else if (originalEndValue === null) readingErrors.originalEndOdo = "Enter a valid odometer reading";
    else if (segmentStart !== null && originalEndValue < segmentStart)
      readingErrors.originalEndOdo = `Can't be below ${formatKm(segmentStart)}, its reading when the customer took it`;
    if (!originalFuel) readingErrors.originalFuel = "Select the fuel level";
    if (newStartOdo.trim() === "") readingErrors.newStartOdo = "Enter the odometer reading";
    else if (newStartValue === null) readingErrors.newStartOdo = "Enter a valid odometer reading";
    else if (typeof newVehicle.odo === "number" && newStartValue < newVehicle.odo)
      readingErrors.newStartOdo = `Can't be below ${formatKm(newVehicle.odo)}, its last recorded reading`;
    if (!newFuel) readingErrors.newFuel = "Select the fuel level";
  }
  const showError = (field: keyof typeof readingErrors, typed: string) =>
    attempted || (typed !== "" && field in readingErrors) ? readingErrors[field] : undefined;

  const maintenanceNotesMissing = markOriginalForMaintenance && !originalVehicleNotes.trim();
  const canSubmit =
    !!reason &&
    !isSubmitting &&
    !maintenanceNotesMissing &&
    Object.keys(readingErrors).length === 0;

  const handleReasonChange = (value: string) => {
    const next = value as SwapReason;
    setReason(next);
    // Re-default "Charge customer" for the new reason
    setChargeDifference(chargeDefaults[next] ?? false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!canSubmit || !reason) return;

    const data: SwapDetailsData = {
      reason,
      reasonNotes: reasonNotes.trim() || undefined,
      markOriginalForMaintenance: markOriginalForMaintenance || undefined,
      originalVehicleNotes:
        markOriginalForMaintenance && originalVehicleNotes.trim()
          ? originalVehicleNotes.trim()
          : undefined,
    };
    if (readingsRequired && originalEndValue !== null && newStartValue !== null) {
      data.originalVehicleEndOdometer = originalEndValue;
      data.originalVehicleFuelLevel = originalFuel;
      data.newVehicleStartOdometer = newStartValue;
      data.newVehicleFuelLevel = newFuel;
    }
    // Always explicit (the server bills only chargeDifference: true). Nothing to
    // bill (no difference, or the cars couldn't be priced) → off, so the server
    // never refuses with PRICE_DIFFERENCE_UNAVAILABLE.
    data.chargeDifference = priceKnown && chargeable ? chargeDifference : false;
    onSubmit(data);
  };

  const currentLabel = currentVehicleRegNo ?? "Current vehicle";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Swap Reason */}
      <div className="space-y-2">
        <Label htmlFor="swapReason" className="text-sm font-medium">
          Reason for Swap <span className="text-red-500">*</span>
        </Label>
        <Select value={reason} onValueChange={handleReasonChange}>
          <SelectTrigger id="swapReason" className="w-full">
            <SelectValue placeholder="Select a reason" />
          </SelectTrigger>
          <SelectContent>
            {REASON_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {attempted && !reason && (
          <p className="text-xs text-red-600">Select a reason</p>
        )}
      </div>

      {/* Handover readings — the car is with the customer */}
      {readingsRequired && (
        <div className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Handover readings</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Returning car */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Returning · <span className="font-mono normal-case">{currentLabel}</span>
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="originalEndOdo" className="text-sm">
                  End odometer (km) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="originalEndOdo"
                  inputMode="numeric"
                  placeholder={segmentStart !== null ? `${segmentStart} or more` : "e.g. 34180"}
                  value={originalEndOdo}
                  onChange={(e) => setOriginalEndOdo(e.target.value.replace(/[^\d]/g, ""))}
                  aria-invalid={!!showError("originalEndOdo", originalEndOdo)}
                />
                {showError("originalEndOdo", originalEndOdo) ? (
                  <p className="text-xs text-red-600">{showError("originalEndOdo", originalEndOdo)}</p>
                ) : segmentStart !== null ? (
                  <p className="text-xs text-gray-500">
                    Taken out at {formatKm(segmentStart)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="originalFuel" className="text-sm">
                  Fuel (bars) <span className="text-red-500">*</span>
                </Label>
                <Select value={originalFuel} onValueChange={setOriginalFuel}>
                  <SelectTrigger id="originalFuel" className="w-full" aria-invalid={!!showError("originalFuel", originalFuel)}>
                    <SelectValue placeholder="Select fuel level" />
                  </SelectTrigger>
                  <SelectContent>
                    {SWAP_FUEL_BAR_OPTIONS.map((bars) => (
                      <SelectItem key={bars} value={bars}>
                        {bars} / 10
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showError("originalFuel", originalFuel) && (
                  <p className="text-xs text-red-600">{showError("originalFuel", originalFuel)}</p>
                )}
              </div>
            </div>

            {/* Replacement */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                Replacement · <span className="font-mono normal-case">{newVehicle.regNo}</span>
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="newStartOdo" className="text-sm">
                  Start odometer (km) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="newStartOdo"
                  inputMode="numeric"
                  value={newStartOdo}
                  onChange={(e) => setNewStartOdo(e.target.value.replace(/[^\d]/g, ""))}
                  aria-invalid={!!showError("newStartOdo", newStartOdo)}
                />
                {showError("newStartOdo", newStartOdo) ? (
                  <p className="text-xs text-red-600">{showError("newStartOdo", newStartOdo)}</p>
                ) : typeof newVehicle.odo === "number" ? (
                  <p className="text-xs text-gray-500">
                    Last recorded {formatKm(newVehicle.odo)} — check the dashboard
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newFuel" className="text-sm">
                  Fuel (bars) <span className="text-red-500">*</span>
                </Label>
                <Select value={newFuel} onValueChange={setNewFuel}>
                  <SelectTrigger id="newFuel" className="w-full" aria-invalid={!!showError("newFuel", newFuel)}>
                    <SelectValue placeholder="Select fuel level" />
                  </SelectTrigger>
                  <SelectContent>
                    {SWAP_FUEL_BAR_OPTIONS.map((bars) => (
                      <SelectItem key={bars} value={bars}>
                        {bars} / 10
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showError("newFuel", newFuel) && (
                  <p className="text-xs text-red-600">{showError("newFuel", newFuel)}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Price difference + Charge customer */}
      {priceKnown && (
        <div
          className={cn(
            "rounded-lg border p-4 space-y-3",
            difference === null
              ? "border-amber-200 bg-amber-50"
              : chargeable
                ? "border-orange-200 bg-orange-50/60"
                : "border-gray-200 bg-gray-50",
          )}
        >
          <div className="flex items-start gap-2">
            {difference === null ? (
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            ) : (
              <IndianRupee className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              {difference === null ? (
                <>
                  <p className="text-sm font-semibold text-amber-900">
                    Price difference unavailable
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    {swapContext?.pricingError ?? "These vehicles couldn't be priced."} The
                    swap can go ahead, but nothing will be charged for it.
                  </p>
                </>
              ) : chargeable ? (
                <>
                  <p className="text-sm text-gray-900">
                    <span className="font-semibold">+{formatSwapRupees(difference)}</span>{" "}
                    for the rest of the rental (no GST added)
                  </p>
                  {remainingPct !== null && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Price gap between the two cars for the remaining {remainingPct}% of the
                      booking
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-700">
                  No price difference — the replacement costs the same or less.
                </p>
              )}
            </div>
          </div>

          {chargeable && (
            <div className="flex items-start gap-2 pt-1 border-t border-orange-100">
              <Checkbox
                id="chargeDifference"
                className="mt-2"
                checked={chargeDifference}
                onCheckedChange={(checked) => setChargeDifference(checked === true)}
              />
              <div className="pt-1.5">
                <Label htmlFor="chargeDifference" className="text-sm font-medium cursor-pointer">
                  Charge customer
                </Label>
                <p className="text-xs text-gray-600 mt-0.5">
                  {chargeDifference
                    ? "Billed on the drop bill (no GST)."
                    : "Waived — not charged; kept on the swap record."}
                  {!reason && " Choose a reason to apply its default."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reason Notes */}
      <div className="space-y-2">
        <Label htmlFor="swapReasonNotes" className="text-sm font-medium">
          Additional Notes
        </Label>
        <Textarea
          id="swapReasonNotes"
          placeholder="Provide any additional context for this swap..."
          value={reasonNotes}
          onChange={(e) => setReasonNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className="resize-none"
        />
      </div>

      {/* Mark for Maintenance */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="swapMarkMaintenance"
            checked={markOriginalForMaintenance}
            onCheckedChange={(checked) => setMarkOriginalForMaintenance(checked === true)}
          />
          <Label htmlFor="swapMarkMaintenance" className="text-sm font-medium cursor-pointer">
            {readingsRequired
              ? "Send the returning vehicle to maintenance"
              : "Mark original vehicle for maintenance"}
          </Label>
        </div>

        {markOriginalForMaintenance && (
          <div className="space-y-2 ml-6 pl-4 border-l-2 border-gray-200">
            <Label htmlFor="swapOriginalVehicleNotes" className="text-sm font-medium">
              Maintenance Notes <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="swapOriginalVehicleNotes"
              placeholder="Describe the issues or maintenance required..."
              value={originalVehicleNotes}
              onChange={(e) => setOriginalVehicleNotes(e.target.value)}
              maxLength={1000}
              rows={2}
              className="resize-none"
            />
            {attempted && maintenanceNotesMissing && (
              <p className="text-xs text-red-600">Describe what needs fixing</p>
            )}
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{errorMessage}</p>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || (attempted && !canSubmit)}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          {isSubmitting ? "Processing..." : submitLabel}
        </Button>
      </div>
    </form>
  );
};
