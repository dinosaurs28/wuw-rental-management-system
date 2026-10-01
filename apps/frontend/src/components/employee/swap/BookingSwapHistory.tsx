import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  employeeVehicleSwapService,
  vehicleSwapService,
} from "@/services/vehicleSwap.service";
import { SWAP_REASON_LABELS, type VehicleSwap } from "@/types/vehicleSwap";
import {
  formatKm,
  formatSwapRupees,
  swapAmount,
  swapStageLabel,
} from "@/components/manager/vehicle-swap/swapFormat";

interface BookingSwapHistoryProps {
  bookingPublicId: string;
  role?: "employee" | "manager";
}

/**
 * Compact "Vehicle swaps" block for one booking (return page). Renders nothing
 * until the booking has a swap.
 */
export function BookingSwapHistory({ bookingPublicId, role = "employee" }: BookingSwapHistoryProps) {
  const { data: swaps = [] } = useQuery({
    queryKey: ["vehicle-swaps", role, bookingPublicId],
    queryFn: () =>
      role === "manager"
        ? vehicleSwapService.getBookingSwapHistory(bookingPublicId)
        : employeeVehicleSwapService.getBookingSwapHistory(bookingPublicId),
    enabled: !!bookingPublicId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (swaps.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="bg-gray-50/80 border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-gray-700">Vehicle swaps</span>
        <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold px-1.5">
          {swaps.length}
        </span>
      </div>
      <ul className="divide-y divide-gray-100">
        {swaps.map((swap) => (
          <SwapRow key={swap.publicId} swap={swap} />
        ))}
      </ul>
    </div>
  );
}

function SwapRow({ swap }: { swap: VehicleSwap }) {
  const stage = swapStageLabel(swap.bookingStatusAtSwap);
  const difference = swapAmount(swap.priceDifference);
  const hasReadings =
    swap.originalVehicleEndOdometer != null && swap.newVehicleStartOdometer != null;

  return (
    <li className="px-4 py-3 space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono font-semibold text-gray-900">
          {swap.originalVehicle?.regNo ?? "—"}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
        <span className="font-mono font-semibold text-gray-900">
          {swap.newVehicle?.regNo ?? "—"}
        </span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {SWAP_REASON_LABELS[swap.reason] ?? swap.reason}
        </Badge>
        {stage && <span className="text-xs text-gray-500">{stage}</span>}
      </div>

      {swap.originalVehicle && swap.newVehicle && (
        <p className="text-xs text-gray-500">
          {swap.originalVehicle.make} {swap.originalVehicle.model} → {swap.newVehicle.make}{" "}
          {swap.newVehicle.model}
        </p>
      )}

      {hasReadings && (
        <p className="text-xs text-gray-600">
          Returned at {formatKm(swap.originalVehicleEndOdometer!)}
          {swap.originalVehicleFuelLevel && `, fuel ${swap.originalVehicleFuelLevel}/10`} · replacement
          out at {formatKm(swap.newVehicleStartOdometer!)}
          {swap.newVehicleFuelLevel && `, fuel ${swap.newVehicleFuelLevel}/10`}
        </p>
      )}

      {difference !== null && difference > 0 && (
        <p className="text-xs">
          {swap.chargeDifference ? (
            <span className="text-orange-700">
              <span className="font-semibold">+{formatSwapRupees(difference)}</span> + GST, billed at
              drop
            </span>
          ) : (
            <span className="text-gray-500">
              {formatSwapRupees(difference)} price difference waived
            </span>
          )}
        </p>
      )}

      {swap.reasonNotes && (
        <p className="text-xs text-gray-600 italic line-clamp-2" title={swap.reasonNotes}>
          “{swap.reasonNotes}”
        </p>
      )}

      <p className="text-[11px] text-gray-400">
        {format(new Date(swap.swappedAt), "d MMM yyyy, h:mm a")}
        {swap.swappedBy?.name && ` · by ${swap.swappedBy.name}`}
      </p>
    </li>
  );
}
