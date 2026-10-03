import { useEffect, useState } from "react";
import { Car, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { SwapVehiclePicker, toPickerVehicle } from "./SwapVehiclePicker";

interface SwapVehiclePickerFieldProps {
  vehicles: AvailableVehicle[];
  selectedVehicleId?: number;
  onSelectVehicle: (vehicle: AvailableVehicle) => void;
  disabled?: boolean;
  /** Open the picker as soon as the field mounts (step-1 of a swap dialog) */
  autoOpen?: boolean;
}

/** Button that opens the shared swap picker (bottom sheet on phones, dialog on desktop). */
export function SwapVehiclePickerField({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  disabled,
  autoOpen,
}: SwapVehiclePickerFieldProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (autoOpen && vehicles.length > 0) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);
  const selected = vehicles.find((v) => v.id === selectedVehicleId) ?? null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="h-auto w-full justify-between gap-3 px-3 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Car className="h-4 w-4 shrink-0 text-neutral-400" />
          {selected ? (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {selected.make} {selected.model}
              </span>
              <span className="block font-mono text-xs text-neutral-500">{selected.regNo}</span>
            </span>
          ) : (
            <span className="text-sm">
              Choose replacement vehicle ({vehicles.length} available)
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-orange-600">
          {selected ? "Change" : "Search"}
          <ChevronRight className="h-4 w-4" />
        </span>
      </Button>
      <SwapVehiclePicker
        open={open}
        onOpenChange={setOpen}
        vehicles={vehicles.map(toPickerVehicle)}
        selectedKey={selectedVehicleId}
        confirmLabel="Select"
        onConfirm={(key) => {
          const v = vehicles.find((x) => x.id === key);
          if (v) onSelectVehicle(v);
        }}
      />
    </>
  );
}
