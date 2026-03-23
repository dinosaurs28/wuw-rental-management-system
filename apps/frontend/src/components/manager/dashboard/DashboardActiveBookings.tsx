import { useEffect, useState } from "react";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {  RefreshCw, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { managerDashboardService } from "@/services/managerDashboard.service";
import type { Booking } from "@/services/managerDashboard.service";

export const DashboardActiveBookings = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  useEffect(() => {
    loadActiveBookings();
  }, [selectedDate]);

  const loadActiveBookings = async () => {
    try {
      setIsLoading(true);
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const response = await managerDashboardService.getActiveBookings(dateStr);
      setBookings(response || []);
    } catch (err: any) {
      console.error("Failed to load active bookings:", err);
      const errorMsg =
        err.response?.data?.message || "Failed to load active bookings";
      toast.error(errorMsg);
      setBookings([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      setIsCalendarOpen(false);
    }
  };

  const handleRefresh = () => {
    loadActiveBookings();
  };

  const isToday =
    format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  return (
    <Card className="border shadow-sm" id="active-bookings-section">
      <CardHeader className="pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-green-600" />
              <CardTitle className="text-lg font-bold">
                Active Bookings
              </CardTitle>
            </div>
            <CardDescription>
              {isToday
                ? "Pickups and active rentals for today"
                : `Pickups and active rentals for ${format(selectedDate, "MMM dd, yyyy")}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Date Picker */}
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 h-9 px-3"
                  size="sm"
                >
                  <CalendarIcon className="w-4 h-4" />
                  <span className="text-sm">
                    {isToday ? "Today" : format(selectedDate, "MMM dd, yyyy")}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            {/* Refresh Button */}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-green-600 hover:text-green-700 hover:bg-green-50 h-9"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        {!isLoading && bookings.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-3 border-t">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-green-600">
                {bookings.length}
              </div>
              <div className="text-xs text-neutral-500">
                Active Booking{bookings.length !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="w-px bg-neutral-200 self-stretch" />
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-blue-50 text-blue-700 border-blue-200 text-xs"
              >
                {bookings.filter((b) => b.status === "CONFIRMED").length}{" "}
                Pending Pickup
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-200 text-xs"
              >
                {bookings.filter((b) => b.status === "ACTIVE").length} Picked
                Up
              </Badge>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-neutral-50/50">
              <TableRow>
                <TableHead className="w-30">Booking ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Pickup Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
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
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-8 w-16" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : bookings.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-neutral-500"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <CalendarIcon className="w-8 h-8 text-neutral-300" />
                      <p>
                        No active bookings found for{" "}
                        {isToday ? "today" : format(selectedDate, "MMM dd, yyyy")}
                        .
                      </p>
                      <p className="text-xs text-neutral-400">
                        Try selecting a different date or check back later.
                      </p>
                    </div>
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
                      <div className="flex flex-col text-xs">
                        <span className="font-medium text-neutral-700">
                          {format(new Date(booking.startDate), "hh:mm a")}
                        </span>
                        <span className="text-neutral-400 text-[10px]">
                          {format(new Date(booking.startDate), "MMM dd")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {booking.status === "CONFIRMED" ? (
                        <Badge
                          variant="outline"
                          className="bg-blue-50 text-blue-700 border-blue-200 uppercase text-[10px] tracking-wide"
                        >
                          Pending Pickup
                        </Badge>
                      ) : booking.status === "ACTIVE" ? (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 uppercase text-[10px] tracking-wide"
                        >
                          Picked Up
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-orange-50 text-orange-700 border-orange-200 uppercase text-[10px] tracking-wide"
                        >
                          {booking.status}
                        </Badge>
                      )}
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
