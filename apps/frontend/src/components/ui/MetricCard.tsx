import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// ============================================================================
// MetricCard Component
// ============================================================================

export interface MetricCardProps {
    title: string;
    value: string | number;
    icon?: React.ComponentType<{ className?: string }>;
    trend?: {
        value: number; // Percentage change
        label: string; // e.g., "vs yesterday"
    };
    variant?: 'default' | 'revenue' | 'bookings' | 'fleet' | 'collection';
    isLoading?: boolean;
    className?: string;
}

const variantStyles = {
    default: 'from-blue-500/10 to-blue-600/10 border-blue-500/20',
    revenue: 'from-emerald-500/10 to-emerald-600/10 border-emerald-500/20',
    bookings: 'from-blue-500/10 to-blue-600/10 border-blue-500/20',
    fleet: 'from-violet-500/10 to-violet-600/10 border-violet-500/20',
    collection: 'from-amber-500/10 to-amber-600/10 border-amber-500/20',
};

const variantIconColors = {
    default: 'text-blue-500',
    revenue: 'text-emerald-500',
    bookings: 'text-blue-500',
    fleet: 'text-violet-500',
    collection: 'text-amber-500',
};

export const MetricCard = ({
    title,
    value,
    icon: Icon,
    trend,
    variant = 'default',
    isLoading = false,
    className,
}: MetricCardProps) => {
    if (isLoading) {
        return (
            <Card className={cn('border', variantStyles[variant], className)}>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                        {title}
                    </CardTitle>
                    {Icon && <Skeleton className="h-4 w-4 rounded" />}
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-8 w-24 mb-2" />
                    {trend && <Skeleton className="h-4 w-20" />}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card
            className={cn(
                'border transition-all duration-300 hover:shadow-md bg-gradient-to-br',
                variantStyles[variant],
                className
            )}
        >
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                    {title}
                </CardTitle>
                {Icon && (
                    <Icon className={cn('h-4 w-4', variantIconColors[variant])} />
                )}
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-mono">{value}</div>
                {trend && (
                    <div className="flex items-center gap-1 mt-1">
                        <span
                            className={cn(
                                'text-xs font-medium',
                                trend.value > 0 ? 'text-green-600' : trend.value < 0 ? 'text-red-600' : 'text-gray-600'
                            )}
                        >
                            {trend.value > 0 ? '↑' : trend.value < 0 ? '↓' : '•'} {Math.abs(trend.value).toFixed(1)}%
                        </span>
                        <span className="text-xs text-muted-foreground">{trend.label}</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
