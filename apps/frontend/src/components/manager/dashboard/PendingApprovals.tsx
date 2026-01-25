import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, UserCheck, AlertCircle } from "lucide-react";
import { managerDashboardService, type Booking } from "@/services/managerDashboard.service";

interface PendingApprovalsProps {
    bookings?: Booking[];
    isLoading?: boolean;
}

export const PendingApprovals = ({ bookings = [], isLoading = false }: PendingApprovalsProps) => {

    return (
        <Card className="border border-orange-200 bg-orange-50/10 shadow-sm overflow-hidden">
            <CardHeader className="bg-orange-50/50 pb-3 border-b border-orange-100">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-orange-600" />
                        <CardTitle className="text-lg font-bold text-orange-950">Pending Approvals</CardTitle>
                    </div>
                    {bookings.length > 0 && (
                        <span className="bg-orange-200 text-orange-800 text-xs font-bold px-2 py-0.5 rounded-full">
                            {bookings.length}
                        </span>
                    )}
                </div>
                <CardDescription className="text-orange-900/60">
                    Require immediate attention
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <div className="divide-y divide-orange-100">
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="p-4 flex items-center justify-between">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-20" />
                                </div>
                                <Skeleton className="h-8 w-16" />
                            </div>
                        ))
                    ) : bookings.length === 0 ? (
                        <div className="p-8 text-center text-neutral-500 text-sm">
                            No pending approvals.
                        </div>
                    ) : (
                        bookings.slice(0, 5).map((booking) => (
                            <div key={booking.id} className="p-4 flex items-center justify-between hover:bg-orange-50/30 transition-colors group">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-full bg-white border border-orange-200 flex items-center justify-center text-orange-600 shrink-0">
                                        <UserCheck className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-neutral-900">{booking.customerName}</p>
                                        <p className="text-xs text-neutral-500 mt-0.5 mb-1">{booking.vehicleName}</p>
                                        {booking.reason && (
                                            <p className="text-[10px] text-orange-700 bg-orange-100/50 inline-block px-1.5 py-0.5 rounded border border-orange-200/50 font-medium">
                                                {booking.reason}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <Button size="sm" className="h-8 bg-white border border-orange-200 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300 text-neutral-700 shadow-sm" asChild>
                                    <Link to={`/manager/bookings/${booking.id}/review`}>
                                        Review
                                    </Link>
                                </Button>
                            </div>
                        ))
                    )}
                </div>

                {bookings.length > 0 && (
                    <div className="p-3 bg-neutral-50 border-t flex justify-center">
                        <Button variant="link" className="text-xs text-orange-600 h-auto p-0 hover:no-underline hover:text-orange-700 group" asChild>
                            <Link to="/manager/bookings?status=pending">
                                View All Pending <ChevronRight className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
