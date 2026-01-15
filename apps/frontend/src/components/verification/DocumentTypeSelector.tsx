import { cn } from '@/lib/utils';
import type { KycDocumentType } from '@/services/kyc.service';
import { CreditCard, FileText, User } from 'lucide-react';

interface DocumentTypeOption {
    type: KycDocumentType;
    label: string;
    description: string;
    icon: React.ReactNode;
}

const documentTypes: DocumentTypeOption[] = [
    {
        type: 'DL',
        label: "Driver's License",
        description: 'Front & back image required',
        icon: <CreditCard className="w-6 h-6" />,
    },
    {
        type: 'AADHAAR',
        label: 'Aadhaar',
        description: 'Valid government-issued ID',
        icon: <User className="w-6 h-6" />,
    },
    {
        type: 'PAN',
        label: 'PAN Card',
        description: 'Tax identification card',
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
                            'relative flex flex-col items-center p-4 sm:p-6 rounded-lg border-2 transition-all duration-200',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                            isSelected
                                ? 'border-primary bg-primary/5 shadow-md'
                                : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50',
                            isDisabled && 'opacity-50 cursor-not-allowed hover:border-border hover:bg-card'
                        )}
                    >
                        {/* Uploaded Badge */}
                        {isDisabled && (
                            <span className="absolute top-2 right-2 text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                Uploaded
                            </span>
                        )}

                        {/* Icon */}
                        <div
                            className={cn(
                                'p-3 rounded-full mb-3 transition-colors',
                                isSelected
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground'
                            )}
                        >
                            {docType.icon}
                        </div>

                        {/* Label */}
                        <h3
                            className={cn(
                                'text-sm font-semibold mb-1 text-center',
                                isSelected ? 'text-primary' : 'text-foreground'
                            )}
                        >
                            {docType.label}
                        </h3>

                        {/* Description */}
                        <p className="text-xs text-muted-foreground text-center">
                            {docType.description}
                        </p>
                    </button>
                );
            })}
        </div>
    );
};
