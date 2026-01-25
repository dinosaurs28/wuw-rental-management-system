import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { managerDashboardService, type StaffActivity as StaffActivityType } from "@/services/managerDashboard.service";
import { ScrollArea } from "@/components/ui/scroll-area";

interface StaffActivityProps {
    activities?: StaffActivityType[];
    isLoading?: boolean;
}

export const StaffActivity = ({ activities = [], isLoading = false }: StaffActivityProps) => {

    return (
        <Card className="border shadow-sm h-full flex flex-col">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-bold">Staff Activity</CardTitle>
                <CardDescription>Recent actions performed by staff</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-[300px]">
                <ScrollArea className="h-[300px]">
                    <div className="relative pl-6 pr-4 py-2 border-l ml-6 border-neutral-200 space-y-6">
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="relative pl-2">
                                    <span className="absolute -left-[29px] top-1 h-3 w-3 rounded-full border border-white bg-neutral-200" />
                                    <Skeleton className="h-4 w-3/4 mb-1" />
                                    <Skeleton className="h-3 w-1/2" />
                                </div>
                            ))
                        ) : activities.length === 0 ? (
                            <div className="text-sm text-neutral-500 italic pl-2">No recent activity.</div>
                        ) : (
                            activities.map((activity) => (
                                <div key={activity.id} className="relative pl-2">
                                    <span className="absolute -left-[29px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-blue-500 ring-1 ring-blue-100" />
                                    <p className="text-sm text-neutral-800">
                                        <span className="font-semibold text-neutral-900">{activity.employeeName}</span> {activity.action}
                                    </p>
                                    <time className="text-xs text-neutral-400 block mt-0.5">
                                        {new Date(activity.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                                    </time>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
};
