import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminService, type AdminBranch, type RevenueReportItem } from '@/services/admin.service';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { AdminBranchManagement } from '@/components/admin/AdminBranchManagement';
import { AdminStatsCards } from '@/components/admin/AdminStatsCards';
// Removed duplicate import

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

    const totalRevenue = revenueData.reduce((acc, curr) => acc + curr.totalRevenue, 0);
    // Hardcoded demo values for other stats not yet in API or if API is minimal
    const totalBranches = branches.length;
    // Fleet size needs another API or sum from branch details if available
    const totalFleet = 45800; // Mock reference
    const activeUsers = 892500; // Mock reference

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
            <div className="mb-8">
                <Breadcrumb className="mb-4">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Global Dashboard</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>

                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Global Performance Overview</h1>
                        <p className="text-neutral-500 mt-2 text-lg">
                            System-level monitoring, branch control, and financial reporting.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Select value={selectedBranchId} onValueChange={handleBranchChange}>
                            <SelectTrigger className="w-[180px] bg-white">
                                <SelectValue placeholder="Select Branch" />
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
                        <Button>
                            <Download className="mr-2 h-4 w-4" />
                            Generate Report
                        </Button>
                    </div>
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

            {/* Main Content Tabs */}
            <Tabs defaultValue="overview" className="space-y-6">
                <TabsList className="bg-neutral-100 p-1 rounded-lg">
                    <TabsTrigger value="overview" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">Overview</TabsTrigger>
                    <TabsTrigger value="branches" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">Branch Management</TabsTrigger>
                    <TabsTrigger value="fleet" disabled>System Fleet</TabsTrigger>
                    <TabsTrigger value="reports" disabled>Global Reports</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    {/* Revenue Section */}
                    <Card className="col-span-4 border shadow-sm">
                        <CardHeader>
                            <CardTitle>Branch Revenue Comparison</CardTitle>
                        </CardHeader>
                        <CardContent className="pl-6 pr-6 pb-6">
                            {/* Placeholder for Revenue Chart - Implementing a simple bar list for now */}
                            {reportLoading ? (
                                <div className="space-y-2">
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                </div>
                            ) : revenueData.length === 0 ? (
                                <div className="flex h-[200px] items-center justify-center text-muted-foreground">
                                    No revenue data available for selected period.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {revenueData.slice(0, 5).map((item) => (
                                        <div key={item.branchId} className="flex items-center gap-4">
                                            <div className="w-[150px] font-medium truncate text-sm" title={item.branchName}>
                                                {item.branchName}
                                            </div>
                                            <div className="flex-1 h-3 bg-neutral-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-primary rounded-full"
                                                    style={{ width: `${Math.min((item.totalRevenue / (totalRevenue || 1)) * 100 * (revenueData.length > 1 ? 2 : 1), 100)}%` }}
                                                />
                                            </div>
                                            <div className="w-[100px] text-right font-mono text-sm">
                                                {item.currency} {item.totalRevenue.toLocaleString()}
                                            </div>
                                        </div>
                                    ))}
                                    {revenueData.length > 5 && (
                                        <div className="text-center text-sm text-muted-foreground pt-2">
                                            + {revenueData.length - 5} more branches
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="branches" className="space-y-4">
                    <Card className="border shadow-sm">
                        <CardContent className="p-0">
                            <AdminBranchManagement branches={branches} onRefresh={() => {
                                const fetchBranches = async () => {
                                    const data = await adminService.getBranches();
                                    setBranches(data);
                                };
                                fetchBranches();
                            }} />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
};
