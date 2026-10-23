import { CalendarRange, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchPlan } from "@/store/search.store";
import { CUSTOMER_MONTHLY_LABEL } from "@/utils/customerMonthly";

/**
 * Daily / Monthly switch on the customer booking panel (client TODO item 1).
 * Daily = the existing flow (12 hours to 30 days); Monthly = exactly 30 days
 * from the pickup at each vehicle's monthly price.
 */
export function PlanToggle({
  value,
  onChange,
  className,
  size = "md",
}: {
  value: SearchPlan;
  onChange: (plan: SearchPlan) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const options: { value: SearchPlan; label: string; Icon: typeof Sun }[] = [
    { value: "STANDARD", label: "Daily", Icon: Sun },
    { value: "MONTHLY", label: CUSTOMER_MONTHLY_LABEL, Icon: CalendarRange },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Rental type"
      className={cn("inline-flex rounded-full border border-zinc-200 bg-white p-1", className)}
    >
      {options.map(({ value: v, label, Icon }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900",
              size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
              active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900",
            )}
          >
            <Icon className="size-4" strokeWidth={1.8} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
