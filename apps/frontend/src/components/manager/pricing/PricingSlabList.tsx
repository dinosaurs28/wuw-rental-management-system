import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus,
    MoreHorizontal,
    Pencil,
    Trash2,
    Percent
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { pricingService, type PricingDiscountSlab } from '@/services/pricing.service';
import { PricingSlabDialog } from './PricingSlabDialog';

export function PricingSlabList() {
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingSlab, setEditingSlab] = useState<PricingDiscountSlab | null>(null);

    const { data: response, isLoading, error } = useQuery({
        queryKey: ['pricing-discounts'],
        queryFn: pricingService.getDiscounts,
    });

    const slabs = response?.data?.data || [];

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: pricingService.deleteDiscount,
        onSuccess: () => {
            toast.success("Discount deleted");
            queryClient.invalidateQueries({ queryKey: ['pricing-discounts'] });
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.message || "Failed to delete");
        }
    });

    const handleEdit = (slab: PricingDiscountSlab) => {
        setEditingSlab(slab);
        setIsDialogOpen(true);
    };

    const handleDelete = (id: number) => {
        if (confirm("Are you sure you want to delete this discount?")) {
            deleteMutation.mutate(id);
        }
    };

    const handleAddNew = () => {
        setEditingSlab(null);
        setIsDialogOpen(true);
    };

    if (isLoading) {
        return <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
        </div>;
    }

    if (error) {
        return <div className="p-4 text-center text-red-500">Failed to load discounts.</div>;
    }

    return (
        <Card className="border-none shadow-none">
            <CardHeader className="px-0 pt-0">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl font-bold">Long Term Discounts</CardTitle>
                        <CardDescription>
                            Configure pricing multipliers for extended bookings.
                        </CardDescription>
                    </div>
                    <Button onClick={handleAddNew} className="bg-orange-600 hover:bg-orange-700">
                        <Plus className="mr-2 size-4" />
                        Add Discount
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="px-0">
                <div className="rounded-md border border-zinc-200 overflow-hidden">
                    <Table>
                        <TableHeader className="bg-zinc-50">
                            <TableRow>
                                <TableHead className="font-semibold text-zinc-900">Vehicle Category</TableHead>
                                <TableHead className="font-semibold text-zinc-900">Minimum Days</TableHead>
                                <TableHead className="font-semibold text-zinc-900">Discount Factor</TableHead>
                                <TableHead className="font-semibold text-zinc-900">Effective Discount</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {slabs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-zinc-500">
                                        No discount rules configured.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                slabs.map((slab) => {
                                    const percentage = Math.round(Number(slab.multiplier) * 100);

                                    return (
                                        <TableRow key={slab.id} className="hover:bg-zinc-50/50">
                                            <TableCell className="font-medium">
                                                <Badge variant="outline" className="font-medium">
                                                    {slab.category?.name || "Unknown"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {slab.days} days +
                                            </TableCell>
                                            <TableCell>
                                                <span className="font-mono text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded">
                                                    {Number(slab.multiplier).toFixed(2)}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
                                                    <Percent className="size-4" />
                                                    {percentage}% OFF
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" className="h-8 w-8 p-0">
                                                            <span className="sr-only">Open menu</span>
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
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>

            <PricingSlabDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                editingSlab={editingSlab}
            />
        </Card>
    );
}
