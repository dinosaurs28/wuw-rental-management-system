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
import { Skeleton } from "@/components/ui/skeleton";
import { ChargeSectionList } from "./ChargeSectionList";
import { CreditBookingCard } from "./CreditBookingCard";
import { ledgerService, type ChargeSection } from "@/services/ledger.service";

interface Props {
  open: boolean;
  onClose: () => void;
  customerPublicId: string;
  onSuccess: () => void;
}

export function AddCreditDrawer({ open, onClose, customerPublicId, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [extraSections, setExtraSections] = useState<ChargeSection[]>([]);

  const bookingsQuery = useQuery({
    queryKey: ["ledger", "eligible-bookings", customerPublicId],
    queryFn: () => ledgerService.getEligibleBookings(customerPublicId),
    enabled: open,
  });

  const chargesQuery = useQuery({
    queryKey: ["ledger", "booking-charges", selectedBookingId],
    queryFn: () => ledgerService.getBookingCharges(selectedBookingId!),
    enabled: !!selectedBookingId && step === 2,
  });

  const allSections: ChargeSection[] = useMemo(() => {
    const fromApi = chargesQuery.data?.sections ?? [];
    return [...fromApi, ...extraSections];
  }, [chargesQuery.data, extraSections]);

  const addMutation = useMutation({
    mutationFn: () => {
      const sections = allSections
        .filter((s) => selectedKeys.includes(s.sectionKey) && !s.isCredited)
        .map((s) => ({ sectionKey: s.sectionKey, label: s.label, amount: s.amount }));
      return ledgerService.addCredit(selectedBookingId!, sections);
    },
    onSuccess: () => {
      toast.success("Credit added successfully");
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      onSuccess();
      handleClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? "Failed to add credit";
      toast.error(msg);
    },
  });

  function handleClose() {
    setStep(1);
    setSelectedBookingId(null);
    setSelectedKeys([]);
    setExtraSections([]);
    onClose();
  }

  function handleBookingSelect(bookingId: string) {
    setSelectedBookingId(bookingId);
    setSelectedKeys([]);
    setExtraSections([]);
    setStep(2);
  }

  function handleToggleSection(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function handleAddCustomSection(section: { sectionKey: string; label: string; amount: number }) {
    const newSection: ChargeSection = {
      ...section,
      isCredited: false,
      isCleared: false,
      isCustom: true,
    };
    setExtraSections((prev) => [...prev, newSection]);
    setSelectedKeys((prev) => [...prev, section.sectionKey]);
  }

  const selectedTotal = useMemo(() => {
    return allSections
      .filter((s) => selectedKeys.includes(s.sectionKey) && !s.isCredited)
      .reduce((sum, s) => sum + s.amount, 0);
  }, [allSections, selectedKeys]);

  function formatAmount(val: number | string) {
    return `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                type="button"
                onClick={() => { setStep(1); setSelectedBookingId(null); }}
                className="text-zinc-500 hover:text-zinc-800 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <SheetTitle>{step === 1 ? "Select Booking" : "Add Credit"}</SheetTitle>
          </div>
          {step === 2 && (
            <div className="flex gap-2 mt-1">
              <div className="h-1 flex-1 rounded-full bg-orange-500" />
              <div className="h-1 flex-1 rounded-full bg-orange-500" />
            </div>
          )}
          {step === 1 && (
            <div className="flex gap-2 mt-1">
              <div className="h-1 flex-1 rounded-full bg-orange-500" />
              <div className="h-1 flex-1 rounded-full bg-zinc-200" />
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Step 1: Booking list */}
          {step === 1 && (
            <div className="space-y-3">
              {bookingsQuery.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))
              ) : bookingsQuery.data?.length === 0 ? (
                <div className="text-center py-10 text-zinc-500 text-sm">
                  No eligible bookings found for this customer.
                </div>
              ) : (
                bookingsQuery.data?.map((booking) => (
                  <CreditBookingCard
                    key={booking.publicId}
                    booking={booking}
                    onClick={() => handleBookingSelect(booking.publicId)}
                    isSelected={selectedBookingId === booking.publicId}
                  />
                ))
              )}
            </div>
          )}

          {/* Step 2: Charge sections */}
          {step === 2 && (
            <div className="space-y-4">
              {chargesQuery.isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              ) : chargesQuery.data ? (
                <>
                  {/* Booking summary */}
                  <div className="rounded-xl bg-zinc-50 border px-4 py-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-zinc-500 text-xs">Base</p>
                      <p className="font-medium">{formatAmount(chargesQuery.data.bookingSummary.totalBase)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Discount</p>
                      <p className="font-medium text-green-600">
                        -{formatAmount(chargesQuery.data.bookingSummary.totalDiscount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Tax</p>
                      <p className="font-medium">{formatAmount(chargesQuery.data.bookingSummary.totalTax)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Total</p>
                      <p className="font-semibold text-orange-600">
                        {formatAmount(chargesQuery.data.bookingSummary.totalFinal)}
                      </p>
                    </div>
                  </div>

                  <ChargeSectionList
                    sections={allSections}
                    selectedKeys={selectedKeys}
                    onToggle={handleToggleSection}
                    onAddCustomSection={handleAddCustomSection}
                  />
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer — only show on step 2 */}
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
              disabled={selectedKeys.length === 0 || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Credit
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
