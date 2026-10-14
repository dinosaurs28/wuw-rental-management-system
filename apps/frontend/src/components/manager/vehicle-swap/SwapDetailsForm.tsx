import React, { useEffect, useState } from "react";
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
  SwapReplacementPhotos,
  swapPhotosShortfall,
  type SwapUploadedPhoto,
} from "@/components/swap/SwapReplacementPhotos";
import {
  SWAP_FUEL_BAR_OPTIONS,
  formatKm,
  formatSwapRupees,
  parseFastagBalance,
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
  /** Which API uploads the replacement's photos at a mid-rental swap (Fleet = employee, BM = manager) */
  role?: "employee" | "manager";
  /** Photos the server refused (SWAP_PHOTOS_INVALID `fileIds`) — dropped so they can be retaken */
  rejectedPhotoIds?: string[];
}

/** Without a capture config the server asks for this many photos (it also sends it per car). */
const MIN_PHOTOS_WITHOUT_CONFIG = 4;

const REASON_OPTIONS = [
  { value: SwapReason.CUSTOMER_REQUEST, label: "Customer Request" },
  { value: SwapReason.MAINTENANCE, label: "Maintenance Required" },
  { value: SwapReason.UPGRADE, label: "Vehicle Upgrade" },
  { value: SwapReason.DOWNGRADE, label: "Vehicle Downgrade" },
  { value: SwapReason.DAMAGE, label: "Vehicle Damage" },
  { value: SwapReason.OTHER, label: "Other" },
];

/**
 * Reason, handover readings, FASTag balances and photos of the replacement
 * (mid-rental), price difference + "Charge customer", and the maintenance
 * flag for a vehicle swap. Used by the swap confirmation
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
  role = "employee",
  rejectedPhotoIds,
}) => {
  const readingsRequired = swapContext?.readingsRequired === true;
  // Mid-rental: photos of the replacement + FASTag balances (cars with a FASTag)
  const photosRequired = swapContext?.photosRequired === true;
  const photoRequirement = newVehicle.photoRequirement ?? {
    fields: [],
    minPhotos: MIN_PHOTOS_WITHOUT_CONFIG,
  };
  // FASTag balances: the returning car's when it's marked as having a FASTag
  // (required) or its balance was read earlier on this booking (optional); the
  // replacement's always (required when it's marked as having one) — a balance
  // read here starts tracking its FASTag for this booking.
  const oldHasFastag = photosRequired && swapContext?.currentVehicle.hasFastag === true;
  const oldFastagShown =
    oldHasFastag || (photosRequired && swapContext?.currentVehicle.fastagBalanceRecorded === true);
  const newHasFastag = photosRequired && newVehicle.hasFastag === true;
  const newFastagShown = photosRequired;
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
  const [oldFastag, setOldFastag] = useState("");
  const [newFastag, setNewFastag] = useState("");
  const [photos, setPhotos] = useState<SwapUploadedPhoto[]>([]);
  const [photosUploading, setPhotosUploading] = useState(0);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!rejectedPhotoIds?.length) return;
    setPhotos((list) => list.filter((p) => !rejectedPhotoIds.includes(p.fileId)));
  }, [rejectedPhotoIds]);

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

  // ── FASTag balances + photos (mid-rental) ─────────────────────────────────
  const oldFastagValue = parseFastagBalance(oldFastag);
  const newFastagValue = parseFastagBalance(newFastag);
  const fastagErrors: Partial<Record<"old" | "new", string>> = {};
  if ((oldHasFastag || (oldFastagShown && oldFastag.trim() !== "")) && oldFastagValue === null) {
    fastagErrors.old = oldFastag.trim() === "" ? "Enter the FASTag balance" : "Enter an amount like 250 or 250.50 (up to ₹1,00,000)";
  }
  if ((newHasFastag || (newFastagShown && newFastag.trim() !== "")) && newFastagValue === null) {
    fastagErrors.new = newFastag.trim() === "" ? "Enter the FASTag balance" : "Enter an amount like 250 or 250.50 (up to ₹1,00,000)";
  }
  const showFastagError = (field: "old" | "new", typed: string) =>
    attempted || typed.trim() !== "" ? fastagErrors[field] : undefined;
  const photoShortfall = swapPhotosShortfall(photos, photoRequirement);
  const photosIncomplete =
    photosRequired && (photoShortfall.missingLabels.length > 0 || photoShortfall.short > 0);

  const maintenanceNotesMissing = markOriginalForMaintenance && !originalVehicleNotes.trim();
  const canSubmit =
    !!reason &&
    !isSubmitting &&
    !maintenanceNotesMissing &&
    Object.keys(readingErrors).length === 0 &&
    Object.keys(fastagErrors).length === 0 &&
    !photosIncomplete &&
    photosUploading === 0;

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
    // Always sent from the web, so the server holds mid-rental swaps to the
    // photo + FASTag rule (it ignores both before pickup)
    data.replacementPhotos = photosRequired
      ? photos.map((p) => ({ fileId: p.fileId, ...(p.label ? { label: p.label } : {}) }))
      : [];
    if (oldFastagShown && oldFastagValue !== null) data.oldVehicleFastagBalance = oldFastagValue;
    if (newFastagShown && newFastagValue !== null) data.newVehicleFastagBalance = newFastagValue;
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
              {oldFastagShown && (
                <div className="space-y-1.5">
                  <Label htmlFor="oldFastag" className="text-sm">
                    FASTag balance (₹) {oldHasFastag ? <span className="text-red-500">*</span> : <span className="text-xs text-muted-foreground">optional</span>}
                  </Label>
                  <Input
                    id="oldFastag"
                    inputMode="decimal"
                    placeholder="e.g. 450.00"
                    value={oldFastag}
                    onChange={(e) => setOldFastag(e.target.value.replace(/[^\d.]/g, ""))}
                    aria-invalid={!!showFastagError("old", oldFastag)}
                  />
                  {showFastagError("old", oldFastag) ? (
                    <p className="text-xs text-red-600">{showFastagError("old", oldFastag)}</p>
                  ) : !oldHasFastag ? (
                    <p className="text-xs text-muted-foreground">
                      Its FASTag balance was read earlier on this rental — leave empty if it has no FASTag.
                    </p>
                  ) : null}
                </div>
              )}
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
              {newFastagShown && (
                <div className="space-y-1.5">
                  <Label htmlFor="newFastag" className="text-sm">
                    FASTag balance (₹) {newHasFastag ? <span className="text-red-500">*</span> : <span className="text-xs text-muted-foreground">optional</span>}
                  </Label>
                  <Input
                    id="newFastag"
                    inputMode="decimal"
                    placeholder="e.g. 450.00"
                    value={newFastag}
                    onChange={(e) => setNewFastag(e.target.value.replace(/[^\d.]/g, ""))}
                    aria-invalid={!!showFastagError("new", newFastag)}
                  />
                  {showFastagError("new", newFastag) ? (
                    <p className="text-xs text-red-600">{showFastagError("new", newFastag)}</p>
                  ) : !newHasFastag ? (
                    <p className="text-xs text-muted-foreground">Leave empty if this car has no FASTag.</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photos of the replacement — required before a mid-rental swap completes */}
      {photosRequired && (
        <SwapReplacementPhotos
          regNo={newVehicle.regNo}
          requirement={photoRequirement}
          role={role}
          value={photos}
          onChange={setPhotos}
          onUploadingChange={setPhotosUploading}
          disabled={isSubmitting}
          submitting={isSubmitting}
          showMissing={attempted}
        />
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

      {photosRequired && (photosIncomplete || photosUploading > 0) && (
        <p className="text-xs text-gray-500 sm:text-right">
          {photosUploading > 0
            ? "Wait for the photos to finish uploading."
            : `Take the photos of ${newVehicle.regNo} to complete the swap.`}
        </p>
      )}

      {/* Footer Actions */}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          disabled={
            isSubmitting ||
            (attempted && !canSubmit) ||
            (photosRequired && (photosIncomplete || photosUploading > 0))
          }
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          {isSubmitting ? "Processing..." : submitLabel}
        </Button>
      </div>
    </form>
  );
};
