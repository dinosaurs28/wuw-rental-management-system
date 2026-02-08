import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// ChartContainer Component
// ============================================================================

export interface ChartContainerProps {
    title: string;
    description?: string;
    children: ReactNode;
    isLoading?: boolean;
    isEmpty?: boolean;
    emptyMessage?: string;
    className?: string;
}

export const ChartContainer = ({
    title,
    description,
    children,
    isLoading = false,
    isEmpty = false,
    emptyMessage = 'No data available',
    className,
}: ChartContainerProps) => {
    return (
        <Card className={cn('w-full', className)}>
            <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-orange-500" />
                    {title}
                </CardTitle>
                {description && (
                    <p className="text-sm text-muted-foreground mt-1">{description}</p>
                )}
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-3">
                        <Skeleton className="h-[200px] w-full" />
                        <div className="flex gap-4">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-20" />
                        </div>
                    </div>
                ) : isEmpty ? (
                    <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                        <BarChart3 className="h-12 w-12 mb-2 opacity-20" />
                        <p className="text-sm">{emptyMessage}</p>
                    </div>
                ) : (
                    <div className="w-full">{children}</div>
                )}
            </CardContent>
        </Card>
    );
};
