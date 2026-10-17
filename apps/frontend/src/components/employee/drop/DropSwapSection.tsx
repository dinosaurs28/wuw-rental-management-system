import { ArrowRight, Repeat } from "lucide-react";
import { format } from "date-fns";
import type { OdometerSegment } from "@/types/drop";

interface DropSwapSectionProps {
  /** Finished odometer segments — one per mid-rental swap (kmSegments.segments) */
  segments: OdometerSegment[];
  /** Reading the car handed back now started at — the drop's end odometer can't be below it */
  currentStartOdometer: number | null;
  className?: string;
}

const km = (n: number) => `${n.toLocaleString("en-IN")} km`;
const inr = (s: string) => `₹${(parseFloat(s) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * "Vehicle swap" at the drop: for each mid-rental swap, the car handed back
 * (start → end odometer, km driven, extra km and ₹ recorded at the swap) and
 * the replacement with its start reading — the drop is checked against the
 * car actually coming back. The recorded extra km is part of the drop's one
 * extra-km charge, never billed on top of it.
 */
export function DropSwapSection({ segments, currentStartOdometer, className }: DropSwapSectionProps) {
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]!;
  return (
    <div className={className ?? "rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-sm space-y-3"}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-800">
        <Repeat className="h-3.5 w-3.5" /> Vehicle swap{segments.length > 1 ? `s (${segments.length})` : ""}
      </p>
      {segments.map((s, i) => {
        const recorded = s.recorded ?? null;
        return (
          <div key={s.endedBySwapPublicId ?? i} className="space-y-1.5">
            {s.swappedAt && (
              <p className="text-[11px] text-neutral-500">Swapped {format(new Date(s.swappedAt), "d MMM, h:mm a")}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 sm:items-center">
              <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 min-w-0">
                <p className="text-[11px] text-neutral-500">Replaced</p>
                <p className="font-mono text-sm font-semibold text-neutral-900">{s.vehicleRegNo ?? "—"}</p>
                <p className="text-xs text-neutral-600">
                  {s.startOdometer != null ? km(s.startOdometer) : "—"} → {s.endOdometer != null ? km(s.endOdometer) : "—"}
                  {s.km != null && <> · driven <span className="font-medium">{km(s.km)}</span></>}
                </p>
                {recorded?.extraKm != null ? (
                  <p className={recorded.extraKm > 0 ? "text-xs font-medium text-orange-800" : "text-xs text-neutral-500"}>
                    {recorded.extraKm > 0
                      ? `Extra km recorded at the swap: ${km(recorded.extraKm)}${
                          recorded.extraKmEnabled && recorded.extraKmCharge != null ? ` · ${inr(recorded.extraKmCharge)}` : ""
                        }`
                      : "No extra km at the swap"}
                  </p>
                ) : (
                  <p className="text-xs text-neutral-500">Extra km not recorded at the swap</p>
                )}
              </div>
              <ArrowRight className="hidden sm:block h-4 w-4 text-neutral-400" />
              <div className="rounded-md border border-blue-200 bg-white px-3 py-2 min-w-0">
                <p className="text-[11px] text-blue-700">Replacement</p>
                <p className="font-mono text-sm font-semibold text-neutral-900">{s.replacementRegNo ?? "—"}</p>
                <p className="text-xs text-neutral-600">
                  Start odometer {s.replacementStartOdometer != null ? km(s.replacementStartOdometer) : "not recorded"}
                </p>
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-neutral-600">
        Check the drop against <span className="font-mono font-medium">{last.replacementRegNo ?? "the replacement"}</span>
        {currentStartOdometer != null && <> — its end odometer can't be below {km(currentStartOdometer)}</>}. Km on the
        replaced car{segments.length > 1 ? "s" : ""} is part of this drop's one extra-km charge, not added on top.
      </p>
    </div>
  );
}
