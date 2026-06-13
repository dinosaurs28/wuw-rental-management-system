import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, CheckCircle2, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AddCreditDrawer } from "@/components/manager/ledger/AddCreditDrawer";
import { ClearCreditDrawer } from "@/components/manager/ledger/ClearCreditDrawer";
import { CreditBookingCard } from "@/components/manager/ledger/CreditBookingCard";
import { ledgerService } from "@/services/ledger.service";

function formatAmount(val: string | number) {
  return `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const CustomerCreditPage = () => {
  const { customerId } = useParams<{ customerId: string }>();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [entriesPage, setEntriesPage] = useState(1);
  const entriesPageSize = 10;

  const summaryQuery = useQuery({
    queryKey: ["ledger", "customer", customerId],
    queryFn: () => ledgerService.getCustomerSummary(customerId!),
    enabled: !!customerId,
  });

  const entriesQuery = useQuery({
    queryKey: ["ledger", "entries", customerId, entriesPage],
    queryFn: () => ledgerService.getCustomerEntries(customerId!, entriesPage, entriesPageSize),
    enabled: !!customerId,
  });

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
  }

  const customer = summaryQuery.data?.customer;
  const stats = summaryQuery.data?.stats;

  return (
    <ManagerLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link to="/manager/dashboard">Dashboard</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link to="/manager/ledger">Credit Ledger</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {summaryQuery.isLoading ? "Loading..." : customer?.name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        {summaryQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : customer ? (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-0.5">
              <h1 className="text-xl font-bold">{customer.name}</h1>
              <p className="text-sm text-zinc-500">{customer.phone}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => setAddOpen(true)}
                className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
              >
                <PlusCircle className="w-4 h-4" />
                Add Credit
              </Button>
              <Button
                variant="outline"
                onClick={() => setClearOpen(true)}
                className="gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Clear Credit
              </Button>
            </div>
          </div>
        ) : null}

        {/* Stats strip */}
        {summaryQuery.isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border px-4 py-3 text-center">
              <p className="text-xs text-zinc-500 mb-1">Total Credit</p>
              <p className="text-lg font-bold">{formatAmount(stats.totalAmount)}</p>
            </div>
            <div className="rounded-xl border px-4 py-3 text-center">
              <p className="text-xs text-zinc-500 mb-1">Cleared</p>
              <p className="text-lg font-bold text-green-600">{formatAmount(stats.clearedAmount)}</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-center">
              <p className="text-xs text-orange-600 mb-1">Pending</p>
              <p className="text-lg font-bold text-orange-700">{formatAmount(stats.pendingAmount)}</p>
            </div>
          </div>
        ) : null}

        {/* Credit entries list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">
              Credit Entries ({entriesQuery.data?.total ?? 0})
            </h2>
            {entriesQuery.data && entriesQuery.data.total > entriesPageSize && (
              <span className="text-xs text-zinc-400">
                {(entriesPage - 1) * entriesPageSize + 1}–{Math.min(entriesPage * entriesPageSize, entriesQuery.data.total)} of {entriesQuery.data.total}
              </span>
            )}
          </div>

          {entriesQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : (entriesQuery.data?.data.length ?? 0) === 0 ? (
            <div className="text-center py-10 text-zinc-500 rounded-xl border border-dashed">
              <BookOpen className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
              <p className="text-sm">No credit entries yet.</p>
              <p className="text-xs mt-0.5">Click "Add Credit" to record deferred payment.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {entriesQuery.data?.data.map((entry) => (
                <div key={entry.publicId} className="space-y-1">
                  <CreditBookingCard
                    booking={entry}
                    creditPublicId={entry.publicId}
                    onClick={() => {/* no-op on listing */}}
                  />
                  {/* Section summary */}
                  <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                    {(entry.sections ?? []).slice(0, 5).map((s) => (
                      <span
                        key={s.sectionKey}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          s.isCleared
                            ? "bg-green-100 text-green-700 line-through"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {s.label} · {formatAmount(s.amount)}
                      </span>
                    ))}
                    {(entry.sections?.length ?? 0) > 5 && (
                      <span className="text-xs text-zinc-400">
                        +{(entry.sections?.length ?? 0) - 5} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {entriesQuery.data && entriesQuery.data.total > entriesPageSize && (
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={entriesPage <= 1}
                onClick={() => setEntriesPage((p) => p - 1)}
                className="gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <span className="text-sm text-zinc-500">
                Page {entriesPage} of {Math.ceil(entriesQuery.data.total / entriesPageSize)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={entriesPage >= Math.ceil(entriesQuery.data.total / entriesPageSize)}
                onClick={() => setEntriesPage((p) => p + 1)}
                className="gap-1"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <AddCreditDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        customerPublicId={customerId!}
        onSuccess={handleSuccess}
      />

      <ClearCreditDrawer
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        customerPublicId={customerId!}
        onSuccess={handleSuccess}
      />
    </ManagerLayout>
  );
};
