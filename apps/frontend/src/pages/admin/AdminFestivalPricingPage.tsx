import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminService } from "@/services/admin.service";
import { FestivalPricingManager } from "@/components/manager/pricing/FestivalPricingManager";

/** Festival pricing for any branch — the branch manager's screen with a branch picked. */
export function AdminFestivalPricingPage() {
  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["admin-festival-branch-options"],
    queryFn: async () => {
      const list = await adminService.getBranches();
      // Numeric ids (the rules' branchId) — rows without one are skipped
      return list
        .map((b) => ({ id: Number((b as { id?: unknown }).id), name: b.name }))
        .filter((b) => Number.isInteger(b.id) && b.id > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 5 * 60_000,
  });
  const [branchId, setBranchId] = useState<number | null>(null);
  useEffect(() => {
    if (branchId == null && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
      <div className="mb-8">
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Festival Pricing</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Festival Pricing</h1>
        <p className="text-neutral-500 mt-2 text-lg">
          Change a branch's rents by a percentage for festival dates — all vehicles, some categories or some vehicles.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Label htmlFor="festival-branch" className="text-sm text-neutral-600">
          Branch
        </Label>
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-neutral-400" />
        ) : branches.length === 0 ? (
          <p className="text-sm text-neutral-500">No branches yet.</p>
        ) : (
          <Select value={branchId != null ? String(branchId) : undefined} onValueChange={(v) => setBranchId(Number(v))}>
            <SelectTrigger id="festival-branch" className="w-64">
              <SelectValue placeholder="Pick a branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {branchId != null && <FestivalPricingManager key={branchId} portal={{ kind: "admin", branchId }} />}
    </div>
  );
}
