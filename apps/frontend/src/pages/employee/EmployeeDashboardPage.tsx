import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import { Plus, Calendar as CalendarIcon, QrCode } from "lucide-react";
import { motion } from "motion/react";

import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import {
  bookingService,
  type EmployeeBooking,
} from "@/services/booking.service";

import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { BookingTable } from "@/components/employee/BookingTable";
import { QrScannerModal } from "@/components/employee/QrScannerModal";
import { DashboardStats } from "@/components/employee/DashboardStats";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function EmployeeDashboardPage() {
  // Navigation fixed to point to /staff/pickups/:bookingId
  const navigate = useNavigate();
  const { isAuthenticated } = useEmployeeAuthStore();

  // State
  const [date, setDate] = useState<Date>(new Date());
  const [filter, setFilter] = useState<"PICKUP" | "RETURN">("PICKUP");
  const [bookings, setBookings] = useState<EmployeeBooking[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Auth Check
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/employee/sign-in");
      toast.error("Please sign in to access the dashboard");
    }
  }, [isAuthenticated, navigate]);

  // Fetch Data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      let data: EmployeeBooking[] = [];
      if (filter === "PICKUP") {
        data = await bookingService.getEmployeeBookings(date);
        if (!data || data.length === 0) {
          toast.info("No Upcoming Bookings Found");
        }
      } else {
        data = await bookingService.getEmployeeReturns(date);
        if (!data || data.length === 0) {
          toast.info("No Returns Scheduled for this Date");
        }
      }
      setBookings(data || []);
    } catch (error) {
      console.error(error);
      toast.error("Failed to fetch bookings");
      setBookings([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [date, filter, isAuthenticated]);

  const handleAction = async (bookingId: string) => {
    try {
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

  const handleQrScan = (data: string | null) => {
    if (data) {
      toast.success(`Scanned: ${data}`);
      navigate(`/staff/pickups/${data}`);
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
                onClick={() => navigate("/employee/new-booking")}
                className="flex-1 sm:flex-none bg-orange-600 hover:bg-orange-700 text-white shadow-sm"
              >
                <Plus className="mr-2 h-4 w-4" /> New Booking
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Stats Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <DashboardStats />
        </motion.div>

        {/* Main Table Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-6"
        >
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
          </div>

          <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
            <BookingTable
              bookings={bookings}
              filterType={filter}
              onAction={handleAction}
              isLoading={isLoading}
            />
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
