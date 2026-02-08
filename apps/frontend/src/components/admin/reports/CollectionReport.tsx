import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, CreditCard, DollarSign, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { FilterPanel } from '@/components/ui/FilterPanel';
import { MetricCard } from '@/components/ui/MetricCard';
import { ExportButton } from '@/components/ui/ExportButton';
import { DataTable } from '@/components/ui/DataTable';
import { formatDate, formatCurrency } from '@/utils/formatters';
import { getDateRangeFromPreset, type DateRangePreset } from '@/utils/exportHelpers';
import type { ColumnDef } from '@tanstack/react-table';
import { adminService } from '@/services/admin.service';

interface CollectionReportProps {
    startDate: string;
    endDate: string;
    branchId?: string;
    paymentMethod?: 'CASH' | 'UPI' | 'ONLINE' | 'all';
}

interface MethodBreakdown {
    CASH: { amount: number; count: number };
    UPI: { amount: number; count: number };
    ONLINE: { amount: number; count: number };
}

interface BranchBreakdown {
    branchName: string;
    branchId: string;
    totalCollected: number;
    transactionCount: number;
    byMethod: {
        CASH: number;
        UPI: number;
        ONLINE: number;
    };
}

interface DailyTrend {
    date: string;
    amount: number;
    count: number;
}

interface Payment {
    paymentId: string;
    bookingId: string;
    customerName: string;
    customerPhone: string;
    amount: number;
    method: string;
    type: string;
    branch: string;
    collectedAt: string;
}

interface CollectionReportData {
    metadata: {
        generatedAt: string;
        dateRange: {
            startDate: string;
            endDate: string;
        };
        branch: string;
        paymentMethod: string;
    };
    summary: {
        totalCollected: number;
        totalTransactions: number;
        averageTransaction: number;
        methodBreakdown: MethodBreakdown;
    };
    branchBreakdown: BranchBreakdown[];
    dailyTrend: DailyTrend[];
    payments: Payment[];
}

export const CollectionReport = ({
    startDate: initialStartDate,
    endDate: initialEndDate,
    branchId: initialBranchId = 'all',
    paymentMethod: initialPaymentMethod = 'all',
}: CollectionReportProps) => {
    const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>('30days');
    const [startDate, setStartDate] = useState<Date | undefined>(initialStartDate ? new Date(initialStartDate) : undefined);
    const [endDate, setEndDate] = useState<Date | undefined>(initialEndDate ? new Date(initialEndDate) : undefined);
    const [selectedBranch, setSelectedBranch] = useState(initialBranchId);
    const [paymentMethod, setPaymentMethod] = useState(initialPaymentMethod);
    const [data, setData] = useState<CollectionReportData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [branches, setBranches] = useState<Array<{ value: string; label: string }>>([]);

    // Initialize date range from preset if not provided
    useEffect(() => {
        if (!initialStartDate && !initialEndDate && dateRangePreset !== 'custom') {
            const { startDate: start, endDate: end } = getDateRangeFromPreset(dateRangePreset);
            setStartDate(start);
            setEndDate(end);
        }
    }, [dateRangePreset, initialStartDate, initialEndDate]);

    // Fetch branches
    useEffect(() => {
        const loadBranches = async () => {
            try {
                const branchData = await adminService.getBranches();
                setBranches(branchData.map((b: any) => ({ value: b.publicId, label: b.name })));
            } catch (err) {
                console.error('Failed to load branches', err);
            }
        };
        loadBranches();
    }, []);

    useEffect(() => {
        if (startDate && endDate) {
            fetchReportData();
        }
    }, [startDate, endDate, selectedBranch, paymentMethod]);

    const fetchReportData = async () => {
        setLoading(true);
        setError(null);

        try {
            const params = {
                startDate: startDate!.toISOString().split('T')[0],
                endDate: endDate!.toISOString().split('T')[0],
                branchId: selectedBranch,
                paymentMethod,
            };

            const result = await adminService.getCollectionReport(params);
            setData(result.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const getExportUrl = () => {
        if (!startDate || !endDate) return '';
        const params = new URLSearchParams({
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            branchId: selectedBranch,
            paymentMethod,
        });
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        return `${baseUrl}/admin/dashboard/reports/collection?${params.toString()}`;
    };

    const handleApplyFilters = () => {
        fetchReportData();
    };

    const handleResetFilters = () => {
        setDateRangePreset('30days');
        const { startDate: start, endDate: end } = getDateRangeFromPreset('30days');
        setStartDate(start);
        setEndDate(end);
        setSelectedBranch('all');
        setPaymentMethod('all');
    };

    const columns: ColumnDef<Payment>[] = [
        {
            accessorKey: 'paymentId',
            header: 'Payment ID',
            cell: ({ row }) => <span className="font-mono text-xs">{row.original.paymentId}</span>,
        },
        {
            accessorKey: 'bookingId',
            header: 'Booking ID',
            cell: ({ row }) => <span className="font-mono text-xs">{row.original.bookingId}</span>,
        },
        {
            accessorKey: 'customerName',
            header: 'Customer',
            cell: ({ row }) => (
                <div>
                    <div className="font-medium">{row.original.customerName}</div>
                    <div className="text-xs text-gray-500">{row.original.customerPhone}</div>
                </div>
            )
        },
        {
            accessorKey: 'amount',
            header: 'Amount',
            cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.amount)}</span>,
        },
        {
            accessorKey: 'method',
            header: 'Method',
            cell: ({ row }) => <span className="capitalize">{row.original.method.toLowerCase()}</span>,
        },
        {
            accessorKey: 'collectedAt',
            header: 'Date',
            cell: ({ row }) => <span>{formatDate(row.original.collectedAt)}</span>,
        },
    ];

    if (loading) {
        return (
            <div className="space-y-6">
                {/* Header Skeleton */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-64" />
                        <Skeleton className="h-4 w-48" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-9 w-24" />
                        <Skeleton className="h-9 w-24" />
                    </div>
                </div>

                {/* Filters Skeleton */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                    </CardContent>
                </Card>

                {/* Summary Cards Skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <Card key={i}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-4 w-4" />
                            </CardHeader>
                            <CardContent>
                                <Skeleton className="h-8 w-32 mb-2" />
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Charts Skeleton */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <Skeleton className="h-6 w-48" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-[300px] w-full" />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <Skeleton className="h-6 w-48" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-[300px] w-full" />
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <Card className="border-destructive">
                <CardContent className="pt-6">
                    <p className="text-destructive">{error}</p>
                </CardContent>
            </Card>
        );
    }

    if (!data) return null;

    // Prepare chart data for payment method distribution
    const methodChartData = Object.entries(data.summary.methodBreakdown).map(([method, values]) => ({
        name: method,
        value: values.amount,
        count: values.count,
    }));

    const COLORS = {
        CASH: '#10b981', // green
        UPI: '#3b82f6', // blue
        ONLINE: '#f59e0b', // amber
    };

    return (
        <div className="container mx-auto p-4 md:p-6 space-y-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <DollarSign className="h-8 w-8 text-orange-500" />
                        Collection Report
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
                    filename={`collection-report-${startDate?.toISOString().split('T')[0]}-${endDate?.toISOString().split('T')[0]}`}
                    disabled={loading || !data}
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
                onApply={handleApplyFilters}
                onReset={handleResetFilters}
            >
                <div className="space-y-2">
                    <label className="text-sm font-medium">Payment Method</label>
                    <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as any)}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Methods" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Methods</SelectItem>
                            <SelectItem value="CASH">Cash</SelectItem>
                            <SelectItem value="UPI">UPI</SelectItem>
                            <SelectItem value="ONLINE">Online</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </FilterPanel>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    title="Total Collection"
                    value={data ? formatCurrency(data.summary.totalCollected) : '₹0'}
                    icon={DollarSign}
                    variant="revenue"
                    isLoading={loading}
                />
                <MetricCard
                    title="Total Transactions"
                    value={data?.summary.totalTransactions.toString() || '0'}
                    icon={Activity}
                    variant="bookings"
                    isLoading={loading}
                />
                <MetricCard
                    title="Avg. Transaction"
                    value={data ? formatCurrency(data.summary.averageTransaction) : '₹0'}
                    icon={TrendingUp}
                    variant="default"
                    isLoading={loading}
                />
                <MetricCard
                    title="Cash Collection"
                    value={data ? formatCurrency(data.summary.methodBreakdown.CASH.amount) : '₹0'}
                    icon={CreditCard}
                    variant="collection"
                    isLoading={loading}
                />
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Payment Method Distribution */}
                <Card>
                    <CardHeader>
                        <CardTitle>Payment Method Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={methodChartData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {methodChartData.map((entry) => (
                                        <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Daily Collection Trend */}
                <Card>
                    <CardHeader>
                        <CardTitle>Daily Collection Trend</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={data.dailyTrend}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`} />
                                <Legend />
                                <Line
                                    type="monotone"
                                    dataKey="amount"
                                    stroke="#FF5F00"
                                    strokeWidth={2}
                                    name="Amount Collected"
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Branch Breakdown */}
            <Card>
                <CardHeader>
                    <CardTitle>Branch-wise Collection</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={data.branchBreakdown}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="branchName" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`} />
                            <Legend />
                            <Bar dataKey="byMethod.CASH" stackId="a" fill={COLORS.CASH} name="Cash" />
                            <Bar dataKey="byMethod.UPI" stackId="a" fill={COLORS.UPI} name="UPI" />
                            <Bar dataKey="byMethod.ONLINE" stackId="a" fill={COLORS.ONLINE} name="Online" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Recent Payments Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-orange-500" />
                        Recent Transactions
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={data?.payments || []}
                        isLoading={loading}
                        emptyMessage="No transactions found"
                    />
                </CardContent>
            </Card>
        </div>
    );
};
