import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface TermsCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export const TermsCheckbox = ({
  checked,
  onCheckedChange,
  className,
}: TermsCheckboxProps) => {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Checkbox
        id="terms"
        checked={checked}
        onCheckedChange={(checked) => onCheckedChange(checked === true)}
        className="mt-0.5"
      />
      <label
        htmlFor="terms"
        className="text-sm text-muted-foreground cursor-pointer leading-relaxed"
      >
        I accept the{" "}
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium"
        >
          General Terms & Conditions
        </a>
        , Rental Information and{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium"
        >
          Privacy Policy
        </a>
        .
      </label>
    </div>
  );
};
