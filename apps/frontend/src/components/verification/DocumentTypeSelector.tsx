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
}

export const DocumentTypeSelector = ({
  selectedType,
  onSelectType,
  disabledTypes = [],
}: DocumentTypeSelectorProps) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
      {documentTypes.map((docType) => {
        const isSelected = selectedType === docType.type;
        const isDisabled = disabledTypes.includes(docType.type);

        return (
          <button
            key={docType.type}
            type="button"
            onClick={() => !isDisabled && onSelectType(docType.type)}
            disabled={isDisabled}
            className={cn(
              "relative flex flex-col items-center p-6 sm:p-8 rounded-[1.5rem] border border-white/5 transition-all duration-300 overflow-hidden group",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
              isSelected
                ? "bg-white/10 border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                : "bg-black/40 hover:bg-black/60 hover:border-white/10",
              isDisabled &&
                "opacity-50 cursor-not-allowed hover:border-white/5 hover:bg-black/40",
            )}
          >
            {/* Subtle gradient for selected state */}
            {isSelected && (
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none" />
            )}
            {/* Uploaded Badge */}
            {isDisabled && (
              <span className="absolute top-4 right-4 text-[9px] font-black tracking-widest uppercase bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/20">
                Uploaded
              </span>
            )}

            {/* Icon */}
            <div
              className={cn(
                "p-4 rounded-full mb-4 transition-colors relative z-10",
                isSelected
                  ? "bg-white text-zinc-950 shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                  : "bg-white/5 text-zinc-400 group-hover:bg-white/10 group-hover:text-white",
              )}
            >
              {docType.icon}
            </div>

            {/* Label */}
            <h3
              className={cn(
                "text-base font-bold mb-1 text-center tracking-wide relative z-10 transition-colors",
                isSelected
                  ? "text-white"
                  : "text-zinc-300 group-hover:text-white",
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
