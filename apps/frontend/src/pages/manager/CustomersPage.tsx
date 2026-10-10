import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Ban, ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { type CustomerFilter } from "@/services/managerCustomers.service";
import { apiMessage, inr, isPositive, istDate } from "@/components/manager/customers/format";
import {
  MANAGER_CUSTOMERS_PORTAL,
  customersTabKey,
  type CustomersPortal,
} from "@/components/manager/customers/portal";

const FILTERS: { key: CustomerFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "branch", label: "Rented at my branch" },
  { key: "credit", label: "Pending credit" },
  { key: "blacklisted", label: "Blacklisted" },
];

const PAGE_SIZE = 20;

// Shared by the branch manager (/manager/customers) and Fleet (/employee/customers).
export const CustomersPage = ({ portal = MANAGER_CUSTOMERS_PORTAL }: { portal?: CustomersPortal }) => {
  const { Layout, service } = portal;
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput.trim(), 400);
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  const query = useQuery({
    queryKey: customersTabKey(portal, "list", search, filter, page),
    queryFn: () =>
      service.list({
        search: search || undefined,
        filter,
        page,
        limit: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = query.data?.totalPages ?? 1;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold">Customers</h1>
          <p className="text-sm text-zinc-500">
            Every registered customer across all branches.
          </p>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or phone number"
              className="pl-9"
              maxLength={100}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                  filter === f.key
                    ? "bg-orange-50 text-orange-600 border-orange-200"
                    : "text-neutral-600 hover:bg-neutral-100 border-neutral-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {query.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {apiMessage(query.error, "Could not load customers.")}{" "}
            <button className="underline" onClick={() => query.refetch()}>
              Retry
            </button>
          </div>
        ) : query.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-14 text-zinc-500 rounded-xl border border-dashed">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No customers found.</p>
          </div>
        ) : (
          <div className={cn("space-y-3", query.isPlaceholderData && "opacity-60")}>
            {rows.map((c) => (
              <Link
                key={c.customerPublicId}
                to={`${portal.customersPath}/${c.customerPublicId}`}
                className="block rounded-xl border bg-white p-4 hover:shadow-md hover:border-orange-200 transition"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-zinc-900 truncate">{c.name}</h3>
                      {c.isBlacklisted && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          <Ban className="h-3 w-3" /> Blacklisted
                        </span>
                      )}
                      {!c.isProfileCompleted && (
                        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">
                          Profile incomplete
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-500">
                      {c.phone}
                      {c.email ? ` · ${c.email}` : ""}
                    </p>
                    {c.isBlacklisted && c.blacklistReason && (
                      <p className="text-xs text-red-600 mt-0.5">Reason: {c.blacklistReason}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-zinc-500 shrink-0">
                    <p>Registered {istDate(c.registeredAt)}</p>
                    {c.lastRentAt && <p>Last rent {istDate(c.lastRentAt)}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md bg-blue-50 text-blue-700 px-2 py-1">
                    Upcoming {c.rents.upcoming}
                  </span>
                  <span className="rounded-md bg-green-50 text-green-700 px-2 py-1">
                    Active {c.rents.active}
                  </span>
                  <span className="rounded-md bg-zinc-100 text-zinc-600 px-2 py-1">
                    Past {c.rents.past}
                  </span>
                  {isPositive(c.pendingCredit) && (
                    <span className="rounded-md bg-orange-50 text-orange-700 px-2 py-1 font-medium">
                      Credit pending {inr(c.pendingCredit)}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-zinc-500">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
