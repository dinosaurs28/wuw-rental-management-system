import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Plus, Pencil, Coins, Trash2 } from "lucide-react";

import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";

import type { DepositRule } from "@/services/deposit.service";
import { fetchDepositRules, createDepositRule, updateDepositRule, deleteDepositRule } from "@/services/deposit.service";
import type { Category } from "@/services/vehicle.service";
import { fetchVehicleCategories } from "@/services/vehicle.service";

const depositRuleSchema = z.object({
    categoryId: z.coerce.number().min(1, "Category is required"),
    amount: z.coerce.number().min(0, "Amount must be positive"),
});

type DepositRuleFormValues = z.infer<typeof depositRuleSchema>;

export const ManagerDepositRulesPage = () => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);
    const [rules, setRules] = useState<DepositRule[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<DepositRule | null>(null);

    const form = useForm<DepositRuleFormValues>({
        resolver: zodResolver(depositRuleSchema),
        defaultValues: {
            categoryId: 0,
            amount: 0,
        },
    });

    const loadData = async () => {
        setIsLoading(true);
        try {
            const rulesData = await fetchDepositRules();
            setRules(rulesData);
        } catch (error) {
            console.error("Failed to load data", error);
            toast.error("Failed to load deposit rules");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleOpenDialog = async (rule?: DepositRule) => {
        try {
            const categoriesData = await fetchVehicleCategories();
            setCategories(categoriesData);

            if (rule) {
                setEditingRule(rule);
                form.reset({
                    categoryId: rule.categoryId,
                    amount: Number(rule.amount),
                });
            } else {
                setEditingRule(null);
                form.reset({
                    categoryId: categoriesData.length > 0 ? categoriesData[0].id : 0,
                    amount: 0,
                });
            }
            setIsDialogOpen(true);
        } catch (error) {
            console.error("Failed to load categories", error);
            toast.error("Failed to load categories");
        }
    };

    const onSubmit = async (data: DepositRuleFormValues) => {
        try {
            if (editingRule) {
                await updateDepositRule(editingRule.id, { amount: data.amount });
                toast.success("Deposit rule updated successfully");
            } else {
                await createDepositRule({ categoryId: data.categoryId, amount: data.amount });
                toast.success("Deposit rule created successfully");
            }
            setIsDialogOpen(false);
            loadData();
        } catch (error: any) {
            console.error("Submit Error:", error);
            if (error.response?.data?.message) {
                toast.error(error.response.data.message);
            } else {
                toast.error("Failed to save deposit rule");
            }
        }
    };

    if (isLoading) {
        return (
            <ManagerLayout>
                <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                </div>
            </ManagerLayout>
        );
    }

    return (
        <ManagerLayout>
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <Breadcrumb className="mb-4">
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbLink href="/manager/vehicles">Vehicles</BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>Deposit Rules</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="icon" onClick={() => navigate("/manager/vehicles")}>
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
                                Deposit Rules
                            </h1>
                        </div>
                        <p className="text-muted-foreground mt-2">
                            Manage security deposit amounts per vehicle category.
                        </p>
                    </div>
                    <Button onClick={() => handleOpenDialog()} className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
                        <Plus className="w-4 h-4" />
                        Add Rule
                    </Button>
                </div>

                <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Category</TableHead>
                                <TableHead>Deposit Amount (₹)</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rules.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                                        No deposit rules found. Add one to get started.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rules.map((rule) => (
                                    <TableRow key={rule.id}>
                                        <TableCell className="font-medium text-neutral-900">
                                            {rule.category?.name || "Unknown Category"}
                                        </TableCell>
                                        <TableCell>
                                            ₹ {Number(rule.amount).toLocaleString('en-IN')}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleOpenDialog(rule)}
                                                className="gap-2"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                                Edit
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 ml-2"
                                                onClick={async () => {
                                                    if (!confirm("Are you sure you want to delete this deposit rule?")) return;
                                                    try {
                                                        await deleteDepositRule(rule.id);
                                                        toast.success("Deposit rule deleted");
                                                        loadData();
                                                    } catch (e: any) {
                                                        toast.error(e.response?.data?.message || "Failed to delete");
                                                    }
                                                }}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                Delete
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editingRule ? "Edit Deposit Rule" : "Add Deposit Rule"}</DialogTitle>
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                <FormField
                                    control={form.control}
                                    name="categoryId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Category</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value.toString()} // Convert number to string for Select
                                                disabled={!!editingRule} // Disable category change in edit mode
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select category" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {categories.map((category) => (
                                                        <SelectItem key={category.id} value={category.id.toString()}>
                                                            {category.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Deposit Amount (₹)</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <Coins className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                                    <Input type="number" className="pl-9" {...field} />
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div className="flex justify-end gap-3 pt-4">
                                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                        Cancel
                                    </Button>
                                    <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white">
                                        {editingRule ? "Update Rule" : "Create Rule"}
                                    </Button>
                                </div>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>
            </div>
        </ManagerLayout>
    );
};
