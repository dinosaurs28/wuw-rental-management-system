import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KmChargeFigures } from "./kmCharge";

interface KmChargeSummaryProps {
  figures: KmChargeFigures;
  /**
   * "preview" = live estimate while typing; "computed" = the server's figures after
   * compute; "billed-later" = branches without a drop bill — recorded when the
   * return is completed and collected by the branch manager at settlement.
   */
  source: "preview" | "computed" | "billed-later";
}

const SOURCE_LABELS: Record<KmChargeSummaryProps["source"], string> = {
  preview: "Estimate",
  computed: "Computed",
  "billed-later": "Billed at settlement",
};

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function KmChargeSummary({ figures, source }: KmChargeSummaryProps) {
  const skipped = figures.autoKmSkipped === "VEHICLE_SWAPPED";
  const staffEntered = skipped && figures.manualExtraKm != null;
  const over = (!skipped || staffEntered) && figures.extraKm > 0;
  const segments = figures.segments ?? [];
  const currentVehicleKm = figures.kmDriven - (figures.priorKm ?? 0);
  const billingNote =
    source === "preview"
      ? "Charged automatically when you compute the charges — GST is added on the drop bill."
      : source === "billed-later"
        ? "Recorded when you complete the return; the branch manager collects it (plus GST) at settlement."
        : null;
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        skipped && !over
          ? "bg-neutral-50 border-neutral-200"
          : over
            ? "bg-orange-50 border-orange-200"
            : "bg-green-50 border-green-200",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <Gauge className="h-3.5 w-3.5" /> Extra km
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          {SOURCE_LABELS[source]}
        </span>
      </div>
      {skipped ? (
        <>
          {staffEntered ? (
            <p className={cn("font-medium", over ? "text-orange-900" : "text-green-900")}>
              Extra km entered by staff {inr(figures.extraKm)} km × ₹{inr(figures.extraKmRate)} = ₹
              {inr(figures.extraKmCharge)}
              {figures.extraKmCharge > 0 && <span className="font-normal"> before GST</span>}
            </p>
          ) : (
            <p className="font-medium text-neutral-800">Extra km can't be measured</p>
          )}
          <p className="text-xs text-neutral-600 mt-1">
            The vehicle was swapped during the rental without odometer readings
            {staffEntered ? ", so the extra km is entered by staff." : " — enter the extra km driven."}
          </p>
        </>
      ) : (
        <>
          <p className={cn("font-medium", over ? "text-orange-900" : "text-green-900")}>
            Km driven {inr(figures.kmDriven)} · Included {inr(figures.includedKm)} · Extra {inr(figures.extraKm)} km × ₹
            {inr(figures.extraKmRate)} = ₹{inr(figures.extraKmCharge)}
            {figures.extraKmCharge > 0 && <span className="font-normal"> before GST</span>}
          </p>
          {segments.length > 0 && (
            <p className="text-xs text-neutral-600 mt-1">
              Across {segments.length + 1} vehicles:{" "}
              {segments.map((s) => `${inr(s.km ?? 0)} km`).join(" + ")} on the vehicle
              {segments.length === 1 ? "" : "s"} handed back at the swap{segments.length === 1 ? "" : "s"} +{" "}
              {inr(Math.max(0, currentVehicleKm))} km on this vehicle.
            </p>
          )}
        </>
      )}
      {!figures.extraKmEnabled && over && (
        <p className="text-xs text-neutral-500 mt-1">Extra-km charging is turned off for this branch.</p>
      )}
      {billingNote && figures.extraKmEnabled && (!skipped || staffEntered) &&
        (source === "preview" || figures.extraKmCharge > 0) && (
        <p className="text-xs text-neutral-500 mt-1">{billingNote}</p>
      )}
    </div>
  );
}
