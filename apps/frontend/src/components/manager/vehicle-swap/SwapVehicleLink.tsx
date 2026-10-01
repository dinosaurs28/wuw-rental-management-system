import { Link } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SwapVehicleLinkProps {
  /** Where the swap flow lives for this role / booking */
  to: string;
  label?: string;
  className?: string;
}

/** Small "Swap" entry on booking rows (Fleet dashboard, BM fleet status). */
export function SwapVehicleLink({ to, label = "Swap", className }: SwapVehicleLinkProps) {
  return (
    <Button asChild variant="outline" size="sm" className={cn("gap-1.5", className)}>
      <Link to={to} title="Swap the vehicle on this rental">
        <ArrowLeftRight className="h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  );
}
