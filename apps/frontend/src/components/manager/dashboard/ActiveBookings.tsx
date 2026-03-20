import { Link } from "react-router-dom";
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
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { type Booking } from "@/services/managerDashboard.service";

interface ActiveBookingsProps {
  bookings?: Booking[];
  isLoading?: boolean;
}

export const ActiveBookings = ({
  bookings = [],
  isLoading = false,
}: ActiveBookingsProps) => {
  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div className="space-y-1">
          <CardTitle className="text-lg font-bold">Active Bookings</CardTitle>
          <CardDescription>Currently active vehicle rentals</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
          asChild
        >
          <Link to="/manager/bookings">
            View All <ArrowUpRight className="w-4 h-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-neutral-50/50">
              <TableRow>
                <TableHead className="w-[140px]">Booking ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-16 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : bookings.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-neutral-500"
                  >
                    No active bookings found.
                  </TableCell>
                </TableRow>
              ) : (
                bookings.map((booking) => (
                  <TableRow key={booking.id} className="group">
                    <TableCell className="font-mono text-xs font-medium text-neutral-500">
                      {booking.id.substring(0, 8)}...
                    </TableCell>
                    <TableCell className="font-medium">
                      {booking.customerName}
                    </TableCell>
                    <TableCell className="text-neutral-600">
                      {booking.vehicleName}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col text-xs text-neutral-500">
                        <span>
                          {new Date(booking.startDate).toLocaleDateString()}
                        </span>
                        <span className="text-neutral-400 text-[10px]">to</span>
                        <span>
                          {new Date(booking.endDate).toLocaleDateString()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-700 border-green-200 uppercase text-[10px] tracking-wide"
                      >
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs bg-white gap-1"
                          asChild
                        >
                          <Link
                            to={`/manager/bookings/${booking.id}/swap-vehicle`}
                          >
                            <RefreshCw className="w-3 h-3" />
                            Swap
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs bg-white"
                          asChild
                        >
                          <Link to={`/manager/bookings/${booking.id}`}>
                            Details
                          </Link>
                        </Button>
                      </div>
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
