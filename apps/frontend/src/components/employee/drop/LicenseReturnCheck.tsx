import { IdCard } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface LicenseReturnCheckProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Server message (LICENSE_NOT_RETURNED). */
  error?: string | null;
}

/** Required when staff collected the customer's original licence at pickup. */
export function LicenseReturnCheck({ id, checked, onCheckedChange, disabled, error }: LicenseReturnCheckProps) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border bg-blue-50/40 border-blue-200">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(!!v)}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-semibold cursor-pointer text-blue-900 flex items-center gap-2">
          <IdCard className="h-4 w-4" /> Original driving licence returned to customer
          <span className="text-red-500">*</span>
        </Label>
        <p className="text-xs text-blue-800/80">
          Hand back the physical licence collected at pickup before closing the drop.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
