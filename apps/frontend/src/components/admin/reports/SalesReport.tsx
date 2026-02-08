import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, FileText, PieChart as PieChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/MetricCard';
import { FilterPanel } from '@/components/ui/FilterPanel';
import { ExportButton } from '@/components/ui/ExportButton';
import { DataTable } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatCurrency, formatDate, abbreviateAmount } from '@/utils/formatters';
import { getDateRangeFromPreset, type DateRangePreset } from '@/utils/exportHelpers';
import { toast } from 'sonner';
import type { SalesReport as SalesReportData, SalesBooking } from '@/types/reports';
import { adminService } from '@/services/admin.service';

// ============================================================================
// Sales Report Component
// ============================================================================

const COLORS = ['#FF5F00', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export const SalesReport = () => {
    const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>('30days');
    const [startDate, setStartDate] = useState<Date | undefined>();
    const [endDate, setEndDate] = useState<Date | undefined>();
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<string>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [reportData, setReportData] = useState<SalesReportData | null>(null);
    const [branches, setBranches] = useState<Array<{ value: string; label: string }>>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Fetch branches on mount
    useEffect(() => {
        fetchBranches();
    }, []);

    // Initialize date range from preset
    useEffect(() => {
        if (dateRangePreset !== 'custom') {
            const { startDate: start, endDate: end } = getDateRangeFromPreset(dateRangePreset);
            setStartDate(start);
            setEndDate(end);
        }
    }, [dateRangePreset]);

    // Fetch report data when filters change
    useEffect(() => {
        if (startDate && endDate) {
            fetchReportData();
        }
    }, [startDate, endDate, selectedBranch, selectedStatus, currentPage]);

    const fetchBranches = async () => {
        try {
            const data = await adminService.getBranches();
            const branchOptions = data.map((branch: any) => ({
                value: branch.publicId,
                label: branch.name,
            }));
            setBranches(branchOptions);
        } catch (error) {
            console.error('Failed to fetch branches:', error);
        }
    };

    const fetchReportData = async () => {
        if (!startDate || !endDate) return;

        setIsLoading(true);
        try {
            const params: Record<string, any> = {
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
                page: currentPage.toString(),
                limit: '50',
            };

            if (selectedBranch !== 'all') {
                params.branchId = selectedBranch;
            }

            if (selectedStatus !== 'all') {
                params.status = selectedStatus;
            }

            const result = await adminService.getSalesReport(params as any);
            setReportData(result.data);
        } catch (error) {
            console.error('Error fetching report:', error);
            toast.error('Failed to load sales report. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleApplyFilters = () => {
        setCurrentPage(1);
        fetchReportData();
    };

    const handleResetFilters = () => {
        setDateRangePreset('30days');
        setSelectedBranch('all');
        setSelectedStatus('all');
        setCurrentPage(1);
    };

    const getExportUrl = () => {
        if (!startDate || !endDate) return '';

        const params: Record<string, any> = {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
        };

        if (selectedBranch !== 'all') {
            params.branchId = selectedBranch;
        }

        if (selectedStatus !== 'all') {
            params.status = selectedStatus;
        }

        const queryString = new URLSearchParams(params).toString();
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        return `${baseUrl}/admin/dashboard/reports/sales?${queryString}`;
    };

    // Table columns
    const columns: ColumnDef<SalesBooking>[] = [
        {
            accessorKey: 'bookingId',
            header: 'Booking ID',
            cell: ({ row }) => (
                <div className="font-mono text-sm">{row.original.bookingId}</div>
            ),
        },
        {
            accessorKey: 'bookingDate',
            header: 'Date',
            cell: ({ row }) => (
                <div className="text-sm">{formatDate(row.original.bookingDate)}</div>
            ),
        },
        {
            accessorKey: 'customer.name',
            header: 'Customer',
            cell: ({ row }) => (
                <div>
                    <div className="font-medium">{row.original.customer.name}</div>
                    <div className="text-xs text-gray-500">{row.original.customer.phone}</div>
                </div>
            ),
        },
        {
            accessorKey: 'vehicle.details',
            header: 'Vehicle',
            cell: ({ row }) => (
                <div>
                    <div className="text-sm">{row.original.vehicle.details}</div>
                    <div className="text-xs text-gray-500 font-mono">{row.original.vehicle.regNo}</div>
                </div>
            ),
        },
        {
            accessorKey: 'period.days',
            header: 'Duration',
            cell: ({ row }) => (
                <div className="text-sm">{row.original.period.days} days</div>
            ),
        },
        {
            accessorKey: 'financial.totalAmount',
            header: 'Amount',
            cell: ({ row }) => (
                <div className="font-semibold font-mono">
                    {formatCurrency(row.original.financial.totalAmount)}
                </div>
            ),
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
        },
        {
            accessorKey: 'branch',
            header: 'Branch',
            cell: ({ row }) => (
                <div className="text-sm">{row.original.branch}</div>
            ),
        },
    ];

    const statusChartData = reportData?.breakdown.byStatus.map(item => ({
        name: item.status?.replace('_', ' ') || '',
        value: item.revenue,
        count: item.count,
    })) || [];

    const branchChartData = reportData?.breakdown.byBranch.map(item => ({
        name: item.branch,
        revenue: item.revenue,
        count: item.count,
    })) || [];

    const categoryChartData = reportData?.breakdown.byCategory.map((item: any) => ({
        name: item.category,
        revenue: item.revenue,
        count: item.count,
    })) || [];

    const statusOptions = [
        { value: 'HOLD', label: 'Hold' },
        { value: 'CONFIRMED', label: 'Confirmed' },
        { value: 'PICKED_UP', label: 'Picked Up' },
        { value: 'RETURNED', label: 'Returned' },
        { value: 'CANCELLED', label: 'Cancelled' },
    ];

    return (
        <div className="container mx-auto p-4 md:p-6 space-y-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                        Sales Report
                    </h1>
                    <p className="text-sm text-gray-600 mt-1">
                        {startDate && endDate ? (
                            `${formatDate(startDate)} - ${formatDate(endDate)}`
                        ) : (
                            'Select date range to view report'
                        )}
                    </p>
                </div>

                <ExportButton
                    apiUrl={getExportUrl()}
                    filename={`sales-report-${startDate?.toISOString().split('T')[0]}-${endDate?.toISOString().split('T')[0]}`}
                    disabled={isLoading || !reportData}
                />
            </div>

            {/* Filters */}
            <FilterPanel
                dateRangePreset={dateRangePreset}
                onDateRangePresetChange={setDateRangePreset}
                startDate={startDate}
                endDate={endDate}
                onDateChange={(start, end) => {
                    setStartDate(start);
                    setEndDate(end);
                }}
                showBranchFilter
                branches={branches}
                selectedBranch={selectedBranch}
                onBranchChange={setSelectedBranch}
                showStatusFilter
                statuses={statusOptions}
                selectedStatus={selectedStatus}
                onStatusChange={setSelectedStatus}
                onApply={handleApplyFilters}
                onReset={handleResetFilters}
            />

            {/* Summary Metrics */}
            <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-orange-500" />
                    Summary Metrics
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard
                        title="Total Revenue"
                        value={abbreviateAmount(reportData?.summary.totalRevenue || 0)}
                        icon={DollarSign}
                        variant="revenue"
                        isLoading={isLoading}
                    />
                    <MetricCard
                        title="Total Bookings"
                        value={reportData?.summary.totalBookings.toString() || '0'}
                        icon={FileText}
                        variant="bookings"
                        isLoading={isLoading}
                    />
                    <MetricCard
                        title="Avg Booking Value"
                        value={abbreviateAmount(reportData?.summary.averageBookingValue || 0)}
                        icon={TrendingUp}
                        variant="default"
                        isLoading={isLoading}
                    />
                    <MetricCard
                        title="Outstanding"
                        value={abbreviateAmount(reportData?.summary.outstandingAmount || 0)}
                        icon={DollarSign}
                        variant="collection"
                        isLoading={isLoading}
                    />
                </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Revenue by Status */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                            <PieChartIcon className="h-5 w-5 text-orange-500" />
                            Revenue by Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {statusChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={250}>
                                <PieChart>
                                    <Pie
                                        data={statusChartData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                        outerRadius={80}
                                        fill="#8884d8"
                                        dataKey="value"
                                    >
                                        {statusChartData.map((_entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value: any) => formatCurrency(value)} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-[250px] flex items-center justify-center text-gray-500">
                                No data available
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Revenue by Branch */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                            <PieChartIcon className="h-5 w-5 text-orange-500" />
                            Revenue by Branch
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {branchChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={250}>
                                <BarChart data={branchChartData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="name" />
                                    <YAxis />
                                    <Tooltip formatter={(value: any) => formatCurrency(value)} />
                                    <Bar dataKey="revenue" fill="#FF5F00" />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-[250px] flex items-center justify-center text-gray-500">
                                No data available
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Category Breakdown (if data available) */}
            {categoryChartData.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                            <PieChartIcon className="h-5 w-5 text-orange-500" />
                            Revenue by Vehicle Category
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={categoryChartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip
                                    formatter={(value: any, name: string) => {
                                        if (name === 'revenue') return formatCurrency(value);
                                        return value;
                                    }}
                                />
                                <Legend />
                                <Bar dataKey="revenue" fill="#FF5F00" name="Revenue" />
                                <Bar dataKey="count" fill="#3B82F6" name="Bookings" />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}

            {/* Data Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <FileText className="h-5 w-5 text-orange-500" />
                        Booking Details
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={reportData?.data || []}
                        isLoading={isLoading}
                        pageCount={reportData?.pagination.totalPages}
                        currentPage={currentPage}
                        onPageChange={setCurrentPage}
                        emptyMessage="No bookings found for the selected filters"
                    />
                </CardContent>
            </Card>
        </div>
    );
};
