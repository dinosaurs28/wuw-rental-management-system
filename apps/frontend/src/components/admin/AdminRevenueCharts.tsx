import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend,
    BarChart,
    Bar
} from "recharts";
import { type RevenueTrendItem, type CategoryRevenueItem, type PaymentMethodItem } from "@/services/admin.service";

const COLORS = ['#FF5F00', '#FF8533', '#FFAA66', '#FFD699', '#FFE5CC'];

interface RevenueTrendChartProps {
    data: RevenueTrendItem[];
    isLoading: boolean;
}

export const RevenueTrendChart = ({ data, isLoading }: RevenueTrendChartProps) => {
    if (isLoading) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Revenue Trends</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <Skeleton className="h-[300px] w-full rounded-lg" />
                </CardContent>
            </Card>
        );
    }

    if (data.length === 0) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Revenue Trends</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex flex-col items-center justify-center h-[300px] text-neutral-500">
                        <p>No revenue data available</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
            <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                <CardTitle className="text-lg font-semibold text-neutral-900">Revenue Trends</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                            dataKey="period"
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                        />
                        <YAxis
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                            tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '8px 12px'
                            }}
                            formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                        />
                        <Line
                            type="monotone"
                            dataKey="totalRevenue"
                            stroke="#FF5F00"
                            strokeWidth={2}
                            dot={{ fill: '#FF5F00', r: 4 }}
                            activeDot={{ r: 6 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};

interface CategoryBreakdownChartProps {
    data: CategoryRevenueItem[];
    isLoading: boolean;
}

export const CategoryBreakdownChart = ({ data, isLoading }: CategoryBreakdownChartProps) => {
    if (isLoading) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Category Revenue</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <Skeleton className="h-[300px] w-full rounded-lg" />
                </CardContent>
            </Card>
        );
    }

    if (data.length === 0) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Category Revenue</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex flex-col items-center justify-center h-[300px] text-neutral-500">
                        <p>No category data available</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const chartData = data.map((item, index) => ({
        name: item.categoryName,
        value: item.totalRevenue,
        fill: COLORS[index % COLORS.length]
    }));

    return (
        <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
            <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                <CardTitle className="text-lg font-semibold text-neutral-900">Category Revenue Distribution</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number) => `₹${value.toLocaleString()}`}
                            contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '8px 12px'
                            }}
                        />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};

interface BranchComparisonChartProps {
    data: { branchName: string; totalRevenue: number }[];
    isLoading: boolean;
}

export const BranchComparisonChart = ({ data, isLoading }: BranchComparisonChartProps) => {
    if (isLoading) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white col-span-1 lg:col-span-2">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Branch Performance</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <Skeleton className="h-[300px] w-full rounded-lg" />
                </CardContent>
            </Card>
        );
    }

    if (data.length === 0) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white col-span-1 lg:col-span-2">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Branch Performance</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex flex-col items-center justify-center h-[300px] text-neutral-500">
                        <p>No branch data available</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white col-span-1 lg:col-span-2">
            <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                <CardTitle className="text-lg font-semibold text-neutral-900">Branch Performance Comparison</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                            type="number"
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                            tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`}
                        />
                        <YAxis
                            type="category"
                            dataKey="branchName"
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                            width={120}
                        />
                        <Tooltip
                            formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                            contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '8px 12px'
                            }}
                        />
                        <Bar dataKey="totalRevenue" fill="#FF5F00" radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};

interface PaymentMethodChartProps {
    data: PaymentMethodItem[];
    isLoading: boolean;
}

export const PaymentMethodChart = ({ data, isLoading }: PaymentMethodChartProps) => {
    if (isLoading) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Payment Methods</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <Skeleton className="h-[300px] w-full rounded-lg" />
                </CardContent>
            </Card>
        );
    }

    if (data.length === 0) {
        return (
            <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
                <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                    <CardTitle className="text-lg font-semibold text-neutral-900">Payment Methods</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex flex-col items-center justify-center h-[300px] text-neutral-500">
                        <p>No payment data available</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const chartData = data.map((item, index) => ({
        name: item.paymentMethod === 'ONLINE_RAZORPAY' ? 'Online' : item.paymentMethod === 'CASH' ? 'Cash' : item.paymentMethod.toUpperCase(),
        value: item.totalRevenue,
        percentage: item.percentageShare,
        count: item.transactionCount,
        fill: COLORS[index % COLORS.length]
    }));

    return (
        <Card className="border border-neutral-200 shadow-sm rounded-xl bg-white">
            <CardHeader className="border-b border-neutral-100 bg-neutral-50/30 py-4">
                <CardTitle className="text-lg font-semibold text-neutral-900">Payment Method Distribution</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, percentage }) => `${name} ${percentage.toFixed(1)}%`}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number, name: string, props: any) => [
                                `₹${value.toLocaleString()} (${props.payload.count} transactions)`,
                                name
                            ]}
                            contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '8px 12px'
                            }}
                        />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};
