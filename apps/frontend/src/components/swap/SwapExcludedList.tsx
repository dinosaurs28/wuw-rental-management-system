import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SwapExcludedVehicle } from "@/types/vehicleSwap";

/**
 * Same-type cars of the branch that can't take over this booking, with the
 * server's reason — collapsed under the candidates so staff aren't left
 * guessing why a car is missing (client item 7).
 */
export function SwapExcludedList({
  excluded,
  className,
}: {
  excluded: SwapExcludedVehicle[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (excluded.length === 0) return null;
  return (
    <div className={cn("rounded-lg border border-gray-200", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        Not available ({excluded.length})
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="divide-y border-t">
          {excluded.map((v) => (
            <li key={v.id} className="px-3 py-2">
              <p className="text-sm text-gray-800">
                {v.make} {v.model} <span className="font-mono text-xs text-gray-500">· {v.regNo}</span>
              </p>
              <p className="text-xs text-amber-700">{v.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
