import { cn } from "@/lib/utils";
import type { ExtensionFreeKm } from "@/services/extension.service";

interface ExtensionFreeKmLineProps {
  /** `extensionFreeKm` from the evaluate / commit response. */
  freeKm: ExtensionFreeKm | null | undefined;
  label?: string;
  className?: string;
}

/**
 * Free km an extension adds to the drop allowance (#7): each whole day earns
 * the 24-hour free km, a remaining 12-hour block the 12-hour free km, and other
 * hours none. Server figures only — renders nothing for an older server or
 * when the vehicle's free km are unknown.
 */
export function ExtensionFreeKmLine({ freeKm, label = "Free km added", className }: ExtensionFreeKmLineProps) {
  if (!freeKm) return null;
  return (
    <div className={cn("text-sm", className)}>
      <div className="flex justify-between gap-3 text-neutral-600">
        <span>{label}</span>
        <span className={cn("shrink-0", freeKm.km > 0 ? "font-medium text-neutral-900" : "text-neutral-500")}>
          {freeKm.km > 0 ? `+${freeKm.km.toLocaleString("en-IN")} km` : "None"}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">{freeKm.label}</p>
    </div>
  );
}
