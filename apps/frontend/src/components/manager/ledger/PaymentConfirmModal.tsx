import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (method: "CASH" | "ONLINE", transactionRef?: string) => void;
  loading: boolean;
  totalAmount: number;
}

export function PaymentConfirmModal({ open, onClose, onConfirm, loading, totalAmount }: Props) {
  const [method, setMethod] = useState<"CASH" | "ONLINE">("CASH");
  const [transactionRef, setTransactionRef] = useState("");

  const canSubmit = method === "CASH" || (method === "ONLINE" && transactionRef.trim().length > 0);

  function handleConfirm() {
    if (!canSubmit) return;
    onConfirm(method, method === "ONLINE" ? transactionRef.trim() : undefined);
  }

  function formatAmount(val: number) {
    return `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-3 text-center">
            <p className="text-xs text-orange-600 mb-0.5">Amount to clear</p>
            <p className="text-2xl font-bold text-orange-700">{formatAmount(totalAmount)}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Payment Method</Label>
            <RadioGroup
              value={method}
              onValueChange={(v) => setMethod(v as "CASH" | "ONLINE")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="CASH" id="pay-cash" />
                <Label htmlFor="pay-cash" className="cursor-pointer">Cash</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="ONLINE" id="pay-online" />
                <Label htmlFor="pay-online" className="cursor-pointer">Online (UPI / QR)</Label>
              </div>
            </RadioGroup>
          </div>

          {method === "ONLINE" && (
            <div className="space-y-1">
              <Label htmlFor="txn-ref" className="text-sm">Transaction Reference *</Label>
              <Input
                id="txn-ref"
                placeholder="Enter transaction / UTR ID"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
              />
              <p className="text-xs text-zinc-500">
                Ask the customer for the UPI transaction ID after they complete the payment via QR code.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit || loading}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirm & Clear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
