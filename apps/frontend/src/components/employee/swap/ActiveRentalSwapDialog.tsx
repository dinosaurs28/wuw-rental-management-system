import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, ArrowRight, Car, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  employeeVehicleSwapService,
  vehicleSwapService,
} from "@/services/vehicleSwap.service";
import type { AvailableVehicle, VehicleSwap } from "@/types/vehicleSwap";
import {
  SwapDetailsForm,
  type SwapDetailsData,
} from "@/components/manager/vehicle-swap/SwapDetailsForm";
import { SwapVehiclePickerField } from "@/components/swap/SwapVehiclePickerField";
import {
  SWAP_PICK_AGAIN_CODES,
  swapAmount,
  swapErrorCode,
} from "@/components/manager/vehicle-swap/swapFormat";

interface ActiveRentalSwapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingPublicId: string;
  /** Which API the dialog talks to (Fleet = employee, BM = manager) */
  role?: "employee" | "manager";
  onSwapped?: (swap: VehicleSwap) => void;
}

/**
 * Swap the car on a booking — built for the active rental (PICKED_UP): pick a
 * replacement (upgrade badge + pro-rated price difference), then record the
 * reason, both cars' handover readings and whether the customer is charged.
 * Works for a CONFIRMED booking too (no readings), driven by `swapContext`.
 */
export function ActiveRentalSwapDialog({
  open,
  onOpenChange,
  bookingPublicId,
  role = "employee",
  onSwapped,
}: ActiveRentalSwapDialogProps) {
  const queryClient = useQueryClient();
  const service = role === "manager" ? vehicleSwapService : employeeVehicleSwapService;

  const [selected, setSelected] = useState<AvailableVehicle | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);

  const candidatesQuery = useQuery({
    queryKey: ["vehicle-swap-candidates", role, bookingPublicId],
    queryFn: () => service.getSwapCandidates(bookingPublicId),
    enabled: open && !!bookingPublicId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const vehicles = candidatesQuery.data?.vehicles ?? [];
  const swapContext = candidatesQuery.data?.swapContext ?? null;
  const current = swapContext?.currentVehicle;
  const activeRental = swapContext?.stage === "ACTIVE_RENTAL";
  const remainingPct = swapContext
    ? Math.round((swapAmount(swapContext.remainingFraction) ?? 0) * 100)
    : null;

  const swapMutation = useMutation({
    mutationFn: ({ vehicleId, data }: { vehicleId: number; data: SwapDetailsData }) =>
      service.performSwap(bookingPublicId, { newVehicleId: vehicleId, ...data }),
    onSuccess: (swap) => {
      const from = swap.originalVehicle?.regNo;
      const to = swap.newVehicle?.regNo;
      toast.success(from && to ? `Vehicle swapped: ${from} → ${to}` : "Vehicle swapped successfully");
      // The return page reads the car, odometer and fuel from the booking
      queryClient.invalidateQueries({ queryKey: ["booking", bookingPublicId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-swaps"] });
      onSwapped?.(swap);
      setSelected(null);
      setSwapError(null);
      onOpenChange(false);
    },
    onError: (err) => {
      const message = apiErrorMessage(err, "Failed to swap vehicle");
      if (SWAP_PICK_AGAIN_CODES.has(swapErrorCode(err) ?? "")) {
        // The car was taken (or the booking changed) — reload the list and pick again
        setSelected(null);
        setSwapError(null);
        setListNotice(message);
        void candidatesQuery.refetch();
      } else {
        setSwapError(message);
      }
      toast.error(message);
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next && swapMutation.isPending) return;
    if (!next) {
      setSelected(null);
      setSwapError(null);
      setListNotice(null);
    }
    onOpenChange(next);
  };

  const pick = (vehicle: AvailableVehicle) => {
    setListNotice(null);
    setSwapError(null);
    setSelected(vehicle);
  };

  const fmt = (iso: string) => format(new Date(iso), "d MMM, h:mm a");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Swap vehicle</DialogTitle>
          <DialogDescription>
            {activeRental
              ? `The customer hands back ${current?.regNo ?? "the current car"} and continues the rental in the replacement.`
              : swapContext
                ? "Assign a different vehicle to this booking before pickup."
                : "Move this booking to a different vehicle."}
          </DialogDescription>
        </DialogHeader>

        {/* Current car + booking window */}
        {swapContext && current && (
          <div className="rounded-lg bg-neutral-50 px-4 py-3 flex flex-col gap-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <Car className="h-4 w-4 text-neutral-400 shrink-0" />
              <span className="font-semibold text-neutral-900">
                {current.make} {current.model}
              </span>
              <span className="font-mono text-xs text-neutral-500">{current.regNo}</span>
              <span className="text-xs text-neutral-400">· {current.categoryName}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] uppercase tracking-wide",
                  activeRental
                    ? "bg-orange-50 text-orange-700 border-orange-200"
                    : "bg-blue-50 text-blue-700 border-blue-200",
                )}
              >
                {activeRental ? "Active rental" : "Before pickup"}
              </Badge>
              <span>
                Until {fmt(swapContext.endAt)}
                {remainingPct !== null && ` · ${remainingPct}% left`}
              </span>
            </div>
          </div>
        )}

        {selected ? (
          // ── Step 2: reason, readings, charge ───────────────────────────────
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setSwapError(null);
              }}
              disabled={swapMutation.isPending}
              className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Choose another vehicle
            </button>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5 min-w-0">
                <p className="text-[11px] text-neutral-500 mb-0.5">
                  {activeRental ? "Coming back" : "Current"}
                </p>
                <p className="font-semibold text-sm truncate">
                  {current ? `${current.make} ${current.model}` : "—"}
                </p>
                <p className="font-mono text-xs text-neutral-500">{current?.regNo ?? "—"}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-neutral-400" />
              <div className="rounded-lg border border-orange-200 ring-2 ring-orange-100 bg-white px-3 py-2.5 min-w-0">
                <p className="text-[11px] text-orange-600 font-medium mb-0.5">
                  {activeRental ? "Going out" : "New vehicle"}
                </p>
                <p className="font-semibold text-sm truncate">
                  {selected.make} {selected.model}
                </p>
                <div className="flex items-center gap-1.5">
                  <p className="font-mono text-xs text-neutral-500">{selected.regNo}</p>
                  {selected.isUpgrade && <UpgradeBadge />}
                </div>
              </div>
            </div>

            <SwapDetailsForm
              key={selected.id}
              newVehicle={selected}
              currentVehicleRegNo={current?.regNo}
              swapContext={swapContext}
              isSubmitting={swapMutation.isPending}
              errorMessage={swapError}
              cancelLabel="Back"
              onCancel={() => {
                setSelected(null);
                setSwapError(null);
              }}
              onSubmit={(data) => {
                setSwapError(null);
                swapMutation.mutate({ vehicleId: selected.id, data });
              }}
            />
          </div>
        ) : (
          // ── Step 1: pick the replacement ───────────────────────────────────
          <div className="space-y-3">
            {listNotice && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{listNotice}</p>
              </div>
            )}

            {swapContext && !swapContext.pricingAvailable && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">
                  Price differences couldn't be worked out
                  {swapContext.pricingError ? `: ${swapContext.pricingError}` : "."} You can still
                  swap, without charging the customer.
                </p>
              </div>
            )}

            {candidatesQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
                ))}
              </div>
            ) : candidatesQuery.isError ? (
              // Booking-level refusal (overdue, drop bill started, extension unpaid…)
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">
                    {apiErrorMessage(candidatesQuery.error, "Could not load replacement vehicles.")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void candidatesQuery.refetch()}
                  disabled={candidatesQuery.isFetching}
                  className="gap-1.5"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", candidatesQuery.isFetching && "animate-spin")} />
                  Try again
                </Button>
              </div>
            ) : vehicles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center space-y-1.5">
                <Car className="h-8 w-8 text-neutral-300 mx-auto" />
                <p className="text-sm font-medium text-neutral-700">No replacement vehicle is free</p>
                <p className="text-xs text-neutral-500 max-w-md mx-auto">
                  A replacement must be in this branch, the same vehicle type, the same or a higher
                  category, available until the booking ends and insured past it.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-neutral-500">
                  {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"} free until the booking
                  ends — same category first.
                </p>
                <SwapVehiclePickerField
                  vehicles={vehicles}
                  selectedVehicleId={undefined}
                  onSelectVehicle={pick}
                  autoOpen
                />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UpgradeBadge() {
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200"
    >
      Upgrade
    </Badge>
  );
}
