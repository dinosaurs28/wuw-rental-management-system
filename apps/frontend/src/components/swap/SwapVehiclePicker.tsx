import { useEffect, useMemo, useState } from "react";
import { Car, Check, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SwapPriceLine } from "@/components/manager/vehicle-swap/AvailableVehiclesList";
import type { AvailableVehicle } from "@/types/vehicleSwap";

/** Minimal shape every swap flow can provide. */
export interface SwapPickerVehicle {
  key: string | number;
  make: string;
  model: string;
  regNo: string;
  categoryName?: string | null;
  imageUrl?: string | null;
  isUpgrade?: boolean;
  /** Difference of the GST-inclusive rents, billed with no GST on top; undefined = no price info (hidden) */
  priceDifference?: string | null;
}

export function toPickerVehicle(v: AvailableVehicle): SwapPickerVehicle {
  return {
    key: v.id,
    make: v.make,
    model: v.model,
    regNo: v.regNo,
    categoryName: v.categoryName,
    imageUrl: v.images?.[0]?.url ?? null,
    isUpgrade: v.isUpgrade,
    priceDifference: v.priceDifference,
  };
}

/** Case-insensitive, multi-word: every word must appear in make / model / reg no. */
export function filterSwapVehicles<T extends { make: string; model: string; regNo: string }>(
  vehicles: T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return vehicles;
  return vehicles.filter((v) => {
    const hay = `${v.make} ${v.model} ${v.regNo}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

interface SwapVehiclePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicles: SwapPickerVehicle[];
  /** Currently chosen vehicle (pre-selected when the picker opens) */
  selectedKey?: string | number | null;
  /** Called with the vehicle the user confirmed */
  onConfirm: (key: string | number) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

function PickerBody({
  vehicles,
  selectedKey,
  onConfirm,
  onClose,
  confirmLabel,
}: Pick<SwapVehiclePickerProps, "vehicles" | "selectedKey" | "onConfirm" | "confirmLabel"> & {
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string | number | null>(selectedKey ?? null);

  const filtered = useMemo(() => filterSwapVehicles(vehicles, query), [vehicles, query]);
  const chosen = vehicles.find((v) => v.key === draft) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search make or model"
          aria-label="Search vehicles by make or model"
          className="h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-9 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center">
            <Car className="mx-auto mb-1.5 h-8 w-8 text-neutral-300" />
            <p className="text-sm font-medium text-neutral-700">
              {vehicles.length === 0 ? "No vehicles available" : "No vehicle matches your search"}
            </p>
            {query && vehicles.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-1 text-xs text-orange-600 underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          filtered.map((v) => {
            const selected = v.key === draft;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setDraft(v.key)}
                aria-pressed={selected}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border bg-white p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300",
                  selected
                    ? "border-orange-400 bg-orange-50/50 ring-2 ring-orange-200"
                    : "border-neutral-200 hover:border-orange-300",
                )}
              >
                <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded border bg-neutral-50">
                  {v.imageUrl ? (
                    <img
                      src={v.imageUrl}
                      alt={`${v.make} ${v.model}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Car className="h-5 w-5 text-neutral-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">
                    {v.make} {v.model}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-xs text-neutral-500">{v.regNo}</span>
                    {v.categoryName && (
                      <span className="text-xs text-neutral-400">{v.categoryName}</span>
                    )}
                    {v.isUpgrade && (
                      <Badge
                        variant="outline"
                        className="border-blue-200 bg-blue-50 px-1.5 py-0 text-[10px] text-blue-700"
                      >
                        Upgrade
                      </Badge>
                    )}
                  </div>
                  <SwapPriceLine priceDifference={v.priceDifference} className="mt-0.5" />
                </div>
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    selected
                      ? "border-orange-500 bg-orange-500 text-white"
                      : "border-neutral-300 text-transparent",
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="flex gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1 bg-orange-500 text-white hover:bg-orange-600"
          disabled={!chosen}
          onClick={() => {
            if (!chosen) return;
            onConfirm(chosen.key);
            onClose();
          }}
        >
          {chosen
            ? `${confirmLabel ?? "Select"} ${chosen.make} ${chosen.model}`.trim()
            : (confirmLabel ?? "Select")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Replacement-vehicle picker shared by every swap flow: a 75vh bottom sheet on
 * small screens, a centred dialog on desktop. Search by make / model, tap a
 * card to select (change it freely), then confirm.
 */
export function SwapVehiclePicker({
  open,
  onOpenChange,
  vehicles,
  selectedKey,
  onConfirm,
  title = "Choose replacement vehicle",
  description = "Search, tap a vehicle to select it, then confirm.",
  confirmLabel = "Select",
}: SwapVehiclePickerProps) {
  const isMobile = useIsMobile();
  // Reset search/draft each time it opens (body remounts with the content)
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (open) setSession((s) => s + 1);
  }, [open]);

  const body = (
    <PickerBody
      key={session}
      vehicles={vehicles}
      selectedKey={selectedKey}
      onConfirm={onConfirm}
      onClose={() => onOpenChange(false)}
      confirmLabel={confirmLabel}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[75vh] gap-3 rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="p-0 pr-8">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
