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
      ? "Charged automatically when you compute the charges (no GST on drop charges)."
      : source === "billed-later"
        ? "Recorded when you complete the return; the branch manager collects it at settlement (no GST)."
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
              {figures.extraKmCharge > 0 && <span className="font-normal"> (no GST)</span>}
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
            {figures.extraKmCharge > 0 && <span className="font-normal"> (no GST)</span>}
          </p>
          {figures.freeKmOriginal != null && figures.freeKmExtensions != null && figures.freeKmExtensions > 0 && (
            <p className="text-xs text-neutral-600 mt-1">
              Included {inr(figures.includedKm)} km = original {inr(figures.freeKmOriginal)} km + extensions{" "}
              {inr(figures.freeKmExtensions)} km
            </p>
          )}
          {segments.length > 0 && (
            <div className="text-xs text-neutral-600 mt-1 space-y-0.5">
              <p>
                Across {segments.length + 1} vehicles — one free-km allowance, used in the order they were driven
                {source === "computed" ? " (each vehicle's line of the charge above, not billed again)" : ""}:
              </p>
              <ul className="space-y-0.5 pl-3">
                {segments.map((s, i) => (
                  <li key={s.endedBySwapPublicId ?? i}>
                    <span className="font-mono">{s.vehicleRegNo ?? `Vehicle ${i + 1}`}</span> (handed back at the swap):{" "}
                    {inr(s.km ?? 0)} km
                    {s.billed
                      ? ` · extra ${inr(s.billed.extraKm)} km = ₹${inr(parseFloat(s.billed.extraKmCharge) || 0)}`
                      : s.recorded?.extraKm != null
                        ? ` · extra ${inr(s.recorded.extraKm)} km${
                            s.recorded.extraKmEnabled && s.recorded.extraKmCharge != null
                              ? ` = ₹${inr(parseFloat(s.recorded.extraKmCharge) || 0)}`
                              : ""
                          } (recorded at the swap)`
                        : ""}
                  </li>
                ))}
                <li>
                  This vehicle: {inr(Math.max(0, currentVehicleKm))} km
                  {figures.currentSegment?.billed
                    ? ` · extra ${inr(figures.currentSegment.billed.extraKm)} km = ₹${inr(
                        parseFloat(figures.currentSegment.billed.extraKmCharge) || 0,
                      )}`
                    : ""}
                </li>
              </ul>
            </div>
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
