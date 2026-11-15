/**
 * Confirm-and-delete for a vehicle (Nov 14 2026), used by the vehicles list and
 * the Edit Vehicle page. The server soft-deletes (the car's rent history is
 * kept) and refuses with a 409 while a booking still needs the car — its
 * message is shown as-is.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteVehicle } from "@/services/vehicle.service";
import { apiMessage } from "@/components/manager/customers/format";

export function DeleteVehicleDialog({
  vehicle,
  onClose,
  onDeleted,
}: {
  vehicle: { publicId: string; make?: string | null; model?: string | null; regNo?: string | null } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "this vehicle" : "";

  const confirm = async () => {
    if (!vehicle) return;
    setBusy(true);
    try {
      await deleteVehicle(vehicle.publicId);
      toast.success(`${vehicle.regNo || name} deleted`);
      onClose();
      onDeleted();
    } catch (e) {
      toast.error(apiMessage(e, "Couldn't delete the vehicle. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={!!vehicle} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}{vehicle?.regNo ? ` (${vehicle.regNo})` : ""}?</AlertDialogTitle>
          <AlertDialogDescription>
            The vehicle is removed from the fleet and can no longer be booked. Its past rentals, photos, damage and
            payments stay in the records. A vehicle with an upcoming booking or out on rent can't be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete vehicle
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
