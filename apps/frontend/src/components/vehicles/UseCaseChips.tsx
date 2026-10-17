import { cn } from "@/lib/utils";
import { normalizeUseCases } from "@repo/schemas";
import {
  VEHICLE_USE_CASES,
  VEHICLE_USE_CASE_LABELS,
  type VehicleUseCase,
} from "@/services/vehicle.service";

/** Shown while no trip type is chosen. */
export const TRIP_TYPE_HINT = "Choose where you'll drive";

interface TripTypeChipsProps {
  value: VehicleUseCase | null;
  onChange: (next: VehicleUseCase) => void;
  className?: string;
}

/**
 * "Trip type" — one required choice: Udupi/Manipal (LOCAL) or Out of Udupi
 * (OUT_OF_UDUPI). The vehicles list is filtered by it (useCases=<choice>).
 */
export const TripTypeChips = ({ value, onChange, className }: TripTypeChipsProps) => (
  <div role="radiogroup" aria-label="Trip type" className={cn("flex flex-wrap items-center gap-2", className)}>
    {VEHICLE_USE_CASES.map((tag) => {
      const active = value === tag;
      return (
        <button
          key={tag}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(tag)}
          className={cn(
            "h-10 px-5 rounded-full text-sm font-semibold transition-all border whitespace-nowrap cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
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

interface TripTypeChooserProps {
  onChoose: (next: VehicleUseCase) => void;
  className?: string;
}

/** In place of the vehicles list until a trip type is chosen (deep link, reload, reset). */
export const TripTypeChooser = ({ onChoose, className }: TripTypeChooserProps) => (
  <div
    className={cn(
      "mx-auto max-w-xl rounded-[20px] border border-zinc-200 bg-white px-5 py-6 sm:px-7 sm:py-7 text-center shadow-[0_1px_2px_rgba(20,20,30,0.04)]",
      className,
    )}
  >
    <p className="text-base sm:text-lg font-semibold text-zinc-900">{TRIP_TYPE_HINT}</p>
    <p className="mt-1 text-sm text-zinc-500">Pick a trip type to see the vehicles for it.</p>
    <TripTypeChips value={null} onChange={onChoose} className="mt-4 justify-center" />
  </div>
);

interface UseCaseFilterChipsProps {
  value: VehicleUseCase[];
  onChange: (next: VehicleUseCase[]) => void;
  className?: string;
}

/** Multi-select tag chips (admin vehicle tagging — a vehicle may carry both). */
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
  // Legacy Highway / Hill Station / Long Drive show as Out of Udupi
  const tags = normalizeUseCases(useCases);
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
