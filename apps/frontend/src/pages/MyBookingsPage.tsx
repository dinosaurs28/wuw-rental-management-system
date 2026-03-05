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
        profileNotFound,
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
                <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-serif font-black tracking-tight text-white md:text-4xl">
                            Welcome back, {user?.name || "User"}
                        </h1>
                        <p className="mt-2 text-zinc-400 font-medium">
                            Manage your premium vehicle bookings and rentals
                        </p>
                    </div>
                    <Button
                        className="gap-2 shrink-0 h-14 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 transition-all duration-300 font-bold tracking-wide px-8 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
                        onClick={() => navigate("/vehicles")}
                    >
                        <Car className="h-5 w-5" />
                        Book a Vehicle
                    </Button>
                </div>

                {/* Filter Section */}
                <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-6">
                    <h2 className="text-lg font-bold text-white tracking-wide">
                        {filter === 'active' ? 'Active Bookings' : 'Past Bookings'}
                    </h2>
                    <Select value={filter} onValueChange={handleFilterChange}>
                        <SelectTrigger className="w-full sm:w-[200px] h-12 rounded-full bg-black/40 border-white/10 text-white font-medium hover:bg-black/60 focus:ring-1 focus:ring-white/20 transition-all px-6">
                            <SelectValue placeholder="Filter bookings" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-white/10 text-zinc-50 rounded-2xl shadow-2xl">
                            <SelectItem value="active" className="rounded-xl focus:bg-white/10 focus:text-white cursor-pointer py-2">Active Trips</SelectItem>
                            <SelectItem value="past" className="rounded-xl focus:bg-white/10 focus:text-white cursor-pointer py-2">Past History</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Loading State */}
                {isLoading && (
                    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="rounded-[2rem] border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-xl">
                                <div className="mb-6 flex justify-between">
                                    <Skeleton className="h-5 w-24 bg-white/10 rounded-full" />
                                    <Skeleton className="h-6 w-20 bg-white/10 rounded-full" />
                                </div>
                                <Skeleton className="mb-4 h-8 w-48 bg-white/10 rounded-full" />
                                <Skeleton className="mb-6 h-24 w-full bg-white/10 rounded-2xl" />
                                <div className="flex justify-between items-end pt-4 border-t border-white/5">
                                    <Skeleton className="h-8 w-24 bg-white/10 rounded-full" />
                                    <Skeleton className="h-10 w-28 bg-white/10 rounded-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Error State */}
                {error && !isLoading && (
                    <div className="flex flex-col items-center justify-center rounded-[2rem] border border-red-500/20 bg-red-500/10 p-12 text-center backdrop-blur-xl">
                        <p className="text-red-400 font-medium mb-6">{error}</p>
                        <Button
                            variant="destructive"
                            className="h-12 rounded-full px-8 font-bold tracking-wide"
                            onClick={() => fetchBookings()}
                        >
                            Try Again
                        </Button>
                    </div>
                )}

                {/* Profile Not Found State - for new users who haven't completed profile */}
                {profileNotFound && !isLoading && (
                    <div className="flex flex-col items-center justify-center rounded-[2rem] border border-orange-500/20 bg-orange-500/10 p-12 text-center backdrop-blur-xl">
                        <div className="mb-6 rounded-full bg-orange-500/20 p-5 shadow-[0_0_30px_rgba(249,115,22,0.2)]">
                            <Car className="h-10 w-10 text-orange-400" />
                        </div>
                        <h3 className="mb-3 text-xl font-serif font-black text-white tracking-tight">Complete Your Profile</h3>
                        <p className="mb-8 max-w-sm text-sm font-medium text-orange-200/80">
                            Welcome! Before you can start booking premium vehicles, please complete your profile information.
                        </p>
                        <Button
                            className="gap-2 h-14 rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-all duration-300 font-bold tracking-wide px-8 shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_30px_rgba(249,115,22,0.5)]"
                            onClick={() => navigate("/profile")}
                        >
                            Complete Profile
                        </Button>
                    </div>
                )}

                {/* Empty State */}
                {!isLoading && !error && !profileNotFound && bookings.length === 0 && (
                    <div className="flex flex-col items-center justify-center rounded-[2rem] border border-white/5 bg-zinc-900/40 p-16 text-center backdrop-blur-xl relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
                        <div className="mb-6 rounded-full bg-white/5 p-6 shadow-[0_0_40px_rgba(255,255,255,0.05)] border border-white/10 relative z-10">
                            <CalendarX className="h-12 w-12 text-zinc-400" />
                        </div>
                        <h3 className="mb-3 text-2xl font-serif font-black text-white tracking-tight relative z-10">No bookings found</h3>
                        <p className="mb-8 max-w-md text-sm font-medium text-zinc-400 relative z-10">
                            {filter === 'active'
                                ? "You don't have any active bookings. It's time to start exploring our premium vehicle collection!"
                                : "You don't have any past bookings yet."
                            }
                        </p>
                        <Button
                            className="gap-2 h-14 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 transition-all duration-300 font-bold tracking-wide px-8 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] relative z-10"
                            onClick={() => navigate("/vehicles")}
                        >
                            <Car className="h-5 w-5" />
                            Browse Premium Vehicles
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
