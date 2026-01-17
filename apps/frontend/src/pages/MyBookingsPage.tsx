import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layouts/DashboardLayout";
import { UserBookingCard } from "@/components/booking/UserBookingCard";
import { useAuthStore } from "@/store/auth.store";
import { useBookingsStore } from "@/store/bookings.store";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Car, CalendarX } from "lucide-react";
import axios from "axios";

export function MyBookingsPage() {
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuthStore();
    const {
        bookings,
        isLoading,
        error,
        filter,
        meta,
        fetchBookings,
        setFilter
    } = useBookingsStore();

    // Initial data fetch
    useEffect(() => {
        const loadBookings = async () => {
            try {
                await fetchBookings();
            } catch (err) {
                // Handle 401/403 errors
                if (axios.isAxiosError(err)) {
                    const status = err.response?.status;
                    if (status === 401 || status === 403) {
                        toast.error("Session expired. Please sign in again.");
                        navigate("/auth/sign-in");
                    }
                }
            }
        };

        if (isAuthenticated) {
            loadBookings();
        }
    }, [isAuthenticated, fetchBookings, navigate]);

    // Handle filter change
    const handleFilterChange = (value: string) => {
        setFilter(value as 'active' | 'past');
    };

    return (
        <DashboardLayout>
            <div className="container mx-auto px-4 py-6 md:px-6 lg:px-8">
                {/* Page Header */}
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                            Welcome back, {user?.name || "User"}
                        </h1>
                        <p className="mt-1 text-muted-foreground">
                            Manage your vehicle bookings and rentals
                        </p>
                    </div>
                    <Button
                        className="gap-2 shrink-0"
                        onClick={() => navigate("/vehicles")}
                    >
                        <Car className="h-4 w-4" />
                        Book a Vehicle
                    </Button>
                </div>

                {/* Filter Section */}
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg font-semibold">
                        {filter === 'active' ? 'Active Bookings' : 'Past Bookings'}
                    </h2>
                    <Select value={filter} onValueChange={handleFilterChange}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Filter bookings" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="past">Past</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Loading State */}
                {isLoading && (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="rounded-lg border p-4">
                                <div className="mb-4 flex justify-between">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-5 w-20" />
                                </div>
                                <Skeleton className="mb-3 h-6 w-48" />
                                <Skeleton className="mb-4 h-20 w-full" />
                                <div className="flex justify-between">
                                    <Skeleton className="h-6 w-24" />
                                    <Skeleton className="h-9 w-24" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Error State */}
                {error && !isLoading && (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
                        <p className="text-destructive">{error}</p>
                        <Button
                            variant="outline"
                            className="mt-4"
                            onClick={() => fetchBookings()}
                        >
                            Try Again
                        </Button>
                    </div>
                )}

                {/* Empty State */}
                {!isLoading && !error && bookings.length === 0 && (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                        <div className="mb-4 rounded-full bg-muted p-4">
                            <CalendarX className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold">No bookings found</h3>
                        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
                            {filter === 'active'
                                ? "You don't have any active bookings. Start exploring our vehicles!"
                                : "You don't have any past bookings yet."
                            }
                        </p>
                        <Button
                            className="gap-2"
                            onClick={() => navigate("/vehicles")}
                        >
                            <Car className="h-4 w-4" />
                            Browse Vehicles
                        </Button>
                    </div>
                )}

                {/* Bookings Grid */}
                {!isLoading && !error && bookings.length > 0 && (
                    <>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {bookings.map((booking) => (
                                <UserBookingCard
                                    key={booking.bookingId}
                                    booking={booking}
                                />
                            ))}
                        </div>

                        {/* Pagination Info */}
                        {meta && meta.totalPages > 1 && (
                            <div className="mt-6 flex items-center justify-center text-sm text-muted-foreground">
                                Page {meta.page} of {meta.totalPages} ({meta.totalCount} bookings)
                            </div>
                        )}
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}
