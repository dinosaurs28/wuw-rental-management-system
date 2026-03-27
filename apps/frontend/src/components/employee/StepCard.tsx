import { CheckCircle, Lock } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StepCardProps {
  stepNum: number;
  title: string;
  subtitle?: string;
  isCompleted: boolean;
  isLocked: boolean;
  children: React.ReactNode;
}

export function StepCard({
  stepNum,
  title,
  subtitle,
  isCompleted,
  isLocked,
  children,
}: StepCardProps) {
  return (
    <Card
      className={cn(
        "shadow-sm border transition-all duration-200",
        isLocked
          ? "border-gray-200 opacity-60"
          : isCompleted
            ? "border-green-200 bg-green-50/30"
            : "border-gray-200 bg-white",
      )}
    >
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold shrink-0",
              isLocked
                ? "border-gray-300 bg-gray-100 text-gray-400"
                : isCompleted
                  ? "border-[#FF5F00] bg-[#FF5F00] text-white"
                  : "border-[#FF5F00] bg-white text-[#FF5F00]",
            )}
          >
            {isCompleted ? <CheckCircle className="h-4 w-4" /> : stepNum}
          </div>
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-gray-900">{title}</CardTitle>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {isLocked && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Lock className="h-3.5 w-3.5" />
              <span>Locked</span>
            </div>
          )}
        </div>
      </CardHeader>
      <div className={cn(isLocked ? "pointer-events-none select-none" : "")}>{children}</div>
    </Card>
  );
}
