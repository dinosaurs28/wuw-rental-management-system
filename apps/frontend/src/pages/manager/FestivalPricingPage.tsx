import { PartyPopper } from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { FestivalPricingManager } from "@/components/manager/pricing/FestivalPricingManager";

/** Festival pricing for the manager's branch (e.g. Dussehra +10% for three days). */
export default function FestivalPricingPage() {
  return (
    <ManagerLayout>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <PartyPopper className="size-6 text-primary" />
            Festival Pricing
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Change every vehicle's rent — or some categories' or vehicles' — by a percentage for festival dates.
          </p>
        </div>
        <FestivalPricingManager portal={{ kind: "manager" }} />
      </div>
    </ManagerLayout>
  );
}
