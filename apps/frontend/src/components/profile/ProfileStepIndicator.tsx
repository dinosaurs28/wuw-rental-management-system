import { cn } from '@/lib/utils';

interface Step {
    id: number;
    label: string;
    isCompleted: boolean;
    isCurrent: boolean;
}

interface ProfileStepIndicatorProps {
    currentStep?: number;
}

const steps: Omit<Step, 'isCompleted' | 'isCurrent'>[] = [
    { id: 1, label: 'Personal Info' },
];

export const ProfileStepIndicator = ({ currentStep = 1 }: ProfileStepIndicatorProps) => {
    const stepsWithState: Step[] = steps.map((step) => ({
        ...step,
        isCompleted: step.id < currentStep,
        isCurrent: step.id === currentStep,
    }));

    return (
        <div className="w-full max-w-2xl mx-auto px-4">
            <div className="flex items-center justify-center">
                {stepsWithState.map((step) => (
                    <div key={step.id} className="flex flex-col items-center">
                        {/* Step Circle */}
                        <div
                            className={cn(
                                'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-200',
                                step.isCurrent
                                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                                    : 'bg-muted text-muted-foreground'
                            )}
                        >
                            {step.id}
                        </div>
                        <span
                            className={cn(
                                'mt-2 text-xs font-medium text-center',
                                step.isCurrent
                                    ? 'text-primary'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {step.label}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};
