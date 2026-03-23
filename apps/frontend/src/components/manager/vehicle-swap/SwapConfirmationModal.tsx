import React, { useState } from "react";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { SwapReason } from "@/types/vehicleSwap";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight } from "lucide-react";

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
  onConfirm: (data: {
    reason: SwapReason;
    reasonNotes?: string;
    markOriginalForMaintenance?: boolean;
    originalVehicleNotes?: string;
  }) => void;
  isLoading?: boolean;
}

export const SwapConfirmationModal: React.FC<SwapConfirmationModalProps> = ({
  isOpen,
  onClose,
  currentVehicle,
  newVehicle,
  onConfirm,
  isLoading = false,
}) => {
  const [reason, setReason] = useState<SwapReason | "">("");
  const [reasonNotes, setReasonNotes] = useState("");
  const [markOriginalForMaintenance, setMarkOriginalForMaintenance] =
    useState(false);
  const [originalVehicleNotes, setOriginalVehicleNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;

    onConfirm({
      reason: reason as SwapReason,
      reasonNotes: reasonNotes || undefined,
      markOriginalForMaintenance: markOriginalForMaintenance || undefined,
      originalVehicleNotes:
        markOriginalForMaintenance && originalVehicleNotes
          ? originalVehicleNotes
          : undefined,
    });
  };

  const handleClose = () => {
    if (!isLoading) {
      // Reset form
      setReason("");
      setReasonNotes("");
      setMarkOriginalForMaintenance(false);
      setOriginalVehicleNotes("");
      onClose();
    }
  };

  const reasonOptions = [
    { value: SwapReason.CUSTOMER_REQUEST, label: "Customer Request" },
    { value: SwapReason.MAINTENANCE, label: "Maintenance Required" },
    { value: SwapReason.UPGRADE, label: "Vehicle Upgrade" },
    { value: SwapReason.DOWNGRADE, label: "Vehicle Downgrade" },
    { value: SwapReason.DAMAGE, label: "Vehicle Damage" },
    { value: SwapReason.OTHER, label: "Other" },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm Vehicle Swap</DialogTitle>
          <DialogDescription>
            Review the vehicle swap details and provide a reason for the change.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
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
                <p className="text-xs text-gray-500 mt-1">
                  {newVehicle.categoryName}
                </p>
              </div>
            </div>
          </div>

          {/* Swap Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason" className="text-sm font-medium">
              Reason for Swap <span className="text-red-500">*</span>
            </Label>
            <Select
              value={reason}
              onValueChange={(value) => setReason(value as SwapReason)}
            >
              <SelectTrigger id="reason" className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {reasonOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reason Notes */}
          <div className="space-y-2">
            <Label htmlFor="reasonNotes" className="text-sm font-medium">
              Additional Notes
            </Label>
            <Textarea
              id="reasonNotes"
              placeholder="Provide any additional context for this swap..."
              value={reasonNotes}
              onChange={(e) => setReasonNotes(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Mark for Maintenance */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="markMaintenance"
                checked={markOriginalForMaintenance}
                onCheckedChange={(checked) =>
                  setMarkOriginalForMaintenance(checked as boolean)
                }
              />
              <Label
                htmlFor="markMaintenance"
                className="text-sm font-medium cursor-pointer"
              >
                Mark original vehicle for maintenance
              </Label>
            </div>

            {/* Conditional Original Vehicle Notes */}
            {markOriginalForMaintenance && (
              <div className="space-y-2 ml-6 pl-4 border-l-2 border-gray-200">
                <Label
                  htmlFor="originalVehicleNotes"
                  className="text-sm font-medium"
                >
                  Maintenance Notes <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="originalVehicleNotes"
                  placeholder="Describe the issues or maintenance required..."
                  value={originalVehicleNotes}
                  onChange={(e) => setOriginalVehicleNotes(e.target.value)}
                  rows={3}
                  className="resize-none"
                  required={markOriginalForMaintenance}
                />
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !reason ||
                isLoading ||
                (markOriginalForMaintenance && !originalVehicleNotes)
              }
            >
              {isLoading ? "Processing..." : "Confirm Swap"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
