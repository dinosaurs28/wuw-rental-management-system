import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface VehicleDispositionProps {
  disposition: "AVAILABLE" | "MAINTENANCE" | "DAMAGED";
  setDisposition: (value: "AVAILABLE" | "MAINTENANCE" | "DAMAGED") => void;
}

export const VehicleDisposition: React.FC<VehicleDispositionProps> = ({
  disposition,
  setDisposition,
}) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground tracking-wide">
          Review Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="disposition">Vehicle Status Post-Closing</Label>
          <Select
            value={disposition}
            onValueChange={(val) => setDisposition(val as any)}
          >
            <SelectTrigger id="disposition">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AVAILABLE">
                Mark as Available (Minor cosmetic only)
              </SelectItem>
              <SelectItem value="MAINTENANCE">
                Send to Maintenance (Repairs needed)
              </SelectItem>
              <SelectItem value="DAMAGED">
                Mark as Damaged / Out of Service
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-gray-500">
            Determines if this vehicle can be booked immediately after this
            process.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
