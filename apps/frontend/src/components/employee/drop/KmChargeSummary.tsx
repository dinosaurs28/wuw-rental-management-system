import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KmChargeFigures } from "./kmCharge";

interface KmChargeSummaryProps {
  figures: KmChargeFigures;
  /**
   * "preview" = live estimate while typing; "computed" = the server's figures after
   * compute; "reference" = informational only (branches that don't bill at drop).
   */
  source: "preview" | "computed" | "reference";
}

const SOURCE_LABELS: Record<KmChargeSummaryProps["source"], string> = {
  preview: "Estimate",
  computed: "Computed",
  reference: "For reference",
};

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function KmChargeSummary({ figures, source }: KmChargeSummaryProps) {
  const skipped = figures.autoKmSkipped === "VEHICLE_SWAPPED";
  const over = !skipped && figures.extraKm > 0;
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        skipped
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
          <p className="font-medium text-neutral-800">Km driven {inr(figures.kmDriven)}</p>
          <p className="text-xs text-neutral-600 mt-1">
            Vehicle was swapped during the rental — extra km isn't calculated automatically.
          </p>
        </>
      ) : (
        <>
          <p className={cn("font-medium", over ? "text-orange-900" : "text-green-900")}>
            Km driven {inr(figures.kmDriven)} · Included {inr(figures.includedKm)} · Extra {inr(figures.extraKm)} km × ₹
            {inr(figures.extraKmRate)} = ₹{inr(figures.extraKmCharge)}
          </p>
          {!figures.extraKmEnabled && over && (
            <p className="text-xs text-neutral-500 mt-1">Extra-km charging is turned off for this branch.</p>
          )}
          {source === "preview" && (
            <p className="text-xs text-neutral-500 mt-1">Charged automatically when you compute the charges.</p>
          )}
        </>
      )}
    </div>
  );
}
