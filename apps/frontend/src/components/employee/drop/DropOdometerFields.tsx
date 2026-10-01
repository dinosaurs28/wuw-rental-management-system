import { Gauge } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KmChargeSummary } from "./KmChargeSummary";
import type { KmChargeFigures } from "./kmCharge";

interface DropOdometerFieldsProps {
  endOdometer: string;
  onEndOdometerChange: (value: string) => void;
  manualExtraKm: string;
  onManualExtraKmChange: (value: string) => void;
  disabled?: boolean;
  /** Start reading of the vehicle being handed back (the replacement's, after a swap). */
  currentStartOdometer: number | null;
  /** The rental moved to another vehicle mid-rental and the swap recorded readings. */
  swappedWithReadings: boolean;
  /** A mid-rental swap was recorded without readings — staff type the extra km. */
  manualKmAllowed: boolean;
  endOdometerTooLow: boolean;
  kmSummary: { figures: KmChargeFigures; source: "preview" | "computed" | "billed-later" } | null;
  /** km driven to show when there is no allowance to price extra km with. */
  drivenKmFallback?: number | null;
}

/** End odometer (+ staff-entered extra km after a swap without readings) and the extra-km figures. */
export function DropOdometerFields({
  endOdometer,
  onEndOdometerChange,
  manualExtraKm,
  onManualExtraKmChange,
  disabled,
  currentStartOdometer,
  swappedWithReadings,
  manualKmAllowed,
  endOdometerTooLow,
  kmSummary,
  drivenKmFallback,
}: DropOdometerFieldsProps) {
  const manualInvalid = manualExtraKm.trim() !== "" && !/^\d+$/.test(manualExtraKm.trim());
  const endInvalid = endOdometer.trim() !== "" && !/^\d+$/.test(endOdometer.trim());
  return (
    <div className="space-y-2">
      <Label htmlFor="dropEndOdometer" className="text-sm font-medium flex items-center gap-2">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        End Odometer Reading (km) <span className="text-red-500">*</span>
      </Label>
      {currentStartOdometer != null && !manualKmAllowed && (
        <p className="text-xs text-muted-foreground">
          {swappedWithReadings ? "This vehicle's odometer at the swap" : "Start odometer"}:{" "}
          <span className="font-medium text-foreground">{currentStartOdometer} km</span>
        </p>
      )}
      <Input
        id="dropEndOdometer"
        type="number"
        min="0"
        placeholder="e.g. 12850"
        className="h-11 max-w-xs"
        value={endOdometer}
        onChange={(e) => onEndOdometerChange(e.target.value)}
        disabled={disabled}
      />
      {endInvalid && <p className="text-xs text-red-600">Enter the reading in whole km.</p>}
      {endOdometerTooLow && currentStartOdometer != null && (
        <p className="text-xs text-red-600">
          The end odometer can't be less than {swappedWithReadings ? "the reading at the swap" : "the start reading"} (
          {currentStartOdometer} km).
        </p>
      )}

      {manualKmAllowed && (
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="dropManualExtraKm" className="text-xs text-neutral-600">
            Extra km driven (entered by staff) <span className="text-red-500">*</span>
          </Label>
          <Input
            id="dropManualExtraKm"
            type="number"
            min="0"
            step="1"
            placeholder="0 if none"
            className="h-10 max-w-xs"
            value={manualExtraKm}
            onChange={(e) => onManualExtraKmChange(e.target.value)}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            The vehicle was swapped mid-rental without odometer readings, so km beyond the free allowance can't be
            measured. Enter the extra km (whole km) — it is billed at the booking's extra-km rate and logged.
          </p>
          {manualInvalid && <p className="text-xs text-red-600">Enter a whole number of km.</p>}
        </div>
      )}

      {kmSummary ? (
        <KmChargeSummary figures={kmSummary.figures} source={kmSummary.source} />
      ) : (
        drivenKmFallback != null && (
          <p className="text-sm text-muted-foreground">
            Driven: <span className="font-semibold text-foreground">{drivenKmFallback.toFixed(0)} km</span>
          </p>
        )
      )}
    </div>
  );
}
