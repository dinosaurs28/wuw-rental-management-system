import React from "react";
import type { AvailableVehicle, SwapContext } from "@/types/vehicleSwap";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { SwapDetailsForm, type SwapDetailsData } from "./SwapDetailsForm";

interface SwapConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVehicle: {
    make: string;
    model: string;
    regNo: string;
    image?: string | null;
  };
  newVehicle: AvailableVehicle;
  /** Reason, notes, maintenance flag, plus readings (mid-rental) and chargeDifference */
  onConfirm: (data: SwapDetailsData) => void;
  isLoading?: boolean;
  /**
   * From GET …/available-vehicles: asks for the handover readings when the
   * booking is PICKED_UP and supplies the "Charge customer" defaults.
   */
  swapContext?: SwapContext | null;
  /** Server refusal of the last attempt */
  errorMessage?: string | null;
}

export const SwapConfirmationModal: React.FC<SwapConfirmationModalProps> = ({
  isOpen,
  onClose,
  currentVehicle,
  newVehicle,
  onConfirm,
  isLoading = false,
  swapContext,
  errorMessage,
}) => {
  const handleClose = () => {
    if (!isLoading) onClose();
  };

  const midRental = swapContext?.readingsRequired === true;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm Vehicle Swap</DialogTitle>
          <DialogDescription>
            {midRental
              ? "The customer hands this vehicle back and continues the rental in the replacement. Record both cars' readings."
              : "Review the vehicle swap details and provide a reason for the change."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Vehicle Comparison */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-4 text-sm text-gray-700">
              Vehicle Change
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
              {/* Current Vehicle */}
              <div className="bg-white p-4 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 mb-2">Current Vehicle</p>
                {currentVehicle.image && (
                  <img
                    src={currentVehicle.image}
                    alt={`${currentVehicle.make} ${currentVehicle.model}`}
                    className="w-full h-24 object-cover rounded mb-2"
                  />
                )}
                <h4 className="font-semibold text-sm">
                  {currentVehicle.make} {currentVehicle.model}
                </h4>
                <p className="text-xs text-gray-600 mt-1">
                  {currentVehicle.regNo}
                </p>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ArrowRight className="w-6 h-6 text-gray-400" />
              </div>

              {/* New Vehicle */}
              <div className="bg-white p-4 rounded-lg border border-blue-200 ring-2 ring-blue-100">
                <p className="text-xs text-blue-600 mb-2 font-medium">
                  New Vehicle
                </p>
                {newVehicle.images[0]?.url && (
                  <img
                    src={newVehicle.images[0].url}
                    alt={`${newVehicle.make} ${newVehicle.model}`}
                    className="w-full h-24 object-cover rounded mb-2"
                  />
                )}
                <h4 className="font-semibold text-sm">
                  {newVehicle.make} {newVehicle.model}
                </h4>
                <p className="text-xs text-gray-600 mt-1">{newVehicle.regNo}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <p className="text-xs text-gray-500">{newVehicle.categoryName}</p>
                  {newVehicle.isUpgrade && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200"
                    >
                      Upgrade
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Reason, readings, price difference, maintenance flag */}
          <SwapDetailsForm
            key={newVehicle.id}
            newVehicle={newVehicle}
            currentVehicleRegNo={currentVehicle.regNo}
            swapContext={swapContext}
            isSubmitting={isLoading}
            errorMessage={errorMessage}
            onCancel={handleClose}
            onSubmit={onConfirm}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
