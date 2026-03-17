import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ============================================================================
// TrendIndicator Component
// ============================================================================

export interface TrendIndicatorProps {
  value: number; // Percentage change
  label?: string; // Optional label (e.g., "vs yesterday")
  showIcon?: boolean;
  showSign?: boolean; // Show + or - sign
  className?: string;
}

export const TrendIndicator = ({
  value,
  label,
  showIcon = true,
  showSign = true,
  className,
}: TrendIndicatorProps) => {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const isNeutral = value === 0;

  const colorClass = isPositive
    ? "text-green-600"
    : isNegative
      ? "text-red-600"
      : "text-gray-600";

  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  const sign = showSign && !isNeutral ? (isPositive ? "+" : "-") : "";

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {showIcon && <Icon className={cn("h-3 w-3", colorClass)} />}
      <span className={cn("text-sm font-medium", colorClass)}>
        {sign}
        {Math.abs(value).toFixed(1)}%
      </span>
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
};
