import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, MoreHorizontal, Pencil, Trash2, Percent, CalendarDays, Tag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  pricingService,
  type PricingDiscountSlab,
} from "@/services/pricing.service";
import { PricingSlabDialog } from "./PricingSlabDialog";

export function PricingSlabList() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSlab, setEditingSlab] = useState<PricingDiscountSlab | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const {
    data: response,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["pricing-discounts"],
    queryFn: pricingService.getDiscounts,
  });

  const slabs = response?.data?.data || [];

  const deleteMutation = useMutation({
    mutationFn: pricingService.deleteDiscount,
    onSuccess: () => {
      toast.success("Discount deleted");
      queryClient.invalidateQueries({ queryKey: ["pricing-discounts"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Failed to delete");
    },
  });

  const handleEdit = (slab: PricingDiscountSlab) => {
    setEditingSlab(slab);
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    if (deleteId !== null) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const handleAddNew = () => {
    setEditingSlab(null);
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-neutral-200">
        <p className="text-red-500 text-sm font-medium">Failed to load discounts.</p>
        <p className="text-neutral-400 text-xs mt-1">Check your connection and try again.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">Long-Term Discounts</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Pricing multipliers applied automatically for extended bookings.
          </p>
        </div>
        <Button
          onClick={handleAddNew}
          className="bg-orange-500 hover:bg-orange-600 text-white gap-2 h-10 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Discount
        </Button>
      </div>

      {/* Empty state */}
      {slabs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-dashed border-neutral-200">
          <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
            <Percent className="w-7 h-7 text-neutral-300" />
          </div>
          <p className="font-medium text-neutral-700 mb-1">No discount rules yet</p>
          <p className="text-sm text-neutral-400 mb-5">
            Create rules to automatically discount long-term rentals.
          </p>
          <Button
            onClick={handleAddNew}
            className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            Add First Discount
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {slabs.map((slab) => {
            const percentage = Math.round(Number(slab.multiplier) * 100);
            return (
              <div
                key={slab.id}
                className="bg-white rounded-xl border border-neutral-200 overflow-hidden hover:border-neutral-300 hover:shadow-sm transition-all duration-200 group"
              >
                {/* Discount banner */}
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 px-5 py-6 flex items-center justify-between">
                  <div>
                    <p className="text-emerald-100 text-xs font-medium uppercase tracking-wide mb-1">Discount</p>
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-black text-white leading-none">{percentage}</span>
                      <span className="text-xl font-bold text-emerald-200 mb-0.5">%</span>
                    </div>
                    <p className="text-emerald-200 text-xs mt-1">OFF base price</p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                    <Percent className="w-5 h-5 text-white" />
                  </div>
                </div>

                {/* Details */}
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                    <Badge variant="secondary" className="font-medium text-xs">
                      {slab.category?.name || "Unknown Category"}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-neutral-600">
                    <CalendarDays className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                    <span>Bookings of <span className="font-semibold text-neutral-900">{slab.days}+ days</span></span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <span>Multiplier:</span>
                    <span className="font-mono bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded text-xs">
                      {Number(slab.multiplier).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Footer actions */}
                <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-neutral-500 hover:text-neutral-900 -ml-1 gap-1"
                    onClick={() => handleEdit(slab)}
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-7 w-7 p-0 text-neutral-400">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(slab)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        onClick={() => handleDelete(slab.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PricingSlabDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingSlab={editingSlab}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Discount Rule</AlertDialogTitle>
            <AlertDialogDescription>
              This discount rule will be permanently removed. Existing bookings
              won't be affected, but new bookings will no longer receive this discount.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
