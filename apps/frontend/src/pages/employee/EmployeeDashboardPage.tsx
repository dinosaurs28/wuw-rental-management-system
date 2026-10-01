import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Plus, Calendar as CalendarIcon, QrCode, RefreshCw } from "lucide-react";
import { motion } from "motion/react";

import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import {
  bookingService,
  type EmployeeBooking,
} from "@/services/booking.service";
import { employeeService } from "@/services/employee.service";
import { useQuery } from "@tanstack/react-query";
import type { BookingListCounts, BookingListType } from "@/types/overdueReturns";


import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { BookingTable } from "@/components/employee/BookingTable";
import { OverdueReturnsTable } from "@/components/employee/OverdueReturnsTable";
import { QrScannerModal } from "@/components/employee/QrScannerModal";
import { DashboardStats } from "@/components/employee/DashboardStats";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import {
  refreshActiveShift,
  useActiveShift,
} from "@/components/employee/counter/useActiveShift";
import { usePaymentStore } from "@/store/payment.store";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type QueueFilter = "PICKUP" | "RETURN" | "OVERDUE";

// `?tab=` keeps the open list across reloads and back-navigation from a return.
const TAB_PARAM: Record<QueueFilter, string> = {
  PICKUP: "pickups",
  RETURN: "returns",
  OVERDUE: "overdue",
};

const filterFromParam = (value: string | null): QueueFilter =>
  value === "returns" ? "RETURN" : value === "overdue" ? "OVERDUE" : "PICKUP";

/** Overdue rows fetched in one go — the list is sorted most overdue first. */
const OVERDUE_LIMIT = 200;

export default function EmployeeDashboardPage() {
  // Navigation fixed to point to /staff/pickups/:bookingId
  const navigate = useNavigate();
  const { isAuthenticated } = useEmployeeAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [date, setDate] = useState<Date>(new Date());
  const filter = filterFromParam(searchParams.get("tab"));
  const bookingType: BookingListType =
    searchParams.get("type")?.toUpperCase() === "MONTHLY" ? "MONTHLY" : "DAILY";
  const [bookings, setBookings] = useState<EmployeeBooking[]>([]);
  const [counts, setCounts] = useState<BookingListCounts | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [showShiftNotice, setShowShiftNotice] = useState(false);
  const { needsShift } = useActiveShift();
  // Drops responses that arrive after a newer tab/date was picked.
  const requestSeq = useRef(0);
  // Pickup/return queue + date the current counts belong to.
  const countsKey = useRef<string | null>(null);

  const updateParams = (patch: Record<string, string>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };
  const setFilter = (next: QueueFilter) => updateParams({ tab: TAB_PARAM[next] });
  const setBookingType = (next: BookingListType) =>
    updateParams({ type: next.toLowerCase() });

  // Dashboard Stats Query
  const {
    data: stats,
    isLoading: isStatsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["employee-dashboard-stats"],
    queryFn: () => employeeService.getDashboardStats(),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
    // The overdue tile must track the overdue list, which ages by the minute.
    refetchInterval: 60_000,
    refetchOnMount: "always",
  });

  // Overdue / no-show returns — not tied to the selected date. Polled so new
  // overdue rentals appear and returned/extended ones drop off.
  const overdueQuery = useQuery({
    queryKey: ["employee-overdue-returns"],
    queryFn: () => employeeService.getOverdueReturns({ limit: OVERDUE_LIMIT }),
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    refetchOnMount: "always",
  });
  const overdueCount =
    overdueQuery.data?.overdueCount ?? stats?.overdueReturns ?? null;

  // Auth Check
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/employee/sign-in");
      toast.error("Please sign in to access the dashboard");
    }
  }, [isAuthenticated, navigate]);

  // Fetch the pickup / return queue for the open Daily or Monthly tab.
  // (The Overdue tab is served by overdueQuery.)
  const fetchData = async () => {
    if (filter === "OVERDUE") return;
    const seq = ++requestSeq.current;
    const key = `${filter}|${format(date, "yyyy-MM-dd")}`;
    // Counts from another queue or date would mislabel the tabs while loading.
    if (countsKey.current !== key) setCounts(null);
    setIsLoading(true);
    try {
      const result =
        filter === "PICKUP"
          ? await bookingService.getEmployeePickupQueue(date, bookingType)
          : await bookingService.getEmployeeReturnQueue(date, bookingType);
      if (seq !== requestSeq.current) return;
      setBookings(result.data);
      setCounts(result.counts);
      countsKey.current = key;
    } catch (error) {
      if (seq !== requestSeq.current) return;
      console.error(error);
      const message = isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : undefined;
      toast.error(message || "Failed to fetch bookings");
      setBookings([]);
      setCounts(null);
      countsKey.current = null;
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [date, filter, bookingType, isAuthenticated]);

  const handleRefresh = () => {
    fetchData();
    overdueQuery.refetch();
    refetchStats();
  };

  // Walk-in bookings need an open cash shift — explain and offer to open one.
  const handleNewBooking = async () => {
    if (needsShift) {
      // Re-check first: the shift may have been opened on another device.
      await refreshActiveShift();
      if (!usePaymentStore.getState().activeShift) {
        setShowShiftNotice(true);
        return;
      }
    }
    navigate("/employee/new-booking");
  };

  const handleAction = async (bookingId: string) => {
    try {
      // RETURN and OVERDUE rows both open the drop flow.
      if (filter === "PICKUP") {
        navigate(`/staff/pickups/${bookingId}`);
      } else {
        navigate(`/employee/dashboard/return/${bookingId}`);
      }
    } catch (error) {
      console.error(error);
      toast.error("Action failed");
    }
  };

  const handleQrScan = async (data: string | null) => {
    if (!data) return;

    // Parse optional prefix written by BookingQRModal
    let scannedIntent: "pickup" | "return" | null = null;
    let bookingId = data;
    if (data.startsWith("pickup:")) {
      scannedIntent = "pickup";
      bookingId = data.slice("pickup:".length);
    } else if (data.startsWith("return:")) {
      scannedIntent = "return";
      bookingId = data.slice("return:".length);
    }

    try {
      const booking = await employeeService.scanBooking(bookingId);
      const { status, customerName, vehicleName } = booking;
      const label = vehicleName ? `${vehicleName} · ${customerName}` : customerName;

      switch (status) {
        case "CONFIRMED":
          if (scannedIntent === "return") {
            toast.info(`QR is from before pickup — opening pickup for ${label}`);
          }
          navigate(`/staff/pickups/${bookingId}`);
          break;

        case "PICKED_UP":
          if (scannedIntent === "pickup") {
            toast.info(`Vehicle already picked up — opening return for ${label}`);
          }
          navigate(`/employee/dashboard/return/${bookingId}`);
          break;

        case "HOLD":
          toast.warning(`Booking for ${label} is pending payment confirmation. Ask the customer to complete payment.`);
          break;

        case "RETURNED":
        case "COMPLETED":
          toast.info(`Booking for ${label} has already been completed.`);
          break;

        case "CANCELLED":
          toast.error(`Booking for ${label} has been cancelled.`);
          break;

        default:
          toast.error(`Booking status "${status}" cannot be processed at this station.`);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        toast.error("Invalid QR code — booking not found.");
      } else if (status === 401 || status === 403) {
        toast.error("You are not authorised to access this booking.");
      } else {
        toast.error("Failed to verify booking. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      <DashboardNavbar />

      <main className="container max-w-7xl mx-auto py-6 px-4 md:px-6 space-y-8">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
        >
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              Operations Dashboard
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Overview for {format(date, "MMMM dd, yyyy")}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full sm:w-[240px] justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <div className="flex gap-3 w-full sm:w-auto">
              <Button
                variant="outline"
                onClick={() => setIsScannerOpen(true)}
                className="flex-1 sm:flex-none"
              >
                <QrCode className="mr-2 h-4 w-4" /> Scan
              </Button>

              <Button
                onClick={handleNewBooking}
                className="flex-1 sm:flex-none bg-orange-600 hover:bg-orange-700 text-white shadow-sm"
              >
                <Plus className="mr-2 h-4 w-4" /> New Booking
              </Button>
            </div>
          </div>
        </motion.div>

        {showShiftNotice && needsShift && (
          <ShiftRequiredNotice
            onShiftOpened={() => navigate("/employee/new-booking")}
          />
        )}

        {/* Stats Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <DashboardStats
            stats={stats}
            isLoading={isStatsLoading}
            onOverdueClick={() => setFilter("OVERDUE")}
            overdueActive={filter === "OVERDUE"}
          />
        </motion.div>

        {/* Main Table Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="flex bg-muted/30 p-1 rounded-lg w-full sm:w-fit overflow-x-auto">
                  <button
                    onClick={() => setFilter("PICKUP")}
                    className={cn(
                      "flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                      filter === "PICKUP"
                        ? "bg-white text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Pickups
                  </button>
                  <button
                    onClick={() => setFilter("RETURN")}
                    className={cn(
                      "flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                      filter === "RETURN"
                        ? "bg-white text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Returns
                  </button>
                  <button
                    onClick={() => setFilter("OVERDUE")}
                    className={cn(
                      "flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap inline-flex items-center justify-center gap-1.5",
                      filter === "OVERDUE"
                        ? "bg-white text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Overdue
                    {overdueCount !== null && (
                      <span
                        className={cn(
                          "min-w-[20px] rounded-full px-1.5 text-[11px] font-bold leading-5",
                          overdueCount > 0
                            ? "bg-red-600 text-white"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {overdueCount}
                      </span>
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={filter === "OVERDUE" ? overdueQuery.isFetching : isLoading}
                  className="h-9 w-9 p-0 shrink-0"
                  title="Refresh"
                >
                  <RefreshCw
                    className={cn(
                      "h-4 w-4",
                      (filter === "OVERDUE" ? overdueQuery.isFetching : isLoading) &&
                        "animate-spin",
                    )}
                  />
                </Button>
              </div>

              {filter !== "OVERDUE" && (
                <div className="flex bg-muted/30 p-1 rounded-lg w-full sm:w-fit sm:ml-auto">
                  {(["DAILY", "MONTHLY"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setBookingType(type)}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap inline-flex items-center justify-center gap-1.5",
                        bookingType === type
                          ? "bg-white text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {type === "DAILY" ? "Daily" : "Monthly"}
                      {counts && (
                        <span
                          className={cn(
                            "min-w-[20px] rounded-full px-1.5 text-[11px] font-bold leading-5",
                            bookingType === type
                              ? "bg-orange-600 text-white"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {type === "DAILY" ? counts.daily : counts.monthly}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {filter === "OVERDUE"
                ? "Rentals still out after their expected return time, most overdue first. Updates every minute."
                : bookingType === "MONTHLY"
                  ? filter === "PICKUP"
                    ? "Every monthly rental waiting for pickup, whatever the date."
                    : "Every monthly rental out on the road, whatever the date."
                  : filter === "PICKUP"
                    ? `Daily rentals picking up on ${format(date, "MMM dd, yyyy")}.`
                    : `Daily rentals due back on ${format(date, "MMM dd, yyyy")}.`}
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
            {filter === "OVERDUE" ? (
              <>
                <OverdueReturnsTable
                  rows={overdueQuery.data?.data ?? []}
                  fetchedAt={overdueQuery.data?.fetchedAt ?? Date.now()}
                  onAction={handleAction}
                  isLoading={overdueQuery.isLoading}
                  isError={overdueQuery.isError && !overdueQuery.data}
                />
                {overdueQuery.data &&
                  overdueQuery.data.pagination.total > overdueQuery.data.data.length && (
                    <p className="px-4 py-3 text-xs text-muted-foreground border-t">
                      Showing the {overdueQuery.data.data.length} most overdue of{" "}
                      {overdueQuery.data.pagination.total}.
                    </p>
                  )}
              </>
            ) : (
              <BookingTable
                bookings={bookings}
                filterType={filter}
                onAction={handleAction}
                isLoading={isLoading}
                bookingType={bookingType}
              />
            )}
          </div>
        </motion.div>
      </main>

      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleQrScan}
      />
    </div>
  );
}
