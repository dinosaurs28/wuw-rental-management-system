import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface PaymentOption {
  id: "CASH" | "ONLINE";
  title: string;
  description: string;
  icon: string;
}

const PAYMENT_OPTIONS: PaymentOption[] = [
  /* Cash payment — temporarily disabled
  {
    id: "CASH",
    title: "Cash",
    description: "Pay at pickup location",
    icon: "💵",
  },
  */
  {
    id: "ONLINE",
    title: "Online",
    description: "Secure online payment",
    icon: "💳",
  },
];

interface PaymentMethodCardProps {
  className?: string;
}

export const PaymentMethodCard = ({ className }: PaymentMethodCardProps) => {
  const { paymentType, setPaymentType } = useVehicleRentalStore();

  return (
    <Card
      className={cn(
        "bg-white border border-zinc-200 rounded-xl shadow-sm",
        className,
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold">Payment Method</CardTitle>
        <p className="text-sm text-muted-foreground">
          How would you like to pay?
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PAYMENT_OPTIONS.map((option) => {
          const isSelected = paymentType === option.id;

          return (
            <button
              key={option.id}
              onClick={() => setPaymentType(option.id)}
              className={cn(
                "relative flex flex-col items-center gap-2 p-5 rounded-lg border-2 transition-all duration-200",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-zinc-200 hover:border-zinc-300 bg-white",
              )}
            >
              {/* Selection Indicator */}
              <div
                className={cn(
                  "absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                  isSelected
                    ? "border-primary bg-primary"
                    : "border-zinc-300 bg-white",
                )}
              >
                {isSelected && <Check className="size-3 text-white" />}
              </div>

              {/* Icon */}
              <div
                className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center text-2xl",
                  isSelected ? "bg-primary/10" : "bg-zinc-100",
                )}
              >
                {option.icon}
              </div>

              {/* Text */}
              <div className="text-center">
                <p
                  className={cn(
                    "font-semibold text-sm",
                    isSelected ? "text-primary" : "text-foreground",
                  )}
                >
                  {option.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
};
