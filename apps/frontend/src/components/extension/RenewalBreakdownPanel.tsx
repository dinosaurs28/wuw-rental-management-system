import { cn } from "@/lib/utils";
import { formatInrExact, gstNumber } from "@/lib/gst";
import type { RenewalBreakdown } from "@/services/extension.service";

interface RenewalBreakdownPanelProps {
  /** The server's renewal breakdown (evaluate pricing, a partial option or the commit result). */
  renewal: RenewalBreakdown | null | undefined;
  className?: string;
}

/**
 * A monthly booking's renewal as the server priced it (client TODO 7–9): its
 * length, each part with the rate it was billed at — whole 30-day months at
 * the car's monthly price, the rest at the daily rate with the branch's
 * duration slab — the discount taken and the part's total. All amounts are
 * GST-inclusive; nothing is computed here. Renders nothing without a breakdown
 * (daily bookings, older servers).
 */
export function RenewalBreakdownPanel({ renewal, className }: RenewalBreakdownPanelProps) {
  if (!renewal || renewal.parts.length === 0) return null;
  return (
    <div className={cn("space-y-1.5 text-sm", className)}>
      <div className="flex justify-between text-neutral-600">
        <span>Renewal</span>
        <span className="font-semibold text-neutral-900">+{renewal.label}</span>
      </div>
      <div className="space-y-1.5 rounded-md bg-orange-50/60 border border-orange-100 px-2.5 py-2 text-xs">
        {renewal.parts.map((p) => {
          const discount = gstNumber(p.discount) ?? 0;
          return (
            <div key={p.part} className="space-y-0.5">
              <div className="flex justify-between gap-3 text-neutral-700">
                <span>
                  {p.label}
                  <span
                    className={cn(
                      "ml-1.5 rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide",
                      p.rate === "MONTHLY" ? "bg-orange-100 text-orange-700" : "bg-neutral-100 text-neutral-600",
                    )}
                  >
                    {p.rate === "MONTHLY" ? "Monthly" : "Daily"}
                  </span>
                </span>
                <span className="font-medium">{formatInrExact(p.price)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between gap-3 text-green-700">
                  <span>{p.discountLabel ?? "Discount"}</span>
                  <span>−{formatInrExact(discount)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between gap-3 text-neutral-500">
                  <span>Part total</span>
                  <span>{formatInrExact(p.total)}</span>
                </div>
              )}
            </div>
          );
        })}
        {renewal.monthlyPriceMissing && (
          <p className="text-amber-700">
            This car has no monthly price set, so its months are priced at the daily rate.
          </p>
        )}
      </div>
    </div>
  );
}
