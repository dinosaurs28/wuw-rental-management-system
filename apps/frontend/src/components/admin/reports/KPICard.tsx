import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import React from "react";

export interface KPICardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    trend?: number; // percentage change
    trendLabel?: string;
    icon: LucideIcon;
    colorTheme: "blue" | "emerald" | "violet" | "amber" | "cyan" | "rose";
    loading?: boolean;
}

const colorStyles = {
    blue: {
        bg: "bg-blue-500/10",
        border: "border-blue-500/20",
        text: "text-blue-500",
        iconBg: "bg-blue-500/20",
        gradient: "from-blue-500/5 to-transparent",
    },
    emerald: {
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/20",
        text: "text-emerald-500",
        iconBg: "bg-emerald-500/20",
        gradient: "from-emerald-500/5 to-transparent",
    },
    violet: {
        bg: "bg-violet-500/10",
        border: "border-violet-500/20",
        text: "text-violet-500",
        iconBg: "bg-violet-500/20",
        gradient: "from-violet-500/5 to-transparent",
    },
    amber: {
        bg: "bg-amber-500/10",
        border: "border-amber-500/20",
        text: "text-amber-500",
        iconBg: "bg-amber-500/20",
        gradient: "from-amber-500/5 to-transparent",
    },
    cyan: {
        bg: "bg-cyan-500/10",
        border: "border-cyan-500/20",
        text: "text-cyan-500",
        iconBg: "bg-cyan-500/20",
        gradient: "from-cyan-500/5 to-transparent",
    },
    rose: {
        bg: "bg-rose-500/10",
        border: "border-rose-500/20",
        text: "text-rose-500",
        iconBg: "bg-rose-500/20",
        gradient: "from-rose-500/5 to-transparent",
    },
};

export const KPICard: React.FC<KPICardProps> = ({
    title,
    value,
    subtitle,
    trend,
    trendLabel,
    icon: Icon,
    colorTheme,
    loading = false,
}) => {
    const styles = colorStyles[colorTheme];

    if (loading) {
        return (
            <div className="h-40 rounded-xl bg-muted/20 animate-pulse border border-muted/30" />
        );
    }

    const isTrendPositive = trend !== undefined && trend > 0;
    const isTrendNegative = trend !== undefined && trend < 0;
    const isTrendNeutral = trend !== undefined && trend === 0;

    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-xl border p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg group",
                "bg-card/50 backdrop-blur-sm",
                styles.border
            )}
        >
            <div
                className={cn(
                    "absolute inset-0 bg-gradient-to-br opacity-50 transition-opacity group-hover:opacity-100",
                    styles.gradient
                )}
            />

            <div className="relative z-10 flex flex-col justify-between h-full">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">
                            {title}
                        </p>
                        <h3 className="text-2xl font-bold tracking-tight text-foreground font-mono">
                            {value}
                        </h3>
                    </div>
                    <div
                        className={cn(
                            "p-2.5 rounded-lg transition-transform group-hover:scale-110 duration-300",
                            styles.iconBg,
                            styles.text
                        )}
                    >
                        <Icon className="w-5 h-5" />
                    </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                    {subtitle && (
                        <p className="text-xs text-muted-foreground">{subtitle}</p>
                    )}

                    {trend !== undefined && (
                        <div
                            className={cn(
                                "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                                isTrendPositive
                                    ? "bg-emerald-500/10 text-emerald-500"
                                    : isTrendNegative
                                        ? "bg-red-500/10 text-red-500"
                                        : "bg-gray-500/10 text-gray-500"
                            )}
                        >
                            {isTrendPositive && <ArrowUp className="w-3 h-3" />}
                            {isTrendNegative && <ArrowDown className="w-3 h-3" />}
                            {isTrendNeutral && <Minus className="w-3 h-3" />}
                            <span>{Math.abs(trend)}%</span>
                            {trendLabel && <span className="ml-1 opacity-70">{trendLabel}</span>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
