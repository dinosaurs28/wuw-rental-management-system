import React from "react";
import type { VehicleSwap } from "@/types/vehicleSwap";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";

interface SwapHistoryTableProps {
  swaps: VehicleSwap[];
  isLoading?: boolean;
}

const reasonLabels: Record<string, string> = {
  CUSTOMER_REQUEST: "Customer Request",
  MAINTENANCE: "Maintenance",
  UPGRADE: "Upgrade",
  DOWNGRADE: "Downgrade",
  DAMAGE: "Damage",
  OTHER: "Other",
};

const reasonColors: Record<string, string> = {
  CUSTOMER_REQUEST: "bg-blue-50 text-blue-700 border-blue-200",
  MAINTENANCE: "bg-orange-50 text-orange-700 border-orange-200",
  UPGRADE: "bg-green-50 text-green-700 border-green-200",
  DOWNGRADE: "bg-purple-50 text-purple-700 border-purple-200",
  DAMAGE: "bg-red-50 text-red-700 border-red-200",
  OTHER: "bg-gray-50 text-gray-700 border-gray-200",
};

export const SwapHistoryTable: React.FC<SwapHistoryTableProps> = ({
  swaps,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swap History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (swaps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swap History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <p>No vehicle swaps recorded yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Swap History ({swaps.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Date & Time</TableHead>
                <TableHead>Original Vehicle</TableHead>
                <TableHead className="w-8"></TableHead>
                <TableHead>New Vehicle</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Performed By</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {swaps.map((swap) => (
                <TableRow key={swap.id} className="hover:bg-gray-50">
                  <TableCell className="text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {format(new Date(swap.swappedAt), "MMM dd, yyyy")}
                      </span>
                      <span className="text-xs text-gray-500">
                        {format(new Date(swap.swappedAt), "hh:mm a")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {swap.originalVehicle ? (
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">
                          {swap.originalVehicle.make} {swap.originalVehicle.model}
                        </span>
                        <span className="text-xs text-gray-600">
                          {swap.originalVehicle.regNo}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </TableCell>
                  <TableCell>
                    {swap.newVehicle ? (
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">
                          {swap.newVehicle.make} {swap.newVehicle.model}
                        </span>
                        <span className="text-xs text-gray-600">
                          {swap.newVehicle.regNo}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${reasonColors[swap.reason] || reasonColors.OTHER}`}
                    >
                      {reasonLabels[swap.reason] || swap.reason}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {swap.swappedBy ? (
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {swap.swappedBy.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {swap.swappedBy.email}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {swap.reasonNotes ? (
                      <p className="text-sm text-gray-700 line-clamp-2" title={swap.reasonNotes}>
                        {swap.reasonNotes}
                      </p>
                    ) : (
                      <span className="text-gray-400 text-sm">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
