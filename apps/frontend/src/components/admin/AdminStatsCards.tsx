import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Car, DollarSign, Users } from "lucide-react";

interface AdminStatsCardsProps {
    stats: {
        totalBranches: number;
        totalFleet: number;
        totalRevenue: number;
        activeUsers: number;
    } | null;
    isLoading: boolean;
}

export const AdminStatsCards = ({ stats, isLoading }: AdminStatsCardsProps) => {
    const KPICard = ({
        title,
        value,
        icon: Icon,
        colorClass,
        bgClass,
        prefix = ""
    }: {
        title: string;
        value: string | number | undefined;
        icon: any;
        colorClass: string;
        bgClass: string;
        prefix?: string;
    }) => (
        <Card className="p-5 border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm font-medium text-neutral-500 mb-1">{title}</p>
                    {isLoading ? (
                        <Skeleton className="h-9 w-24" />
                    ) : (
                        <h3 className="text-3xl font-bold tracking-tight">
                            {prefix}{typeof value === 'number' ? value.toLocaleString() : (value ?? 0)}
                        </h3>
                    )}
                </div>
                <div className={`p-3 rounded-lg ${bgClass}`}>
                    <Icon className={`w-5 h-5 ${colorClass}`} />
                </div>
            </div>
        </Card>
    );

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
                title="Total Branches"
                value={stats?.totalBranches}
                icon={Building2}
                colorClass="text-emerald-600"
                bgClass="bg-emerald-50"
            />
            <KPICard
                title="Global Fleet Size"
                value={stats?.totalFleet}
                icon={Car}
                colorClass="text-blue-600"
                bgClass="bg-blue-50"
            />
            <KPICard
                title="Total Revenue"
                value={stats?.totalRevenue}
                icon={DollarSign}
                colorClass="text-violet-600"
                bgClass="bg-violet-50"
                prefix="$"
            />
            <KPICard
                title="Active User Base"
                value={stats?.activeUsers}
                icon={Users}
                colorClass="text-amber-600"
                bgClass="bg-amber-50"
            />
        </div>
    );
};
