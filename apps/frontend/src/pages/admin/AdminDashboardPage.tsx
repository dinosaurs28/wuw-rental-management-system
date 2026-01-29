import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminService, type AdminBranch, type RevenueReportItem } from '@/services/admin.service';
import { toast } from 'sonner';
import { Download, DollarSign, Building2, Users } from 'lucide-react';
// Tabs removed
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
// AdminBranchManagement usage removed
import { AdminStatsCards } from '@/components/admin/AdminStatsCards';

export const AdminDashboardPage = () => {
    const [branches, setBranches] = useState<AdminBranch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
    const [revenueData, setRevenueData] = useState<RevenueReportItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [reportLoading, setReportLoading] = useState(false);

    // Initial Data Fetch
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setLoading(true);
                const branchesData = await adminService.getBranches();
                setBranches(branchesData);

                // Fetch default revenue report (System-wide or first branch)
                await fetchRevenueReport("all");
            } catch (error) {
                console.error("Failed to load dashboard data", error);
                toast.error("Failed to load dashboard data");
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();
    }, []);

    const fetchRevenueReport = async (branchId: string) => {
        try {
            setReportLoading(true);
            const data = await adminService.getRevenueReport({
                reportType: 'revenue_only',
                branchId: branchId === "all" ? undefined : branchId,
                // Default to last 30 days if needed, backend handles defaults too
            });
            setRevenueData(data.data);
        } catch (error) {
            console.error("Failed to fetch revenue", error);
            toast.error("Failed to update revenue report");
        } finally {
            setReportLoading(false);
        }
    };

    const handleBranchChange = (value: string) => {
        setSelectedBranchId(value);
        // Find publicId matching the selected ID if value is not "all"
        // Since adminService.getBranches returns AdminBranch which has publicId.
        // Let's assume the select value is the publicId for the API.
        fetchRevenueReport(value);
    };

    // Calculate system-wide KPIs from report data if "all" is selected, 
    // or just display the fetched data.
    // If backend returns breakdown by branch for "all", we sum it up.

    // Calculate system-wide KPIs
    const totalRevenue = revenueData.reduce((acc, curr) => acc + curr.totalRevenue, 0);
    const totalBranches = branches.length;

    // Aggregating counts from all branches
    const totalFleet = branches.reduce((acc, branch) => acc + (branch._count?.vehicles || 0), 0);
    const activeUsers = branches.reduce((acc, branch) => acc + (branch._count?.users || 0), 0);

    if (loading) {
        return <div className="p-8 space-y-4">
            <Skeleton className="h-12 w-64" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
            <Skeleton className="h-96 w-full" />
        </div>;
    }

    return (
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8">
            {/* Page Header */}
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <Breadcrumb className="mb-2">
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/admin/dashboard" className="text-muted-foreground hover:text-[#FF5F00]">Admin</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage className="font-semibold text-neutral-900">Reports</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                    <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Global Overview</h1>
                    <p className="text-neutral-500 mt-1 text-base">
                        Real-time performance metrics across all branch locations.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Select value={selectedBranchId} onValueChange={handleBranchChange}>
                        <SelectTrigger className="w-[200px] h-11 bg-white border-neutral-200">
                            <SelectValue placeholder="All Branches" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Branches</SelectItem>
                            {branches.map(b => (
                                <SelectItem key={b.publicId} value={b.publicId}>
                                    {b.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button className="h-11 bg-neutral-900 hover:bg-neutral-800 text-white shadow-sm px-6">
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                </div>
            </div>

            {/* KPI Summary Cards */}
            <section className="mb-8">
                <AdminStatsCards
                    stats={loading ? null : {
                        totalBranches,
                        totalFleet,
                        totalRevenue,
                        activeUsers
                    }}
                    isLoading={loading}
                />
            </section>

            {/* Dashboard Content - Overview Only */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Revenue Section */}
                <Card className="col-span-1 lg:col-span-2 border border-neutral-200 shadow-sm rounded-xl overflow-hidden bg-white">
                    <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg font-semibold text-neutral-900">Revenue Distribution</CardTitle>
                            {/* Optional: Add a small dropdown or info icon here */}
                        </div>
                    </CardHeader>
                    <CardContent className="p-6">
                        {/* Placeholder for Revenue Chart - Implementing a simple bar list for now */}
                        {reportLoading ? (
                            <div className="space-y-4">
                                <Skeleton className="h-10 w-full rounded-lg" />
                                <Skeleton className="h-10 w-full rounded-lg" />
                                <Skeleton className="h-10 w-full rounded-lg" />
                            </div>
                        ) : revenueData.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[300px] text-neutral-500 space-y-3">
                                <div className="p-4 bg-neutral-50 rounded-full">
                                    <DollarSign className="h-6 w-6 text-neutral-400" />
                                </div>
                                <p>No revenue data available for this period.</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {revenueData.slice(0, 5).map((item, index) => (
                                    <div key={item.branchId} className="group">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-full bg-orange-50 text-[#FF5F00] flex items-center justify-center text-xs font-bold border border-orange-100">
                                                    {index + 1}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-neutral-900 text-sm">{item.branchName}</div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold text-neutral-900">{item.currency} {item.totalRevenue.toLocaleString()}</div>
                                            </div>
                                        </div>
                                        <div className="h-2.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-[#FF5F00] rounded-full transition-all duration-1000 ease-out"
                                                style={{ width: `${Math.min((item.totalRevenue / (totalRevenue || 1)) * 100 * (revenueData.length > 1 ? 2 : 1), 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                                {revenueData.length > 5 && (
                                    <div className="text-center pt-4 border-t border-neutral-100">
                                        <Button variant="ghost" className="text-neutral-500 hover:text-[#FF5F00] text-sm font-medium">
                                            View {revenueData.length - 5} More Locations
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Recently Added Branches / Quick Actions column placeholder */}
                <div className="space-y-6">
                    <Card className="border border-neutral-200 shadow-sm rounded-xl overflow-hidden bg-[#FF5F00] text-white">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg font-bold">Quick Actions</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-white/80 text-sm mb-4">Manage your system efficiently.</p>
                            <div className="space-y-2">
                                <Button variant="secondary" className="w-full justify-start bg-white text-[#FF5F00] hover:bg-neutral-50 border-0 h-10 font-medium">
                                    <Building2 className="mr-2 h-4 w-4" />
                                    Add New Branch
                                </Button>
                                <Button variant="ghost" className="w-full justify-start text-white hover:bg-white/10 h-10">
                                    <Users className="mr-2 h-4 w-4" />
                                    Manage Managers
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                        <CardHeader className="py-4">
                            <CardTitle className="text-base font-semibold">System Health</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-0">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-neutral-500">API Status</span>
                                <span className="text-emerald-600 font-medium flex items-center gap-1">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                                    Operational
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-neutral-500">Database</span>
                                <span className="text-emerald-600 font-medium flex items-center gap-1">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                                    Connected
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};
