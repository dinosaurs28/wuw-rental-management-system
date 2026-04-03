import { useState } from "react";
import { FileMinusIcon, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import apiClient from "@/lib/axios";
import { formatCurrency } from "@/utils/formatters";

interface CreditNote {
  publicId: string;
  creditNoteNumber: string | null;
  invoiceRef: { publicId: string; invoiceNumber: string | null } | null;
  receiptRef: { publicId: string; receiptNumber: string | null } | null;
  amount: number;
  reason: string;
  status: string;
  issuedBy: string;
  createdAt: string;
}

interface CreditNoteDialogProps {
  bookingPublicId: string;
  invoicePublicId?: string;
  receiptPublicId?: string;
  existingCreditNotes?: CreditNote[];
  onIssued?: (cn: CreditNote) => void;
}

export const CreditNoteDialog = ({
  bookingPublicId,
  invoicePublicId,
  receiptPublicId,
  existingCreditNotes = [],
  onIssued,
}: CreditNoteDialogProps) => {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      toast.error("Enter a valid positive amount.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Reason is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiClient.post("/branchManager/credit-notes", {
        bookingPublicId,
        invoicePublicId,
        receiptPublicId,
        amount: amountNum,
        reason: reason.trim(),
      });
      toast.success(`Credit note ${res.data.data.creditNoteNumber} issued.`);
      onIssued?.(res.data.data);
      setAmount("");
      setReason("");
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Failed to issue credit note.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileMinusIcon className="h-4 w-4" />
          Issue Credit Note
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileMinusIcon className="h-5 w-5 text-purple-600" />
            Issue Credit Note
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* References */}
          <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-1">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">References</p>
            {invoicePublicId && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Invoice</span>
                <Badge variant="outline" className="font-mono text-xs">{invoicePublicId.slice(0, 8)}</Badge>
              </div>
            )}
            {receiptPublicId && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Return Receipt</span>
                <Badge variant="outline" className="font-mono text-xs">{receiptPublicId.slice(0, 8)}</Badge>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Booking</span>
              <Badge variant="outline" className="font-mono text-xs">{bookingPublicId.slice(0, 8)}</Badge>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cn-amount">Discount / Credit Amount (₹)</Label>
            <Input
              id="cn-amount"
              type="number"
              min={1}
              placeholder="e.g. 500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cn-reason">Reason</Label>
            <Textarea
              id="cn-reason"
              placeholder="e.g. Goodwill discount for delay in service"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Issue Credit Note
          </Button>

          {/* Existing credit notes */}
          {existingCreditNotes.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                Previous Credit Notes ({existingCreditNotes.length})
              </p>
              {existingCreditNotes.map((cn) => (
                <div key={cn.publicId} className="rounded-lg border p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-purple-700">
                      {cn.creditNoteNumber ?? `CN-${cn.publicId.slice(0, 6)}`}
                    </span>
                    <span className="font-semibold">{formatCurrency(cn.amount)}</span>
                  </div>
                  <p className="text-gray-600 text-xs">{cn.reason}</p>
                  <p className="text-gray-400 text-xs">Issued by {cn.issuedBy}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
