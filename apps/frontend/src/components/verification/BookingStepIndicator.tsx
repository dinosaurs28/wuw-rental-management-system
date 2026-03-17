import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  id: number;
  label: string;
  isCompleted: boolean;
  isCurrent: boolean;
}

interface BookingStepIndicatorProps {
  currentStep: number;
}

const steps: Omit<Step, "isCompleted" | "isCurrent">[] = [
  { id: 1, label: "Vehicle Selection" },
  { id: 2, label: "KYC Verification" },
  { id: 3, label: "Review & Pay" },
];

export const BookingStepIndicator = ({
  currentStep,
}: BookingStepIndicatorProps) => {
  const stepsWithState: Step[] = steps.map((step) => ({
    ...step,
    isCompleted: step.id < currentStep,
    isCurrent: step.id === currentStep,
  }));

  return (
    <div className="w-full max-w-2xl mx-auto px-4">
      <div className="flex items-center justify-between">
        {stepsWithState.map((step, index) => (
          <div key={step.id} className="flex items-center flex-1">
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-200",
                  step.isCompleted
                    ? "bg-primary text-primary-foreground"
                    : step.isCurrent
                      ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {step.isCompleted ? <Check className="w-5 h-5" /> : step.id}
              </div>
              <span
                className={cn(
                  "mt-2 text-xs font-medium text-center hidden sm:block",
                  step.isCurrent
                    ? "text-primary"
                    : step.isCompleted
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connector Line */}
            {index < stepsWithState.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2 sm:mx-4 transition-colors duration-200",
                  step.isCompleted ? "bg-primary" : "bg-muted",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Mobile Labels */}
      <p className="text-center text-sm font-medium text-primary mt-4 sm:hidden">
        {stepsWithState.find((s) => s.isCurrent)?.label}
      </p>
    </div>
  );
};
