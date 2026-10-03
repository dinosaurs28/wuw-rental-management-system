import { useState } from "react";
import { Car, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlternativeVehicle } from "@/services/extension.service";
import { SwapVehiclePicker } from "./SwapVehiclePicker";

/** Extension "swap to an available vehicle" chooser: same sheet/dialog picker as the swap flows. */
export function ExtensionVehiclePicker({
  vehicles,
  value,
  onChange,
}: {
  vehicles: AlternativeVehicle[];
  value: string;
  onChange: (publicId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = vehicles.find((v) => v.publicId === value) ?? null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-10 w-full justify-between gap-2 text-sm"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Car className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <span className="truncate">
            {selected
              ? `${selected.make} ${selected.model} — ${selected.regNo}`
              : "Select alternative vehicle…"}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
      </Button>
      <SwapVehiclePicker
        open={open}
        onOpenChange={setOpen}
        vehicles={vehicles.map((v) => ({
          key: v.publicId,
          make: v.make,
          model: v.model,
          regNo: v.regNo,
        }))}
        selectedKey={value || null}
        onConfirm={(key) => onChange(String(key))}
        title="Choose alternative vehicle"
        description="Search, tap a vehicle to select it, then confirm."
      />
    </>
  );
}
