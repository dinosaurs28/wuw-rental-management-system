import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminService, type AdminBranch, type RevenueReportItem, type RevenueTrendItem, type CategoryRevenueItem, type PaymentMethodItem } from '@/services/admin.service';
import { toast } from 'sonner';
import { Download, DollarSign, Building2, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { AdminStatsCards } from '@/components/admin/AdminStatsCards';
import { RevenueTrendChart, CategoryBreakdownChart, BranchComparisonChart, PaymentMethodChart } from '@/components/admin/AdminRevenueCharts';
import { exportAllDashboardData } from '@/lib/exportUtils';
import { DashboardFilters } from '@/components/admin/DashboardFilters';

export const AdminDashboardPage = () => {
    const [branches, setBranches] = useState<AdminBranch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
    const [revenueData, setRevenueData] = useState<RevenueReportItem[]>([]);
    const [revenueTrendData, setRevenueTrendData] = useState<RevenueTrendItem[]>([]);
    const [categoryData, setCategoryData] = useState<CategoryRevenueItem[]>([]);
    const [paymentMethodData, setPaymentMethodData] = useState<PaymentMethodItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [chartsLoading, setChartsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [categories, setCategories] = useState<{ publicId: string; name: string }[]>([]);

    // Filter state
    const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date()
    });
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    // Initial Data Fetch
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setLoading(true);
                setError(null);
                const [branchesData, categoriesData] = await Promise.all([
                    adminService.getBranches(),
                    adminService.getCategories()
                ]);
                setBranches(branchesData);
                setCategories(categoriesData);

                // Fetch default reports
                await fetchAnalyticsData("all", [], dateRange.start, dateRange.end);
            } catch (error) {
                console.error("Failed to load dashboard data", error);
                setError("Failed to load dashboard data. Please try again.");
                toast.error("Failed to load dashboard data");
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();
    }, []);

    const fetchAnalyticsData = async (branchId: string, categories?: string[], dateStart?: Date | null, dateEnd?: Date | null) => {
        try {
            setChartsLoading(true);
            setError(null);
            const params: any = {
                branchId: branchId === "all" ? undefined : branchId,
                startDate: dateStart?.toISOString(),
                endDate: dateEnd?.toISOString()
            };

            // Add category filter - only first category for now since backend expects single categoryId
            if (categories && categories.length > 0) {
                params.categoryId = categories[0];
            }

            // Fetch all analytics data in parallel
            const [revenueReport, trendData, catData, paymentData] = await Promise.all([
                adminService.getRevenueReport({ ...params, reportType: 'revenue_only' }),
                adminService.getRevenueTrends({ ...params, granularity: 'daily' }),
                adminService.getRevenueByCategory(params),
                adminService.getPaymentMethodBreakdown(params)
            ]);

            setRevenueData(revenueReport.data);
            setRevenueTrendData(trendData.data);
            setCategoryData(catData.data);
            setPaymentMethodData(paymentData.data);
        } catch (error) {
            console.error("Failed to fetch analytics", error);
            setError("Failed to load analytics data. Please try again.");
            toast.error("Failed to load analytics data");
        } finally {
            setChartsLoading(false);
        }
    };

    const handleBranchChange = (value: string) => {
        setSelectedBranchId(value);
    };

    const handleApplyFilters = () => {
        fetchAnalyticsData(selectedBranchId, selectedCategories, dateRange.start, dateRange.end);
    };

    const handleResetFilters = () => {
        setSelectedBranchId("all");
        setDateRange({
            start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            end: new Date()
        });
        setSelectedCategories([]);
        fetchAnalyticsData("all", [], new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date());
    };

    const handleExport = () => {
        try {
            exportAllDashboardData({
                revenueTrends: revenueTrendData,
                categoryBreakdown: categoryData,
                branchComparison: revenueData,
                paymentMethods: paymentMethodData
            });
            toast.success('Dashboard data exported successfully');
        } catch (error) {
            console.error('Export failed:', error);
            toast.error('Failed to export data');
        }
    };

    // Calculate system-wide KPIs
    const totalRevenue = revenueData.reduce((acc, curr) => acc + curr.totalRevenue, 0);
    const totalBranches = branches.length;
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

    if (error && !loading) {
        return (
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
                <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                    <div className="text-center">
                        <h3 className="text-xl font-semibold text-neutral-900 mb-2">
                            Unable to Load Dashboard
                        </h3>
                        <p className="text-neutral-500 mb-4">{error}</p>
                        <Button
                            onClick={() => window.location.reload()}
                            className="bg-[#FF5F00] hover:bg-[#E55500] text-white"
                        >
                            Retry
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
            {/* Page Header */}
            <div className="mb-6">
                <Breadcrumb className="mb-2">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/admin/dashboard" className="text-muted-foreground hover:text-[#FF5F00]">Admin</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage className="font-semibold text-neutral-900">Analytics</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Revenue Analytics</h1>
                        <p className="text-neutral-500 mt-1 text-sm md:text-base">
                            Comprehensive insights into business performance and trends.
                        </p>
                    </div>
                    <Button onClick={handleExport} className="h-11 bg-neutral-900 hover:bg-neutral-800 text-white shadow-sm px-6 w-full sm:w-auto">
                        <Download className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">Export</span>
                        <span className="sm:hidden">Export Data</span>
                    </Button>
                </div>
            </div>

            {/* Filters Panel */}
            <DashboardFilters
                selectedBranch={selectedBranchId}
                branches={branches}
                onBranchChange={handleBranchChange}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                selectedCategories={selectedCategories}
                categories={categories}
                onCategoriesChange={setSelectedCategories}
                onApply={handleApplyFilters}
                onReset={handleResetFilters}
            />

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

            {/* Analytics Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-6">
                <RevenueTrendChart data={revenueTrendData} isLoading={chartsLoading} />
                <CategoryBreakdownChart data={categoryData} isLoading={chartsLoading} />
                <PaymentMethodChart data={paymentMethodData} isLoading={chartsLoading} />
            </div>

            {/* Branch Comparison Chart - Full Width */}
            <div className="mb-6">
                <BranchComparisonChart
                    data={revenueData.map(item => ({
                        branchName: item.branchName,
                        totalRevenue: item.totalRevenue
                    }))}
                    isLoading={chartsLoading}
                />
            </div>

            {/* Quick Actions / System Health Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Quick Actions Card */}
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

                {/* System Health Card */}
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

                {/* Insights Card */}
                <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                    <CardHeader className="py-4">
                        <CardTitle className="text-base font-semibold">Top Insights</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                        <div className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                            <p className="text-sm text-neutral-700">
                                <span className="font-semibold text-[#FF5F00]">
                                    {categoryData.length > 0 ? categoryData[0].categoryName : 'N/A'}
                                </span>
                                {' '}is your top revenue category
                            </p>
                        </div>
                        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-100">
                            <p className="text-sm text-neutral-700">
                                <span className="font-semibold">
                                    {branches.length}
                                </span>
                                {' '}active branch locations
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
