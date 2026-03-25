import type { KycDocument } from "@/services/kyc.service";
import { UploadedDocumentCard } from "./UploadedDocumentCard";
import { FileX } from "lucide-react";

interface UploadedDocumentsGridProps {
  documents: KycDocument[];
  onDeleteDocument: (publicId: string) => void;
  deletingDocumentId: string | null;
}

export const UploadedDocumentsGrid = ({
  documents,
  onDeleteDocument,
  deletingDocumentId,
}: UploadedDocumentsGridProps) => {
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-[2rem] border border-dashed border-zinc-200 bg-zinc-50">
        <div className="p-4 bg-zinc-100 rounded-full mb-6 border border-zinc-200">
          <FileX className="w-8 h-8 text-zinc-400" />
        </div>
        <h3 className="text-lg font-serif font-bold text-zinc-900 mb-2">
          No documents uploaded
        </h3>
        <p className="text-sm font-medium text-zinc-500 max-w-sm">
          Select a document type above and upload your KYC documents to continue
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
        <h3 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest">
          Uploaded Documents ({documents.length})
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {documents.map((doc) => (
          <UploadedDocumentCard
            key={doc.publicId}
            document={doc}
            onDelete={onDeleteDocument}
            isDeleting={deletingDocumentId === doc.publicId}
          />
        ))}
      </div>
    </div>
  );
};
