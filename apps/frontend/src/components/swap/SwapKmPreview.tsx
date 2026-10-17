import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { apiErrorMessage } from "@/lib/counterErrors";
import { employeeVehicleSwapService, vehicleSwapService } from "@/services/vehicleSwap.service";
import { formatKm, swapAmount } from "@/components/manager/vehicle-swap/swapFormat";

const rupees = (value: string | null) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
    swapAmount(value) ?? 0,
  );

interface SwapKmPreviewProps {
  bookingId: string;
  role: "employee" | "manager";
  /** The returning car's typed end odometer (null = not a valid reading yet) */
  endOdometer: number | null;
  /** Its start reading this segment — readings below it aren't sent (the form shows the error) */
  segmentStart: number | null;
  /** The chosen replacement: the drop prices the booking's km on it */
  newVehicleId: number;
  regNo: string;
}

/**
 * The returning car's km at a mid-rental swap, worked out by the server with
 * the drop's rule as staff type its odometer: km driven this segment, the free
 * km left for it, and the extra km and ₹ — recorded with the swap and billed at drop.
 */
export function SwapKmPreview({ bookingId, role, endOdometer, segmentStart, newVehicleId, regNo }: SwapKmPreviewProps) {
  const debounced = useDebounce(endOdometer, 350);
  const ready = debounced !== null && (segmentStart === null || debounced >= segmentStart);
  const service = role === "manager" ? vehicleSwapService : employeeVehicleSwapService;
  const query = useQuery({
    queryKey: ["swap-km-preview", role, bookingId, debounced, newVehicleId],
    queryFn: () => service.previewSwapKm(bookingId, debounced!, newVehicleId),
    enabled: !!bookingId && ready,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (endOdometer === null || !ready) return null;
  const typing = debounced !== endOdometer;

  if (query.isLoading || (typing && !query.data)) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" /> Working out the km on {regNo}…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-700">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        {apiErrorMessage(query.error, "Couldn't work out the km for this swap.")}
      </p>
    );
  }
  const km = query.data;
  if (!km) return null;
  if (!km.available) {
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          {formatKm(km.kmDriven)} driven on {regNo}. {km.unavailableReason}
        </span>
      </div>
    );
  }

  const extra = km.extraKm ?? 0;
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 text-xs space-y-1 transition-opacity",
        extra > 0 ? "border-orange-200 bg-orange-50" : "border-gray-200 bg-gray-50",
        typing && "opacity-60",
      )}
      aria-live="polite"
    >
      <p className="flex items-center gap-1.5 text-gray-700">
        <Route className="h-3.5 w-3.5 text-gray-500 shrink-0" />
        <span>
          Driven <span className="font-semibold">{formatKm(km.kmDriven)}</span>
          {km.allowanceKm != null && <> · free km left for it {formatKm(km.allowanceKm)}</>}
          {km.priorKm > 0 && km.includedKm != null && (
            <span className="text-gray-500"> (of {formatKm(km.includedKm)}; earlier cars used {formatKm(km.priorKm)})</span>
          )}
        </span>
      </p>
      {extra > 0 ? (
        <p className="font-semibold text-orange-800">
          Extra km on {regNo}: {extra.toLocaleString("en-IN")} km ·{" "}
          {km.extraKmEnabled
            ? `${rupees(km.extraKmCharge)} — billed at drop`
            : "₹0 — extra km isn't charged at this branch"}
        </p>
      ) : (
        <p className="text-gray-600">No extra km on {regNo} — within the free km.</p>
      )}
      {extra > 0 && km.extraKmEnabled && km.extraKmRate && (
        <p className="text-gray-500">At {rupees(km.extraKmRate)}/km, recorded with the swap.</p>
      )}
    </div>
  );
}
