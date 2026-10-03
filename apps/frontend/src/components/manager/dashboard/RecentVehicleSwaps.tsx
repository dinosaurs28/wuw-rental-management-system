import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
import { ArrowLeftRight, ArrowRight, RefreshCw } from "lucide-react";
import { vehicleSwapService } from "@/services/vehicleSwap.service";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  formatSwapRupees,
  managerSwapPath,
  swapAmount,
  swapStageLabel,
} from "@/components/manager/vehicle-swap/swapFormat";
import { format } from "date-fns";

interface RecentVehicleSwapsProps {
  limit?: number;
}

const RECENT_DAYS = 30;

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

/** Branch-wide swap audit trail for the BM dashboard (last 30 days, newest first). */
export const RecentVehicleSwaps = ({ limit = 5 }: RecentVehicleSwapsProps) => {
  const {
    data: swaps = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    // "vehicle-swaps" prefix: refreshed after any swap made in this app
    queryKey: ["vehicle-swaps", "manager-recent"],
    queryFn: () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
      return vehicleSwapService.getSwapHistory({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const errorMessage = error
    ? apiErrorMessage(error, "Failed to load recent vehicle swaps")
    : null;
  const shown = swaps.slice(0, limit);

  // Stats over the whole 30 days, not just the rows shown
  const totalSwaps = swaps.length;
  const billedTotal = swaps.reduce((sum, swap) => {
    const amount = swapAmount(swap.priceDifference) ?? 0;
    return swap.chargeDifference && amount > 0 ? sum + amount : sum;
  }, 0);
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
    <div className="rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-orange-50 border border-orange-100 p-1.5">
            <ArrowLeftRight className="w-4 h-4 text-orange-600" />
          </div>
          <div>
            <h2 className="font-bold text-[#1a1917] text-sm">Vehicle Swaps</h2>
            <p className="text-[11px] text-[#9ca3af]">Last {RECENT_DAYS} days</p>
          </div>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 text-[11px] font-semibold text-[#e85d04] hover:text-[#c2410c] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats Row */}
      {!isLoading && swaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-b border-[#f0ede8]">
          <div className="flex items-center gap-2">
            <div className="text-xl font-bold text-[#e85d04]">{totalSwaps}</div>
            <div className="text-xs text-[#9ca3af]">Total swaps</div>
          </div>
          {topReason && (
            <>
              <div className="w-px h-6 bg-[#f0ede8]" />
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-xs ${reasonColors[topReason[0]] || reasonColors.OTHER}`}
                >
                  {reasonLabels[topReason[0]] || topReason[0]}
                </Badge>
                <div className="text-xs text-[#9ca3af]">
                  Most common ({topReason[1]})
                </div>
              </div>
            </>
          )}
          {billedTotal > 0 && (
            <>
              <div className="w-px h-6 bg-[#f0ede8]" />
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-[#1a1917]">
                  {formatSwapRupees(billedTotal)}
                </div>
                <div className="text-xs text-[#9ca3af]">Price differences charged (no GST)</div>
              </div>
            </>
          )}
        </div>
      )}

      <div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-[#faf9f7]">
              <TableRow>
                <TableHead className="w-28 pl-5">Date</TableHead>
                <TableHead>Booking</TableHead>
                <TableHead>Vehicle Change</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Price Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-5">
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  </TableRow>
                ))
              ) : errorMessage ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-red-500"
                  >
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : shown.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-[#9ca3af]"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <ArrowLeftRight className="w-8 h-8 text-neutral-300" />
                      <p className="text-sm">No vehicle swaps in the last {RECENT_DAYS} days.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((swap) => {
                  const stage = swapStageLabel(swap.bookingStatusAtSwap);
                  const difference = swapAmount(swap.priceDifference);
                  const customerName = swap.booking?.customer?.user.name;
                  return (
                    <TableRow key={swap.id} className="hover:bg-[#faf9f7]">
                      <TableCell className="text-xs text-[#6b6860] pl-5">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {format(new Date(swap.swappedAt), "MMM dd")}
                          </span>
                          <span className="text-[10px] text-[#9ca3af]">
                            {format(new Date(swap.swappedAt), "hh:mm a")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {swap.booking ? (
                          <div className="flex flex-col">
                            <Link
                              to={managerSwapPath(swap.booking.publicId)}
                              className="font-mono text-xs font-semibold text-[#e85d04] hover:underline"
                              title="Open this booking's swaps"
                            >
                              #{swap.booking.publicId.slice(-6).toUpperCase()}
                            </Link>
                            {customerName && (
                              <span className="text-xs text-[#6b6860] truncate max-w-[10rem]">
                                {customerName}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-neutral-400 text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#1a1917]">
                            {swap.originalVehicle?.regNo ?? "—"}
                            <ArrowRight className="w-3 h-3 text-neutral-400" />
                            {swap.newVehicle?.regNo ?? "—"}
                          </span>
                          {(stage || swap.swappedBy?.name) && (
                            <span className="text-[11px] text-[#9ca3af]">
                              {[stage, swap.swappedBy?.name && `by ${swap.swappedBy.name}`]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
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
                      <TableCell className="text-xs whitespace-nowrap">
                        {difference !== null && difference > 0 ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-[#1a1917]">
                              {formatSwapRupees(difference)}
                            </span>
                            <span className={swap.chargeDifference ? "text-orange-700" : "text-[#9ca3af]"}>
                              {swap.chargeDifference ? "Billed at drop" : "Waived"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};
