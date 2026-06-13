import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, BookOpen, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Input } from "@/components/ui/input";
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
import { useDebounce } from "@/hooks/useDebounce";
import { ledgerService } from "@/services/ledger.service";

function formatAmount(val: string | number) {
  return `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const LedgerPage = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 400);

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", "customers", debouncedSearch, page],
    queryFn: () => ledgerService.searchCustomers(debouncedSearch, page, 20),
  });

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  return (
    <ManagerLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Credit Ledger</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-orange-500" />
              <h1 className="text-xl font-bold">Credit Ledger</h1>
            </div>
            <p className="text-sm text-zinc-500">
              Track customers with deferred payment obligations.
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input
            placeholder="Search by customer name or phone..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : (data?.data.length ?? 0) === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-zinc-300" />
            <p className="font-medium">No pending credits found</p>
            <p className="text-sm">
              {search
                ? "Try a different search term."
                : "All customers are up to date."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {data?.data.map((row) => (
              <button
                key={row.customerPublicId}
                type="button"
                onClick={() => navigate(`/manager/ledger/${row.customerPublicId}`)}
                className="w-full text-left rounded-xl border border-zinc-200 px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 transition-colors"
              >
                <div className="flex-1 space-y-0.5">
                  <p className="font-medium text-sm">{row.name}</p>
                  <p className="text-xs text-zinc-500">{row.phone}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-zinc-500 mb-0.5">Pending</p>
                  <p className="text-sm font-semibold text-orange-600">
                    {formatAmount(row.totalPending)}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-zinc-500">
              {data.total <= data.limit
                ? `${data.total} result${data.total !== 1 ? "s" : ""}`
                : `${(page - 1) * data.limit + 1}–${Math.min(page * data.limit, data.total)} of ${data.total}`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-zinc-500">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </ManagerLayout>
  );
};
