import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SWAP_QUERY_PARAM } from "@/components/manager/vehicle-swap/swapFormat";
import { ActiveRentalSwapDialog } from "./ActiveRentalSwapDialog";

interface SwapVehicleActionProps {
  bookingPublicId: string;
  bookingStatus: string;
  role?: "employee" | "manager";
  className?: string;
}

/**
 * "Swap vehicle" header action for an active rental (PICKED_UP). The server
 * refuses — and the dialog explains — when the rental is overdue, the drop
 * bill has been started or an extension is unpaid.
 */
export function SwapVehicleAction({
  bookingPublicId,
  bookingStatus,
  role = "employee",
  className,
}: SwapVehicleActionProps) {
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const active = bookingStatus === "PICKED_UP";
  const requested = searchParams.get(SWAP_QUERY_PARAM) === "1";

  useEffect(() => {
    if (!requested) return;
    if (active) setOpen(true);
    // Open once — drop the flag so a reload or Back doesn't reopen it
    const next = new URLSearchParams(searchParams);
    next.delete(SWAP_QUERY_PARAM);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, active]);

  if (!active) return null;

  return (
    <>
      <Button
        variant="outline"
        className={cn("border-orange-500 text-orange-500 hover:bg-orange-50 px-4", className)}
        onClick={() => setOpen(true)}
      >
        <ArrowLeftRight className="mr-2 h-4 w-4" />
        <span className="hidden sm:inline">Swap vehicle</span>
        <span className="sm:hidden">Swap</span>
      </Button>
      {open && (
        <ActiveRentalSwapDialog
          open={open}
          onOpenChange={setOpen}
          bookingPublicId={bookingPublicId}
          role={role}
        />
      )}
    </>
  );
}
