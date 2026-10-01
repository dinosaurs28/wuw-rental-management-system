import { cn } from "@/lib/utils";
import {
  VEHICLE_USE_CASES,
  VEHICLE_USE_CASE_LABELS,
  type VehicleUseCase,
} from "@/services/vehicle.service";

interface UseCaseFilterChipsProps {
  value: VehicleUseCase[];
  onChange: (next: VehicleUseCase[]) => void;
  className?: string;
}

/** Multi-select "Trip type" chips (OR semantics on the backend). */
export const UseCaseFilterChips = ({
  value,
  onChange,
  className,
}: UseCaseFilterChipsProps) => {
  const toggle = (tag: VehicleUseCase) =>
    onChange(
      value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag],
    );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {VEHICLE_USE_CASES.map((tag) => {
        const active = value.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(tag)}
            className={cn(
              "h-10 px-5 rounded-full text-sm font-semibold transition-all border whitespace-nowrap cursor-pointer focus:outline-none",
              active
                ? "bg-zinc-900 text-white border-zinc-900"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300",
            )}
          >
            {VEHICLE_USE_CASE_LABELS[tag]}
          </button>
        );
      })}
    </div>
  );
};

interface UseCaseBadgesProps {
  useCases?: string[] | null;
  tone?: "light" | "dark";
  className?: string;
}

/** Read-only tag badges; renders nothing for untagged vehicles. */
export const UseCaseBadges = ({
  useCases,
  tone = "light",
  className,
}: UseCaseBadgesProps) => {
  const tags = (useCases ?? []).filter(
    (t): t is VehicleUseCase => t in VEHICLE_USE_CASE_LABELS,
  );
  if (tags.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            tone === "dark"
              ? "bg-white/[0.12] border border-white/20 text-white"
              : "bg-zinc-100 border border-zinc-200 text-zinc-700",
          )}
        >
          {VEHICLE_USE_CASE_LABELS[tag]}
        </span>
      ))}
    </div>
  );
};
