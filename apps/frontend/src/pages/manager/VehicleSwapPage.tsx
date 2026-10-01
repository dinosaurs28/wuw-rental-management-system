import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { vehicleSwapService } from "@/services/vehicleSwap.service";
import { AvailableVehiclesList } from "@/components/manager/vehicle-swap/AvailableVehiclesList";
import { SwapConfirmationModal } from "@/components/manager/vehicle-swap/SwapConfirmationModal";
import { SwapHistoryTable } from "@/components/manager/vehicle-swap/SwapHistoryTable";
import type { SwapDetailsData } from "@/components/manager/vehicle-swap/SwapDetailsForm";
import {
  SWAP_PICK_AGAIN_CODES,
  swapAmount,
  swapErrorCode,
} from "@/components/manager/vehicle-swap/swapFormat";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { apiErrorMessage } from "@/lib/counterErrors";
import { cn } from "@/lib/utils";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, AlertCircle, Car } from "lucide-react";
import { toast } from "sonner";

/**
 * BM vehicle swap for one booking — before pickup (CONFIRMED) or during the
 * rental (PICKED_UP: handover readings + price difference), plus the booking's
 * swap history.
 */
export const VehicleSwapPage = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedVehicle, setSelectedVehicle] =
    useState<AvailableVehicle | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  const candidatesQuery = useQuery({
    queryKey: ["vehicle-swap-candidates", "manager", bookingId],
    queryFn: () => vehicleSwapService.getSwapCandidates(bookingId!),
    enabled: !!bookingId,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const vehicleDetailsQuery = useQuery({
    queryKey: ["manager-booking-vehicle", bookingId],
    queryFn: () => vehicleSwapService.getBookingVehicleDetails(bookingId!),
    enabled: !!bookingId,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const historyQuery = useQuery({
    queryKey: ["vehicle-swaps", "manager", bookingId],
    queryFn: () => vehicleSwapService.getBookingSwapHistory(bookingId!),
    enabled: !!bookingId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const availableVehicles = candidatesQuery.data?.vehicles ?? [];
  const swapContext = candidatesQuery.data?.swapContext ?? null;
  const activeRental = swapContext?.stage === "ACTIVE_RENTAL";
  const remainingPct = swapContext
    ? Math.round((swapAmount(swapContext.remainingFraction) ?? 0) * 100)
    : null;
  const details = vehicleDetailsQuery.data ?? null;
  // Thumbnail from vehicle-details; names from either source
  const currentVehicle = details
    ? details
    : swapContext
      ? {
          make: swapContext.currentVehicle.make,
          model: swapContext.currentVehicle.model,
          regNo: swapContext.currentVehicle.regNo,
          image: null,
        }
      : null;

  const swapMutation = useMutation({
    mutationFn: ({ vehicleId, data }: { vehicleId: number; data: SwapDetailsData }) =>
      vehicleSwapService.performSwap(bookingId!, { newVehicleId: vehicleId, ...data }),
    onSuccess: (swap) => {
      const from = swap.originalVehicle?.regNo;
      const to = swap.newVehicle?.regNo;
      toast.success(from && to ? `Vehicle swapped: ${from} → ${to}` : "Vehicle swapped successfully!");
      setSelectedVehicle(null);
      setSwapError(null);
      queryClient.invalidateQueries({ queryKey: ["vehicle-swap-candidates", "manager", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["manager-booking-vehicle", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-swaps"] });
      queryClient.invalidateQueries({ queryKey: ["manager-fleet-status"] });
    },
    onError: (err) => {
      const message = apiErrorMessage(err, "Failed to swap vehicle");
      toast.error(message);
      if (SWAP_PICK_AGAIN_CODES.has(swapErrorCode(err) ?? "")) {
        // The car was taken (or the booking changed) — reload the list
        setSelectedVehicle(null);
        setSwapError(null);
        void candidatesQuery.refetch();
      } else {
        setSwapError(message);
      }
    },
  });

  const handleSelectVehicle = (vehicle: AvailableVehicle) => {
    setSwapError(null);
    setSelectedVehicle(vehicle);
  };

  const handleConfirmSwap = (swapData: SwapDetailsData) => {
    if (!selectedVehicle) return;
    setSwapError(null);
    swapMutation.mutate({ vehicleId: selectedVehicle.id, data: swapData });
  };

  const handleCloseModal = () => {
    if (!swapMutation.isPending) {
      setSelectedVehicle(null);
      setSwapError(null);
    }
  };

  const loading = candidatesQuery.isLoading;

  return (
    <ManagerLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/manager/dashboard">
                Dashboard
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/manager/fleet">Fleet Status</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Swap Vehicle</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">Swap Vehicle</h1>
            <p className="text-muted-foreground mt-1 truncate">
              Select a new vehicle for booking{" "}
              <span className="font-mono text-foreground">{bookingId}</span>
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="gap-2 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Button>
        </div>

        {/* Current vehicle + booking window */}
        {(currentVehicle || swapContext) && (
          <Card>
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded border bg-gray-50 flex items-center justify-center">
                  {currentVehicle?.image ? (
                    <img
                      src={currentVehicle.image}
                      alt={`${currentVehicle.make} ${currentVehicle.model}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Car className="h-5 w-5 text-gray-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Current vehicle</p>
                  <p className="font-semibold truncate">
                    {currentVehicle ? `${currentVehicle.make} ${currentVehicle.model}` : "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-mono">{currentVehicle?.regNo ?? "—"}</span>
                    {swapContext && ` · ${swapContext.currentVehicle.categoryName}`}
                  </p>
                </div>
              </div>
              {swapContext && (
                <div className="flex flex-col items-start md:items-end gap-1 text-sm">
                  <Badge
                    variant="outline"
                    className={cn(
                      "uppercase text-[10px] tracking-wide",
                      activeRental
                        ? "bg-orange-50 text-orange-700 border-orange-200"
                        : "bg-blue-50 text-blue-700 border-blue-200",
                    )}
                  >
                    {activeRental ? "Active rental" : "Before pickup"}
                  </Badge>
                  <span className="text-muted-foreground">
                    {format(new Date(swapContext.startAt), "d MMM, h:mm a")} –{" "}
                    {format(new Date(swapContext.endAt), "d MMM, h:mm a")}
                    {remainingPct !== null && ` · ${remainingPct}% left`}
                  </span>
                  {activeRental && (
                    <span className="text-xs text-muted-foreground">
                      Handover readings for both cars are required.
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Prices couldn't be worked out — swaps still allowed, uncharged */}
        {swapContext && !swapContext.pricingAvailable && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              Price differences couldn't be worked out
              {swapContext.pricingError ? `: ${swapContext.pricingError}` : "."} You can still
              swap, without charging the customer.
            </AlertDescription>
          </Alert>
        )}

        {/* Booking can't be swapped right now (returned, overdue, drop bill started…) */}
        {candidatesQuery.isError && (
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              <p className="font-medium mb-1">This booking can't be swapped right now</p>
              <p className="text-sm">
                {apiErrorMessage(candidatesQuery.error, "Failed to fetch available vehicles")}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {loading && availableVehicles.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Loading Available Vehicles...</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="h-32 w-full rounded" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* No Vehicles Available */}
        {!loading && !candidatesQuery.isError && availableVehicles.length === 0 && (
          <Alert className="border-yellow-200 bg-yellow-50">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              <p className="font-medium mb-2">
                No available vehicles found for swap
              </p>
              <p className="text-sm">
                A replacement must be in this branch, the same vehicle type
                (2-wheeler or 4-wheeler), the same or a higher category,
                available until the booking ends and insured past it.
              </p>
              <Button
                onClick={() => navigate(-1)}
                className="mt-4"
                variant="outline"
                size="sm"
              >
                Go Back
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Available Vehicles List */}
        {!loading && availableVehicles.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Available Vehicles ({availableVehicles.length})
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Same category first; higher categories are marked Upgrade. Price
                differences cover the rest of the rental, before GST.
              </p>
            </CardHeader>
            <CardContent>
              <AvailableVehiclesList
                vehicles={availableVehicles}
                onSelectVehicle={handleSelectVehicle}
                selectedVehicleId={selectedVehicle?.id}
              />
            </CardContent>
          </Card>
        )}

        {/* This booking's swaps */}
        <SwapHistoryTable
          swaps={historyQuery.data ?? []}
          isLoading={historyQuery.isLoading}
        />

        {/* Confirmation Modal */}
        {selectedVehicle && currentVehicle && (
          <SwapConfirmationModal
            isOpen={!!selectedVehicle}
            onClose={handleCloseModal}
            onConfirm={handleConfirmSwap}
            currentVehicle={currentVehicle}
            newVehicle={selectedVehicle}
            isLoading={swapMutation.isPending}
            swapContext={swapContext}
            errorMessage={swapError}
          />
        )}
      </div>
    </ManagerLayout>
  );
};
