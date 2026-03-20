import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, ArrowRight, RefreshCw } from "lucide-react";
import { vehicleSwapService } from "@/services/vehicleSwap.service";
import type { VehicleSwap } from "@/types/vehicleSwap";
import { format } from "date-fns";
import { toast } from "sonner";

interface RecentVehicleSwapsProps {
  limit?: number;
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

export const RecentVehicleSwaps = ({ limit = 5 }: RecentVehicleSwapsProps) => {
  const [swaps, setSwaps] = useState<VehicleSwap[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecentSwaps();
  }, []);

  const loadRecentSwaps = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Get swaps from last 30 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const allSwaps = await vehicleSwapService.getSwapHistory({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      // Take only the most recent ones based on limit
      setSwaps(allSwaps.slice(0, limit));
    } catch (err: any) {
      console.error("Failed to load recent swaps:", err);
      const errorMsg =
        err.response?.data?.message || "Failed to load recent vehicle swaps";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate stats
  const totalSwaps = swaps.length;
  const swapsByReason = swaps.reduce(
    (acc, swap) => {
      acc[swap.reason] = (acc[swap.reason] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const topReason = Object.entries(swapsByReason).sort(
    (a, b) => b[1] - a[1],
  )[0];

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-row items-center justify-between mb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-orange-600" />
              <CardTitle className="text-lg font-bold">
                Recent Vehicle Swaps
              </CardTitle>
            </div>
            <CardDescription>
              Recent vehicle changes in last 30 days
            </CardDescription>
          </div>
          {swaps.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
              onClick={loadRecentSwaps}
            >
              Refresh <ArrowUpRight className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Stats Row */}
        {!isLoading && swaps.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-3 border-t">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-orange-600">
                {totalSwaps}
              </div>
              <div className="text-xs text-neutral-500">Total Swaps</div>
            </div>
            {topReason && (
              <>
                <div className="w-px bg-neutral-200 self-stretch" />
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-xs ${reasonColors[topReason[0]] || reasonColors.OTHER}`}
                  >
                    {reasonLabels[topReason[0]] || topReason[0]}
                  </Badge>
                  <div className="text-xs text-neutral-500">
                    Most Common ({topReason[1]})
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-neutral-50/50">
              <TableRow>
                <TableHead className="w-30">Date</TableHead>
                <TableHead>Original Vehicle</TableHead>
                <TableHead className="w-8"></TableHead>
                <TableHead>New Vehicle</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Booking ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-4" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-red-500"
                  >
                    {error}
                  </TableCell>
                </TableRow>
              ) : swaps.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-neutral-500"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-8 h-8 text-neutral-300" />
                      <p>No vehicle swaps in the last 30 days.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                swaps.map((swap) => (
                  <TableRow key={swap.id} className="group">
                    <TableCell className="text-xs text-neutral-600">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {format(new Date(swap.swappedAt), "MMM dd")}
                        </span>
                        <span className="text-[10px] text-neutral-400">
                          {format(new Date(swap.swappedAt), "hh:mm a")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {swap.originalVehicle ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">
                            {swap.originalVehicle.make}{" "}
                            {swap.originalVehicle.model}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {swap.originalVehicle.regNo}
                          </span>
                        </div>
                      ) : (
                        <span className="text-neutral-400 text-sm">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="w-4 h-4 text-neutral-400" />
                    </TableCell>
                    <TableCell>
                      {swap.newVehicle ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">
                            {swap.newVehicle.make} {swap.newVehicle.model}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {swap.newVehicle.regNo}
                          </span>
                        </div>
                      ) : (
                        <span className="text-neutral-400 text-sm">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase tracking-wide ${
                          reasonColors[swap.reason] || reasonColors.OTHER
                        }`}
                      >
                        {reasonLabels[swap.reason] || swap.reason}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-neutral-500">
                        {swap.bookingId || "N/A"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
