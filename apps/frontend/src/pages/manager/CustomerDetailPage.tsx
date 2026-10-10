import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CalendarClock, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookingDrawer } from "@/components/manager/customers/BookingDrawer";
import { apiMessage, inr, isPositive, istDate, istDateTime } from "@/components/manager/customers/format";
import {
  MANAGER_CUSTOMERS_PORTAL,
  customersTabKey,
  type CustomersPortal,
} from "@/components/manager/customers/portal";
import {
  type CustomersService,
  type RentBucket,
  type RentRow,
} from "@/services/managerCustomers.service";

const BUCKETS: { key: RentBucket; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "active", label: "Active" },
  { key: "past", label: "Past" },
];

const EMPTY_TEXT: Record<RentBucket, string> = {
  upcoming: "No upcoming rents.",
  active: "No vehicle is currently out with this customer.",
  past: "No past rents.",
};

function statusStyle(r: RentRow) {
  if (r.isOverdue) return "bg-red-100 text-red-700";
  if (r.status === "PICKED_UP") return "bg-green-100 text-green-700";
  if (r.status === "CANCELLED") return "bg-zinc-100 text-zinc-500";
  if (r.status === "RETURNED") return "bg-zinc-100 text-zinc-700";
  if (r.awaitingPayment) return "bg-yellow-100 text-yellow-700";
  return "bg-blue-100 text-blue-700";
}

function statusLabel(r: RentRow) {
  if (r.isOverdue) return "Overdue";
  if (r.awaitingPayment) return "Awaiting payment";
  return r.status.replace(/_/g, " ");
}

function RentCard({ r, onOpen }: { r: RentRow; onOpen: (id: string) => void }) {
  return (
    <div className="rounded-xl border bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-medium text-zinc-900">
            {r.vehicles.map((v) => `${v.make} ${v.model}`).join(", ") || "Vehicle"}
          </p>
          <p className="text-xs text-zinc-500 font-mono">
            {r.vehicles.map((v) => v.regNo).join(", ")} · #{r.publicId.slice(-8).toUpperCase()}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyle(r)}`}>
            {statusLabel(r)}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
            {r.source === "COUNTER" ? "Walk-in" : "Online"}
          </span>
          {r.type === "MONTHLY" && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] text-purple-700">
              Monthly
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        {istDateTime(r.startAt)} → {istDateTime(r.endAt)}
        {r.returnedAt && <span>· returned {istDateTime(r.returnedAt)}</span>}
      </div>
      <p className="text-xs text-zinc-500">
        Branch: {r.branch.name}
        {r.isOwnBranch ? " (yours)" : ""}
        {r.extensionCount > 0 ? ` · ${r.extensionCount} extension${r.extensionCount > 1 ? "s" : ""}` : ""}
      </p>
      <div className="flex items-end justify-between gap-3 flex-wrap pt-1">
        <div className="text-xs text-zinc-500 space-y-0.5">
          <p>Paid {inr(r.amounts.paid)}</p>
          {isPositive(r.amounts.pendingConfirmation) && (
            <p>Awaiting confirmation {inr(r.amounts.pendingConfirmation)}</p>
          )}
          {isPositive(r.amounts.creditPending) && (
            <p className="text-orange-600 font-medium">Credit pending {inr(r.amounts.creditPending)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpen(r.publicId)}
          className="text-right rounded-lg px-3 py-1.5 border border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors"
          title="View amount breakdown and payments"
        >
          <span className="block text-[10px] uppercase tracking-wide text-orange-600">Rent amount</span>
          <span className="block text-base font-bold text-orange-700 tabular-nums">
            {inr(r.amounts.totalFinal)}
          </span>
        </button>
      </div>
    </div>
  );
}

function RentList({
  service,
  customerId,
  bucket,
  initial,
  total,
  hasMore,
  onOpen,
}: {
  service: CustomersService;
  customerId: string;
  bucket: RentBucket;
  initial: RentRow[];
  total: number;
  hasMore: boolean;
  onOpen: (id: string) => void;
}) {
  const [extra, setExtra] = useState<RentRow[]>([]);
  const [page, setPage] = useState(1);
  const [moreLeft, setMoreLeft] = useState(hasMore);
  const [loading, setLoading] = useState(false);

  // The first page can refresh (react-query) — keep appended pages after it, de-duplicated.
  const seen = new Set(initial.map((r) => r.publicId));
  const rows = [...initial, ...extra.filter((r) => !seen.has(r.publicId))];

  const loadMore = async () => {
    setLoading(true);
    try {
      const next = await service.rents(customerId, bucket, page + 1);
      setExtra((e) => [...e, ...next.data]);
      setPage(next.page);
      setMoreLeft(next.page < next.totalPages);
    } catch (err) {
      toast.error(apiMessage(err, "Could not load more rents."));
    } finally {
      setLoading(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-zinc-500 rounded-xl border border-dashed">
        {EMPTY_TEXT[bucket]}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <RentCard key={r.publicId} r={r} onOpen={onOpen} />
      ))}
      {(moreLeft || (rows.length < total && hasMore)) && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Load more ({rows.length} of {total})
          </Button>
        </div>
      )}
    </div>
  );
}

// Shared by the branch manager and Fleet; the portal sets the API prefix and chrome.
export const CustomerDetailPage = ({ portal = MANAGER_CUSTOMERS_PORTAL }: { portal?: CustomersPortal }) => {
  const { Layout, service } = portal;
  const { customerId } = useParams<{ customerId: string }>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RentBucket>("upcoming");
  const [openBooking, setOpenBooking] = useState<string | null>(null);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const query = useQuery({
    queryKey: customersTabKey(portal, "detail", customerId),
    queryFn: () => service.get(customerId!),
    enabled: !!customerId,
  });

  const refresh = () => {
    // The tab's list, this customer and their bookings, plus the portal's other customer caches.
    queryClient.invalidateQueries({ queryKey: customersTabKey(portal) });
    const userPublicId = query.data?.customer.userPublicId;
    if (userPublicId) {
      for (const key of portal.relatedKeys?.(userPublicId) ?? []) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }
  };

  const blacklistMutation = useMutation({
    mutationFn: () => service.blacklist(customerId!, reason.trim()),
    onSuccess: (res) => {
      const open = res.data.openRents;
      toast.success(res.message || "Customer blacklisted.");
      if (open && (open.upcoming > 0 || open.active > 0)) {
        toast.info(
          `Existing rents are not cancelled: ${open.upcoming} upcoming, ${open.active} active.`,
          { duration: 8000 },
        );
      }
      setBlacklistOpen(false);
      setReason("");
      refresh();
    },
    onError: (err) => {
      toast.error(apiMessage(err, "Could not blacklist this customer."));
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === "CUSTOMER_ALREADY_BLACKLISTED") {
        setBlacklistOpen(false);
        refresh();
      }
    },
  });

  const unblacklistMutation = useMutation({
    mutationFn: () => service.unblacklist(customerId!, note.trim() || undefined),
    onSuccess: (res) => {
      toast.success(res.message || "Blacklist removed.");
      setRemoveOpen(false);
      setNote("");
      refresh();
    },
    onError: (err) => {
      toast.error(apiMessage(err, "Could not remove the blacklist."));
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === "CUSTOMER_NOT_BLACKLISTED") {
        setRemoveOpen(false);
        refresh();
      }
    },
  });

  const data = query.data;
  const c = data?.customer;
  const bl = data?.blacklist;
  const reasonLen = reason.trim().length;
  const reasonValid = reasonLen >= 3 && reasonLen <= 500;

  const addressLine = c
    ? [c.address.line1, c.address.city, c.address.state, c.address.zipCode, c.address.country]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={portal.dashboardPath}>Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={portal.customersPath}>Customers</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{c?.name ?? "Loading..."}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {query.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : query.isError || !data || !c || !bl ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {apiMessage(query.error, "Could not load this customer.")}
          </div>
        ) : (
          <>
            {bl.isBlacklisted && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex gap-3">
                <Ban className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-sm text-red-800 space-y-0.5 min-w-0">
                  <p className="font-semibold">Blacklisted — can't make new bookings</p>
                  {bl.reason && <p>Reason: {bl.reason}</p>}
                  <p className="text-xs text-red-600">
                    {bl.blacklistedAt ? `Since ${istDateTime(bl.blacklistedAt)}` : ""}
                    {bl.blacklistedBy
                      ? ` · by ${bl.blacklistedBy.name}${bl.blacklistedBy.branch ? ` (${bl.blacklistedBy.branch.name})` : ""}`
                      : ""}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold truncate">{c.name}</h1>
                  <p className="text-sm text-zinc-500">
                    Registered {istDate(c.registeredAt)}
                    {!c.isProfileCompleted && " · Profile incomplete"}
                  </p>
                </div>
                {bl.isBlacklisted ? (
                  <Button variant="outline" onClick={() => setRemoveOpen(true)} className="gap-2">
                    <ShieldCheck className="h-4 w-4" /> Remove blacklist
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setBlacklistOpen(true)}
                    className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  >
                    <Ban className="h-4 w-4" /> Blacklist
                  </Button>
                )}
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-zinc-400">Phone</dt>
                  <dd>{c.phone}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Alternate phone</dt>
                  <dd>{c.alternatePhone || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Email</dt>
                  <dd className="break-all">{c.email || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Address</dt>
                  <dd>{addressLine || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Driving licence</dt>
                  <dd className="font-mono">{c.drivingLicenceNumberMasked || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Aadhaar</dt>
                  <dd className="font-mono">{c.aadhaarNumberMasked || "—"}</dd>
                </div>
              </dl>
            </div>

            <div
              className={`rounded-xl border p-4 space-y-2 ${
                isPositive(data.credit.pendingTotal)
                  ? "border-orange-200 bg-orange-50"
                  : "bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs text-zinc-500">Pending credit (all branches)</p>
                  <p className="text-lg font-bold tabular-nums">{inr(data.credit.pendingTotal)}</p>
                </div>
                {isPositive(data.credit.pendingAtBranch) && (
                  <div className="text-right">
                    <p className="text-xs text-zinc-500">At your branch</p>
                    <p className="text-base font-semibold tabular-nums">{inr(data.credit.pendingAtBranch)}</p>
                    {portal.ledgerPath && (
                      <Link
                        to={portal.ledgerPath(c.customerPublicId)}
                        className="text-xs text-orange-600 hover:underline"
                      >
                        Open credit ledger
                      </Link>
                    )}
                  </div>
                )}
              </div>
              {data.credit.entries.map((e) => (
                <div key={e.creditPublicId} className="rounded-lg bg-white border p-2.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <span>
                      {e.branch.name}
                      {e.isOwnBranch ? " (yours)" : ""} · #{e.bookingPublicId.slice(-8).toUpperCase()}
                    </span>
                    <span className="font-semibold tabular-nums">{inr(e.pendingAmount)}</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {e.status.replace(/_/g, " ")} · total {inr(e.totalAmount)} · cleared {inr(e.clearedAmount)}
                  </p>
                  {e.pendingSections
                    .filter((s) => typeof s.collateral === "string" && s.collateral)
                    .map((s) => (
                      <p key={s.sectionKey} className="text-xs text-zinc-500">
                        Collateral held: {s.collateral}
                      </p>
                    ))}
                </div>
              ))}
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as RentBucket)}>
              <TabsList className="w-full sm:w-auto">
                {BUCKETS.map((b) => (
                  <TabsTrigger key={b.key} value={b.key} className="flex-1 sm:flex-none">
                    {b.label} ({data.counts[b.key]})
                  </TabsTrigger>
                ))}
              </TabsList>
              {BUCKETS.map((b) => (
                <TabsContent key={b.key} value={b.key} className="mt-4">
                  <RentList
                    service={service}
                    customerId={customerId!}
                    bucket={b.key}
                    initial={data.rents[b.key]}
                    total={data.counts[b.key]}
                    hasMore={data.hasMore[b.key]}
                    onOpen={setOpenBooking}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </div>

      <BookingDrawer
        service={service}
        queryKey={customersTabKey(portal, "booking")}
        customerId={customerId ?? ""}
        bookingId={openBooking}
        onClose={() => setOpenBooking(null)}
      />

      <Dialog open={blacklistOpen} onOpenChange={(o) => !blacklistMutation.isPending && setBlacklistOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Blacklist {c?.name}</DialogTitle>
            <DialogDescription>
              They won't be able to make new bookings at any branch. Existing bookings are not
              cancelled. A reason is required and is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (3–500 characters)"
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-zinc-400 text-right">{reasonLen}/500</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBlacklistOpen(false)} disabled={blacklistMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={!reasonValid || blacklistMutation.isPending}
              onClick={() => blacklistMutation.mutate()}
            >
              {blacklistMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Blacklist customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={(o) => !unblacklistMutation.isPending && setRemoveOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the blacklist?</DialogTitle>
            <DialogDescription>
              {c?.name} will be able to book again. This is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            rows={3}
            maxLength={500}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveOpen(false)} disabled={unblacklistMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              disabled={unblacklistMutation.isPending}
              onClick={() => unblacklistMutation.mutate()}
            >
              {unblacklistMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Remove blacklist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};
