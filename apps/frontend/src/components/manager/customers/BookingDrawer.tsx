import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PhotoLightbox } from "@/components/ui/PhotoLightbox";
import { managerCustomersService } from "@/services/managerCustomers.service";
import { apiMessage, inr, isPositive, istDateTime } from "./format";

function Row({
  label,
  value,
  bold,
  muted,
  negative,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 text-sm py-0.5 ${
        bold ? "font-semibold text-zinc-900" : muted ? "text-zinc-500" : "text-zinc-700"
      }`}
    >
      <span>{label}</span>
      <span className={`tabular-nums text-right ${negative ? "text-green-600" : ""}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
      <div className="rounded-xl border bg-white p-3">{children}</div>
    </section>
  );
}

const methodLabel = (m: string) =>
  m === "CASH" ? "Cash" : m === "ONLINE" ? "Online" : m === "SPLIT" ? "Split" : m;

export function BookingDrawer({
  customerId,
  bookingId,
  onClose,
}: {
  customerId: string;
  bookingId: string | null;
  onClose: () => void;
}) {
  const [proof, setProof] = useState<{ url: string; mime: string; label: string } | null>(null);

  const query = useQuery({
    queryKey: ["manager-customer-booking", customerId, bookingId],
    queryFn: () => managerCustomersService.booking(customerId, bookingId!),
    enabled: !!bookingId,
    staleTime: 0,
  });

  const d = query.data;
  const b = d?.breakdown;

  return (
    <>
      <Sheet open={!!bookingId} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Booking {bookingId ? `#${bookingId.slice(-8).toUpperCase()}` : ""}</SheetTitle>
            <SheetDescription>Amount breakdown and payments</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-50">
            {query.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-48 rounded-xl" />
                <Skeleton className="h-32 rounded-xl" />
              </div>
            ) : query.isError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {apiMessage(query.error, "Could not load this booking.")}
              </div>
            ) : d && b ? (
              <>
                <Section title="Booking">
                  <Row label="Status" value={d.booking.status.replace(/_/g, " ")} />
                  <Row label="Branch" value={d.booking.branch.name} />
                  <Row
                    label="Source"
                    value={
                      d.booking.source === "COUNTER"
                        ? `Walk-in${d.booking.createdBy ? ` (${d.booking.createdBy.name})` : ""}`
                        : "Online"
                    }
                  />
                  <Row label="Type" value={d.booking.type === "MONTHLY" ? "Monthly" : "Daily"} />
                  <Row
                    label="Vehicle"
                    value={d.booking.vehicles.map((v) => `${v.make} ${v.model} (${v.regNo})`).join(", ") || "—"}
                  />
                  <Row label="Pickup" value={istDateTime(d.booking.startAt)} />
                  <Row label="Return due" value={istDateTime(d.booking.endAt)} />
                  {d.booking.originalEndAt && (
                    <Row label="Original return" value={istDateTime(d.booking.originalEndAt)} muted />
                  )}
                  {d.booking.returnedAt && (
                    <Row label="Returned" value={istDateTime(d.booking.returnedAt)} />
                  )}
                  {d.booking.cancelledAt && (
                    <Row
                      label="Cancelled"
                      value={`${istDateTime(d.booking.cancelledAt)}${
                        d.booking.cancellationReason ? ` — ${d.booking.cancellationReason}` : ""
                      }`}
                    />
                  )}
                  {d.booking.couponCode && <Row label="Coupon" value={d.booking.couponCode} />}
                </Section>

                <Section title="Original rental">
                  <Row label="Rent without GST" value={inr(b.rental.rentWithoutGst)} />
                  {isPositive(b.rental.discount) && (
                    <Row label="Discount" value={`− ${inr(b.rental.discount)}`} negative />
                  )}
                  <Row label="Taxable amount" value={inr(b.rental.taxableAmount)} muted />
                  {b.rental.cgst != null && b.rental.sgst != null ? (
                    <>
                      <Row label={`CGST${b.rental.gstRate ? ` (${Number(b.rental.gstRate) / 2}%)` : ""}`} value={inr(b.rental.cgst)} />
                      <Row label={`SGST${b.rental.gstRate ? ` (${Number(b.rental.gstRate) / 2}%)` : ""}`} value={inr(b.rental.sgst)} />
                    </>
                  ) : (
                    <Row label={`GST${b.rental.gstRate ? ` (${Number(b.rental.gstRate)}%)` : ""}`} value={inr(b.rental.gst)} />
                  )}
                  <Row label="Rent incl. GST" value={inr(b.rental.rentInclGst)} bold />
                  <Row label="Refundable deposit" value={inr(b.rental.refundableDeposit)} />
                  <Row label="Original total" value={inr(b.rental.total)} bold />
                </Section>

                {b.extensions.items.length > 0 && (
                  <Section title="Extensions">
                    {b.extensions.items.map((e) => (
                      <div key={e.publicId} className="py-1.5 border-b last:border-b-0">
                        <Row
                          label={`Until ${istDateTime(e.newEndAt)}`}
                          value={inr(e.amount)}
                          muted={!e.includedInTotal}
                        />
                        <p className="text-xs text-zinc-400">
                          {e.status}
                          {!e.includedInTotal ? " · not counted in total" : ""}
                          {e.taxableAmount != null && e.gst != null
                            ? ` · Rent without GST ${inr(e.taxableAmount)} + GST ${inr(e.gst)}`
                            : ""}
                        </p>
                      </div>
                    ))}
                    <Row label="Confirmed extensions" value={inr(b.extensions.total)} bold />
                  </Section>
                )}

                <Section title="Rent amount">
                  <Row label="Total (incl. deposit and extensions)" value={inr(b.totalFinal)} bold />
                </Section>

                {b.returnCharges.items.length > 0 && (
                  <Section title="Return / drop charges">
                    {b.returnCharges.items.map((c, i) => (
                      <Row
                        key={`${c.type}-${i}`}
                        label={c.label}
                        value={`${c.isDiscount ? "− " : ""}${inr(Math.abs(Number(c.total)))}`}
                        negative={c.isDiscount}
                      />
                    ))}
                    <Row label="Total charges" value={inr(b.returnCharges.total)} bold />
                  </Section>
                )}

                {isPositive(b.safetyDeposit.amount) && (
                  <Section title="Safety deposit">
                    <Row label="Collected" value={inr(b.safetyDeposit.charged)} />
                    <Row label="Credited back" value={inr(b.safetyDeposit.credited)} />
                    <Row label="Held" value={inr(b.safetyDeposit.held)} />
                    {b.safetyDeposit.setOff && (
                      <p className="text-xs text-zinc-400">Set off against charges</p>
                    )}
                  </Section>
                )}

                <Section title="Total owed">
                  <Row label="Total owed" value={inr(b.totalOwed)} bold />
                </Section>

                <Section title="Payments">
                  <Row label="Status" value={d.payments.lifecycleState.replace(/_/g, " ")} />
                  <Row label="Confirmed" value={inr(d.payments.totalCollectedConfirmed)} />
                  {isPositive(d.payments.totalCollectedPending) && (
                    <Row label="Awaiting confirmation" value={inr(d.payments.totalCollectedPending)} />
                  )}
                  {isPositive(d.payments.totalRefunded) && (
                    <Row label="Refunded" value={inr(d.payments.totalRefunded)} />
                  )}
                  <Row label="Amount due" value={inr(d.payments.amountDue)} bold />

                  {d.payments.transactions.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {d.payments.transactions.map((t) => (
                        <div key={t.publicId} className="rounded-lg border p-2.5 text-sm">
                          <div className="flex justify-between gap-2">
                            <span className="font-medium">
                              {t.isRefund ? "Refund" : t.purpose.replace(/_/g, " ")} · {methodLabel(t.method)}
                            </span>
                            <span className="tabular-nums font-semibold">
                              {t.isRefund ? "− " : ""}
                              {inr(t.totalAmount)}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-500">
                            {t.status.replace(/_/g, " ")} · {istDateTime(t.collectedAt ?? t.createdAt)}
                            {t.collectedBy ? ` · by ${t.collectedBy}` : ""}
                          </p>
                          {t.confirmedBy && (
                            <p className="text-xs text-zinc-500">
                              Confirmed by {t.confirmedBy} · {istDateTime(t.confirmedAt)}
                            </p>
                          )}
                          {t.rejectionReason && (
                            <p className="text-xs text-red-600">Rejected: {t.rejectionReason}</p>
                          )}
                          {t.onlineTransactionRef && (
                            <p className="text-xs text-zinc-500 font-mono">Ref {t.onlineTransactionRef}</p>
                          )}
                          {t.notes && <p className="text-xs text-zinc-500">{t.notes}</p>}
                          {t.proofPhoto && (
                            <button
                              type="button"
                              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-orange-600 hover:underline"
                              onClick={() =>
                                setProof({
                                  url: t.proofPhoto!.url,
                                  mime: t.proofPhoto!.mime,
                                  label: `${methodLabel(t.method)} payment proof`,
                                })
                              }
                            >
                              <ImageIcon className="h-3.5 w-3.5" /> View payment proof
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {d.credit && (
                  <Section title="Customer credit">
                    <Row label="Status" value={d.credit.status.replace(/_/g, " ")} />
                    <Row label="Total" value={inr(d.credit.totalAmount)} />
                    <Row label="Cleared" value={inr(d.credit.clearedAmount)} />
                    <Row label="Pending" value={inr(d.credit.pendingAmount)} bold />
                    {d.credit.sections
                      .filter((s) => typeof s.collateral === "string" && s.collateral)
                      .map((s) => (
                        <p key={s.sectionKey} className="text-xs text-zinc-500">
                          Collateral held ({s.label}): {s.collateral}
                        </p>
                      ))}
                    {d.credit.clearances.map((c) => (
                      <p key={c.publicId} className="text-xs text-zinc-500">
                        Cleared {inr(c.amountCleared)} via {methodLabel(c.paymentMethod)} on{" "}
                        {istDateTime(c.clearedAt)}
                        {c.clearedBy ? ` by ${c.clearedBy}` : ""}
                      </p>
                    ))}
                  </Section>
                )}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <PhotoLightbox
        open={!!proof}
        onOpenChange={(o) => !o && setProof(null)}
        items={proof ? [{ url: proof.url, mime: proof.mime, label: proof.label }] : []}
        title="Payment proof"
      />
    </>
  );
}
