import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import { DashboardKPIs } from "@/components/manager/dashboard/DashboardKPIs";
import { ActiveBookings } from "@/components/manager/dashboard/ActiveBookings";
import { PendingApprovals } from "@/components/manager/dashboard/PendingApprovals";
import { DamageReports } from "@/components/manager/dashboard/DamageReports";
import { StaffActivity } from "@/components/manager/dashboard/StaffActivity";
import { managerDashboardService, type KPIStats } from "@/services/managerDashboard.service";
import { ManagerLayout } from "@/components/manager/ManagerLayout";

export const DashboardPage = () => {
    // State for all data
    const [stats, setStats] = useState<KPIStats | null>(null);
    const [activeBookings, setActiveBookings] = useState<any[]>([]);
    const [pendingBookings, setPendingBookings] = useState<any[]>([]);
    const [damageReports, setDamageReports] = useState<any[]>([]);
    const [staffActivity, setStaffActivity] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadDashboardData = async () => {
            try {
                setIsLoading(true);
                // Parallel fetching of all required data
                const [active, pending, damage, activity, staff] = await Promise.all([
                    managerDashboardService.getActiveBookings(),
                    managerDashboardService.getPendingApprovals(),
                    managerDashboardService.getDamageReports(),
                    managerDashboardService.getStaffActivity(),
                    managerDashboardService.getEmployees()
                ]);

                setActiveBookings(active || []);
                setPendingBookings(pending || []);
                setDamageReports(damage || []);
                setStaffActivity(activity || []);
                setEmployees(staff || []);

                // Calculate KPIs locally
                setStats({
                    activeBookings: active?.length || 0,
                    pendingApprovals: pending?.length || 0,
                    openDamageReports: damage?.length || 0,
                    staffOnDuty: staff?.length || 0
                });

            } catch (err: any) {
                console.error("Failed to load dashboard data", err);
                const errorMessage = err.response?.data?.message || err.message || "Failed to load dashboard data.";
                setError(errorMessage);
                toast.error(errorMessage);
            } finally {
                setIsLoading(false);
            }
        };

        loadDashboardData();
    }, []);

    if (error) {
        return (
            <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
                <div className="bg-white p-6 rounded-lg shadow-sm border max-w-md w-full text-center space-y-4">
                    <div className="text-red-500 font-bold text-lg">Error Loading Dashboard</div>
                    <p className="text-neutral-600">{error}</p>
                    <Button onClick={() => window.location.reload()}>Retry</Button>
                </div>
            </div>
        );
    }

    return (
        <ManagerLayout>
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8">
                {/* Page Header */}
                <div className="mb-8">
                    <Breadcrumb className="mb-4">
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>Branch Overview</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>

                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Branch Operations Dashboard</h1>
                            <p className="text-neutral-500 mt-2 text-lg">
                                Overview of bookings, approvals, vehicles, and staff activity.
                            </p>
                        </div>
                    </div>
                </div>

                {/* KPI Summary Cards */}
                <section className="mb-8">
                    <DashboardKPIs stats={stats} isLoading={isLoading} />
                </section>

                {/* Main Dashboard Grid */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

                    {/* Left Column (2/3 width on large screens) */}
                    <div className="xl:col-span-2 space-y-8">
                        <section>
                            <ActiveBookings bookings={activeBookings} isLoading={isLoading} />
                        </section>

                        <section>
                            <DamageReports reports={damageReports} isLoading={isLoading} />
                        </section>
                    </div>

                    {/* Right Column (1/3 width on large screens) */}
                    <div className="xl:col-span-1 space-y-8">
                        <section>
                            <PendingApprovals bookings={pendingBookings} isLoading={isLoading} />
                        </section>

                        <section>
                            <StaffActivity activities={staffActivity} isLoading={isLoading} />
                        </section>
                    </div>

                </div>
            </div>
        </ManagerLayout>
    );
};
