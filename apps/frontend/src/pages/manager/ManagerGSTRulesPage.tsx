import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Save } from "lucide-react";

import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { fetchGSTRule, createOrUpdateGSTRule } from "@/services/gst.service";

const gstRuleSchema = z.object({
    gstNumber: z.string().min(1, "GST Number is required"),
    cgstRate: z.coerce.number().min(0, "CGST Rate must be positive"),
    sgstRate: z.coerce.number().min(0, "SGST Rate must be positive"),
    igstRate: z.coerce.number().min(0, "IGST Rate must be positive").optional(),
});

type GSTRuleFormValues = z.infer<typeof gstRuleSchema>;

export const ManagerGSTRulesPage = () => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const form = useForm<GSTRuleFormValues>({
        resolver: zodResolver(gstRuleSchema),
        defaultValues: {
            gstNumber: "",
            cgstRate: 9,
            sgstRate: 9,
            igstRate: 0,
        },
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const rule = await fetchGSTRule();
            if (rule) {
                form.reset({
                    gstNumber: rule.gstNumber,
                    cgstRate: Number(rule.cgstRate),
                    sgstRate: Number(rule.sgstRate),
                    igstRate: Number(rule.igstRate),
                });
            }
        } catch (error) {
            console.error("Failed to load GST rule", error);
            toast.error("Failed to load GST settings");
        } finally {
            setIsLoading(false);
        }
    };

    const onSubmit = async (data: GSTRuleFormValues) => {
        setIsSaving(true);
        try {
            await createOrUpdateGSTRule({
                ...data,
                igstRate: data.igstRate ?? 0,
            });
            toast.success("GST settings saved successfully");
            loadData();
        } catch (error: any) {
            console.error("Submit Error:", error);
            if (error.response?.data?.message) {
                toast.error(error.response.data.message);
            } else {
                toast.error("Failed to save GST settings");
            }
        } finally {
            setIsSaving(false);
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
                                    <BreadcrumbPage>GST Settings</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="icon" onClick={() => navigate("/manager/vehicles")}>
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
                                GST Settings
                            </h1>
                        </div>
                        <p className="text-muted-foreground mt-2">
                            Configure Goods and Services Tax (GST) rates for your branch.
                        </p>
                    </div>
                </div>

                <div className="max-w-2xl">
                    <div className="bg-white p-6 rounded-lg border shadow-sm">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                <FormField
                                    control={form.control}
                                    name="gstNumber"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>GST Number</FormLabel>
                                            <FormControl>
                                                <Input placeholder="e.g. 29ABCDE1234F1Z5" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="cgstRate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>CGST Rate (%)</FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" {...field} />
                                                </FormControl>
                                                <FormDescription>Central Goods and Services Tax</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="sgstRate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>SGST Rate (%)</FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" {...field} />
                                                </FormControl>
                                                <FormDescription>State Goods and Services Tax</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="igstRate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>IGST Rate (%)</FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" {...field} />
                                            </FormControl>
                                            <FormDescription>Integrated Goods and Services Tax (Optional)</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="flex justify-end pt-4">
                                    <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white min-w-[150px]" disabled={isSaving}>
                                        {isSaving ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <Save className="w-4 h-4 mr-2" />
                                                Save Settings
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </form>
                        </Form>
                    </div>
                </div>
            </div>
        </ManagerLayout>
    );
};
