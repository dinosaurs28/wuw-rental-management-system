import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";

interface DropChargeNoticeProps {
  /** "charged" = billed on the drop settlement; "expense" = company expense, never billed. */
  kind: "charged" | "expense";
  amount: number;
}

/**
 * Replaces the payment settlement for damage staff recorded at drop — the money
 * side is already settled there, so the manager only sets the vehicle status.
 */
export const DropChargeNotice: React.FC<DropChargeNoticeProps> = ({ kind, amount }) => {
  const charged = kind === "charged";
  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground tracking-wide">
          Financial Settlement
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "rounded-lg border p-4 space-y-1",
            charged ? "border-green-200 bg-green-50 text-green-900" : "border-blue-200 bg-blue-50 text-blue-900",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{charged ? "Charged at drop" : "Company expense"}</p>
            <p className="text-lg font-bold">{formatCurrency(amount)}</p>
          </div>
          <p className="text-xs opacity-80">
            {charged
              ? "Already billed to the customer in the drop settlement. Closing this report only sets the vehicle status — nothing is charged again."
              : "Recorded at drop as a company expense and not billed to the customer. Closing this report only sets the vehicle status."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
