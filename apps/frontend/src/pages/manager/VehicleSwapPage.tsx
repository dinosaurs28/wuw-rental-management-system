import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useVehicleSwap } from "@/hooks/useVehicleSwap";
import { vehicleSwapService, type BookingVehicleDetails } from "@/services/vehicleSwap.service";
import { AvailableVehiclesList } from "@/components/manager/vehicle-swap/AvailableVehiclesList";
import { SwapConfirmationModal } from "@/components/manager/vehicle-swap/SwapConfirmationModal";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { SwapReason } from "@/types/vehicleSwap";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const VehicleSwapPage = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const { availableVehicles, loading, fetchAvailableVehicles, performSwap } =
    useVehicleSwap(bookingId!);

  const [selectedVehicle, setSelectedVehicle] =
    useState<AvailableVehicle | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [currentVehicle, setCurrentVehicle] =
    useState<BookingVehicleDetails | null>(null);

  useEffect(() => {
    if (!bookingId) return;

    fetchAvailableVehicles();

    vehicleSwapService
      .getBookingVehicleDetails(bookingId)
      .then((details) => setCurrentVehicle(details))
      .catch((err) =>
        console.error("Failed to fetch booking vehicle details:", err),
      );
  }, [bookingId, fetchAvailableVehicles]);

  const handleSelectVehicle = (vehicle: AvailableVehicle) => {
    setSelectedVehicle(vehicle);
    setShowConfirmModal(true);
  };

  const handleConfirmSwap = async (swapData: {
    reason: SwapReason;
    reasonNotes?: string;
    markOriginalForMaintenance?: boolean;
    originalVehicleNotes?: string;
  }) => {
    if (!selectedVehicle) return;

    setIsSwapping(true);
    try {
      const result = await performSwap({
        newVehicleId: selectedVehicle.id,
        ...swapData,
      });

      if (result) {
        setShowConfirmModal(false);
        setSelectedVehicle(null);
        // Navigate back to bookings or dashboard
        toast.success("Vehicle swapped successfully!");
        setTimeout(() => {
          navigate("/manager/dashboard");
        }, 1500);
      }
    } catch (error) {
      console.error("Swap error:", error);
    } finally {
      setIsSwapping(false);
    }
  };

  const handleCloseModal = () => {
    if (!isSwapping) {
      setShowConfirmModal(false);
      setSelectedVehicle(null);
    }
  };

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
              <BreadcrumbPage>Swap Vehicle</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Swap Vehicle</h1>
            <p className="text-muted-foreground mt-1">
              Select a new vehicle to swap for booking {bookingId}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Button>
        </div>

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
        {!loading && availableVehicles.length === 0 && (
          <Alert className="border-yellow-200 bg-yellow-50">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              <p className="font-medium mb-2">
                No available vehicles found for swap
              </p>
              <p className="text-sm">
                All vehicles are either in use, not in the same branch, or not
                suitable for this booking. Vehicles must be in the same or
                higher category to be eligible for swap.
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
                Select a vehicle from the same or higher category to swap
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

        {/* Confirmation Modal */}
        {selectedVehicle && currentVehicle && (
          <SwapConfirmationModal
            isOpen={showConfirmModal}
            onClose={handleCloseModal}
            onConfirm={handleConfirmSwap}
            currentVehicle={currentVehicle}
            newVehicle={selectedVehicle}
            isLoading={isSwapping}
          />
        )}
      </div>
    </ManagerLayout>
  );
};
