import { IdCard, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDrivingLicenceInput } from "@/lib/customerProfile";
import { formatDlNumber } from "@/lib/pickupDlNumber";
import { cn } from "@/lib/utils";

interface PickupDlNumberCardProps {
  id: string;
  /** The customer's stored DL number (pickup details); null = none on file. */
  onFile: string | null | undefined;
  /** What staff typed. */
  value: string;
  onValueChange: (value: string) => void;
  /** Staff opened the input to correct a stored number. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Validation or server message shown under the input. */
  error?: string | null;
  disabled?: boolean;
}

/**
 * The customer's driving licence NUMBER at pickup (X2) — required for the
 * handover (the DL picture is optional). Shows the stored number large enough
 * to check against the card, with an input when none is on file or staff need
 * to correct it. The typed number is sent with the pickup and saved to the customer.
 */
export function PickupDlNumberCard({
  id,
  onFile,
  value,
  onValueChange,
  editing,
  onEditingChange,
  error,
  disabled = false,
}: PickupDlNumberCardProps) {
  const stored = onFile?.trim() || null;
  const inputShown = !stored || editing;

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4",
        stored && !editing
          ? "border-emerald-200 bg-emerald-50/50"
          : "border-amber-300 bg-amber-50/60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "rounded-full p-2 shrink-0",
            stored && !editing ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
          )}
        >
          <IdCard className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Driving licence number <span className="text-red-500">*</span>
          </p>
          {stored ? (
            <>
              <p className="mt-0.5 font-mono text-xl font-bold tracking-wider text-gray-900 break-all">
                {formatDlNumber(stored)}
              </p>
              {!editing && (
                <p className="text-xs text-muted-foreground mt-1">
                  Check it against the customer's licence card before handing over.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-amber-900 mt-1">
              No DL number on file. Enter it from the customer's licence card — it's
              required before the handover.
            </p>
          )}
        </div>
        {stored && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 text-xs"
            onClick={() => onEditingChange(!editing)}
            disabled={disabled}
          >
            {editing ? (
              "Cancel"
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5" />
                Correct
              </>
            )}
          </Button>
        )}
      </div>

      {inputShown && (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor={id} className="text-xs font-medium text-gray-700">
            {stored ? "Corrected DL number" : "DL number"}
          </Label>
          <Input
            id={id}
            value={value}
            placeholder="KA01 20110012345"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-11 bg-white font-mono tracking-wide"
            onChange={(e) => onValueChange(formatDrivingLicenceInput(e.target.value))}
            disabled={disabled}
            aria-invalid={!!error}
          />
          {error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Saved to the customer's profile when you continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
