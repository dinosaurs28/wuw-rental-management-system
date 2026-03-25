import { Info, Car } from "lucide-react";
import { format } from "date-fns";

interface DisplacedBookingBannerProps {
  newVehicleRegNo?: string;
  newVehicleName?: string;
  reassignedAt: string;
}

export function DisplacedBookingBanner({
  newVehicleRegNo,
  newVehicleName,
  reassignedAt,
}: DisplacedBookingBannerProps) {
  const formattedDate = format(new Date(reassignedAt), "dd MMM yyyy, hh:mm a");

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Info className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-blue-800 mb-1">
            Vehicle Reassigned
          </p>
          <p className="text-sm text-blue-700 leading-relaxed">
            This booking's vehicle was changed to accommodate an extension
            request.
            {(newVehicleName || newVehicleRegNo) && (
              <>
                {" "}
                New vehicle:{" "}
                <span className="inline-flex items-center gap-1 font-medium">
                  <Car className="h-3.5 w-3.5" />
                  {newVehicleName && <span>{newVehicleName}</span>}
                  {newVehicleRegNo && (
                    <span className="font-mono">{newVehicleRegNo}</span>
                  )}
                </span>
                .
              </>
            )}
          </p>
          <p className="text-xs text-blue-600 mt-1">
            Reassigned on: {formattedDate}
          </p>
        </div>
      </div>
    </div>
  );
}
