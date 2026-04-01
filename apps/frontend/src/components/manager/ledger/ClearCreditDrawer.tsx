import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, IndianRupee } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentConfirmModal } from "./PaymentConfirmModal";
import { CreditBookingCard } from "./CreditBookingCard";
import { ledgerService, type CreditSection } from "@/services/ledger.service";

interface Props {
  open: boolean;
  onClose: () => void;
  customerPublicId: string;
  onSuccess: () => void;
}

function formatAmount(val: string | number) {
  return `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ClearCreditDrawer({ open, onClose, customerPublicId, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const entriesQuery = useQuery({
    queryKey: ["ledger", "entries", customerPublicId],
    queryFn: () => ledgerService.getCustomerEntries(customerPublicId, 1, 50),
    enabled: open,
    select: (data) =>
      data.data.filter((e) => e.status === "PENDING" || e.status === "PARTIALLY_CLEARED"),
  });

  const creditQuery = useQuery({
    queryKey: ["ledger", "entry", selectedCreditId],
    queryFn: () => ledgerService.getCreditEntry(selectedCreditId!),
    enabled: !!selectedCreditId && step === 2,
  });

  const clearMutation = useMutation({
    mutationFn: ({ method, ref }: { method: "CASH" | "ONLINE"; ref?: string }) =>
      ledgerService.clearCredit(selectedCreditId!, selectedKeys, method, ref),
    onSuccess: () => {
      toast.success("Credit cleared successfully");
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      onSuccess();
      handleClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? "Failed to clear credit";
      toast.error(msg);
    },
  });

  function handleClose() {
    setStep(1);
    setSelectedCreditId(null);
    setSelectedKeys([]);
    setPaymentModalOpen(false);
    onClose();
  }

  function handleEntrySelect(creditPublicId: string) {
    setSelectedCreditId(creditPublicId);
    setSelectedKeys([]);
    setStep(2);
  }

  function handleToggleSection(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const pendingSections: CreditSection[] = useMemo(() => {
    if (!creditQuery.data) return [];
    return (creditQuery.data.sections ?? []).filter((s) => !s.isCleared);
  }, [creditQuery.data]);

  const selectedTotal = useMemo(() => {
    return pendingSections
      .filter((s) => selectedKeys.includes(s.sectionKey))
      .reduce((sum, s) => sum + s.amount, 0);
  }, [pendingSections, selectedKeys]);

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
          <SheetHeader className="px-6 py-4 border-b">
            <div className="flex items-center gap-3">
              {step === 2 && (
                <button
                  type="button"
                  onClick={() => { setStep(1); setSelectedCreditId(null); }}
                  className="text-zinc-500 hover:text-zinc-800 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <SheetTitle>{step === 1 ? "Select Credit Entry" : "Clear Credit"}</SheetTitle>
            </div>
            <div className="flex gap-2 mt-1">
              <div className="h-1 flex-1 rounded-full bg-orange-500" />
              <div className={`h-1 flex-1 rounded-full ${step === 2 ? "bg-orange-500" : "bg-zinc-200"}`} />
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Step 1: Credit entries list */}
            {step === 1 && (
              <div className="space-y-3">
                {entriesQuery.isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-xl" />
                  ))
                ) : (entriesQuery.data?.length ?? 0) === 0 ? (
                  <div className="text-center py-10 text-zinc-500 text-sm">
                    No pending credit entries for this customer.
                  </div>
                ) : (
                  entriesQuery.data?.map((entry) => (
                    <CreditBookingCard
                      key={entry.publicId}
                      booking={entry}
                      creditPublicId={entry.publicId}
                      onClick={() => handleEntrySelect(entry.publicId)}
                      isSelected={selectedCreditId === entry.publicId}
                    />
                  ))
                )}
              </div>
            )}

            {/* Step 2: Section selector */}
            {step === 2 && (
              <div className="space-y-3">
                {creditQuery.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                  </div>
                ) : pendingSections.length === 0 ? (
                  <p className="text-center py-8 text-sm text-zinc-500">
                    All sections have been cleared for this booking.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {pendingSections.map((section) => {
                      const isChecked = selectedKeys.includes(section.sectionKey);
                      return (
                        <div
                          key={section.sectionKey}
                          className="flex items-center gap-3 rounded-lg border px-3 py-2.5 bg-white"
                        >
                          <Checkbox
                            id={`clear-${section.sectionKey}`}
                            checked={isChecked}
                            onCheckedChange={() => handleToggleSection(section.sectionKey)}
                          />
                          <Label
                            htmlFor={`clear-${section.sectionKey}`}
                            className="flex-1 text-sm cursor-pointer"
                          >
                            {section.label}
                            {section.isCustom && (
                              <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                                Custom
                              </span>
                            )}
                          </Label>
                          <span className="text-sm font-medium text-zinc-700 shrink-0">
                            {formatAmount(section.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Already cleared sections (read-only) */}
                {creditQuery.data && creditQuery.data.sections.some((s) => s.isCleared) && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
                      Already Cleared
                    </p>
                    <div className="space-y-1.5">
                      {creditQuery.data.sections
                        .filter((s) => s.isCleared)
                        .map((section) => (
                          <div
                            key={section.sectionKey}
                            className="flex items-center gap-3 rounded-lg border px-3 py-2 bg-zinc-50 opacity-60"
                          >
                            <div className="w-4 h-4 rounded border-2 border-green-500 bg-green-100 flex items-center justify-center">
                              <span className="text-green-600 text-xs">✓</span>
                            </div>
                            <span className="flex-1 text-sm text-zinc-500">{section.label}</span>
                            <span className="text-sm text-zinc-400 line-through">
                              {formatAmount(section.amount)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {step === 2 && (
            <div className="border-t px-6 py-4 space-y-3">
              {selectedKeys.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">{selectedKeys.length} section(s) selected</span>
                  <span className="font-semibold flex items-center gap-1">
                    <IndianRupee className="w-3.5 h-3.5" />
                    {selectedTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <Button
                className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                disabled={selectedKeys.length === 0}
                onClick={() => setPaymentModalOpen(true)}
              >
                Clear Credit
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <PaymentConfirmModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        loading={clearMutation.isPending}
        totalAmount={selectedTotal}
        onConfirm={(method, ref) => clearMutation.mutate({ method, ref })}
      />
    </>
  );
}
