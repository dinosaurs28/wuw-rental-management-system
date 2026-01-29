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
        <Card className="p-6 border border-neutral-200 shadow-sm hover:shadow-md transition-all hover:border-[#FF5F00]/20 bg-white rounded-xl group relative overflow-hidden">
            <div className="flex items-start justify-between relative z-10">
                <div>
                    <p className="text-sm font-medium text-neutral-500 mb-2">{title}</p>
                    {isLoading ? (
                        <Skeleton className="h-9 w-24" />
                    ) : (
                        <h3 className="text-3xl font-bold tracking-tight text-neutral-900">
                            {prefix}{typeof value === 'number' ? value.toLocaleString() : (value ?? 0)}
                        </h3>
                    )}
                </div>
                <div className={`p-3 rounded-xl transition-colors ${bgClass} group-hover:bg-white border border-transparent group-hover:border-neutral-100 group-hover:shadow-sm`}>
                    <Icon className={`w-5 h-5 ${colorClass}`} />
                </div>
            </div>
            {/* Subtle decorative background gradient */}
            <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 rounded-full bg-gradient-to-br from-transparent to-neutral-50 opacity-50 pointer-events-none group-hover:scale-110 transition-transform duration-500" />
        </Card>
    );

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
                title="Total Branches"
                value={stats?.totalBranches}
                icon={Building2}
                colorClass="text-neutral-700"
                bgClass="bg-neutral-100"
            />
            <KPICard
                title="Global Fleet Size"
                value={stats?.totalFleet}
                icon={Car}
                colorClass="text-neutral-700"
                bgClass="bg-neutral-100"
            />
            <KPICard
                title="Total Revenue"
                value={stats?.totalRevenue}
                icon={DollarSign}
                colorClass="text-[#FF5F00]"
                bgClass="bg-orange-50"
                prefix="₹"
            />
            <KPICard
                title="Active User Base"
                value={stats?.activeUsers}
                icon={Users}
                colorClass="text-neutral-700"
                bgClass="bg-neutral-100"
            />
        </div>
    );
};
