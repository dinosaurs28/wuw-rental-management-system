import { cn } from "@/lib/utils";
import type { KycDocumentType } from "@/services/kyc.service";
import { CreditCard, FileText, User } from "lucide-react";

interface DocumentTypeOption {
  type: KycDocumentType;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const documentTypes: DocumentTypeOption[] = [
  {
    type: "DL",
    label: "Driver's License",
    description: "Front & back image required",
    icon: <CreditCard className="w-6 h-6" />,
  },
  {
    type: "AADHAAR",
    label: "Aadhaar",
    description: "Valid government-issued ID",
    icon: <User className="w-6 h-6" />,
  },
  {
    type: "PAN",
    label: "PAN Card",
    description: "Tax identification card",
    icon: <FileText className="w-6 h-6" />,
  },
];

interface DocumentTypeSelectorProps {
  selectedType: KycDocumentType | null;
  onSelectType: (type: KycDocumentType) => void;
  disabledTypes?: KycDocumentType[];
  partialTypes?: KycDocumentType[];
}

export const DocumentTypeSelector = ({
  selectedType,
  onSelectType,
  disabledTypes = [],
  partialTypes = [],
}: DocumentTypeSelectorProps) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
      {documentTypes.map((docType) => {
        const isSelected = selectedType === docType.type;
        const isDisabled = disabledTypes.includes(docType.type);
        const isPartial = partialTypes.includes(docType.type);

        return (
          <button
            key={docType.type}
            type="button"
            onClick={() => !isDisabled && onSelectType(docType.type)}
            disabled={isDisabled}
            className={cn(
              "relative flex flex-col items-center p-6 sm:p-8 rounded-[1.5rem] border border-zinc-200 transition-all duration-300 overflow-hidden group",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/30",
              isSelected
                ? "bg-orange-50 border-orange-300 shadow-[0_0_30px_rgba(249,115,22,0.1)]"
                : "bg-zinc-50 hover:bg-zinc-100 hover:border-zinc-300",
              isDisabled &&
                "opacity-50 cursor-not-allowed hover:border-zinc-200 hover:bg-zinc-50",
            )}
          >
            {/* Subtle gradient for selected state */}
            {isSelected && (
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none" />
            )}
            {/* Status Badge */}
            {isDisabled && (
              <span className="absolute top-4 right-4 text-[9px] font-black tracking-widest uppercase bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/20">
                Complete
              </span>
            )}
            {isPartial && !isDisabled && (
              <span className="absolute top-4 right-4 text-[9px] font-black tracking-widest uppercase bg-amber-500/20 text-amber-500 px-3 py-1 rounded-full border border-amber-500/20">
                1/2
              </span>
            )}

            {/* Icon */}
            <div
              className={cn(
                "p-4 rounded-full mb-4 transition-colors relative z-10",
                isSelected
                  ? "bg-orange-500 text-white shadow-[0_0_20px_rgba(249,115,22,0.2)]"
                  : "bg-zinc-100 text-zinc-500 group-hover:bg-zinc-200 group-hover:text-zinc-700",
              )}
            >
              {docType.icon}
            </div>

            {/* Label */}
            <h3
              className={cn(
                "text-base font-bold mb-1 text-center tracking-wide relative z-10 transition-colors",
                isSelected
                  ? "text-zinc-900"
                  : "text-zinc-700 group-hover:text-zinc-900",
              )}
            >
              {docType.label}
            </h3>

            {/* Description */}
            <p className="text-xs font-medium text-zinc-500 text-center relative z-10">
              {docType.description}
            </p>
          </button>
        );
      })}
    </div>
  );
};
