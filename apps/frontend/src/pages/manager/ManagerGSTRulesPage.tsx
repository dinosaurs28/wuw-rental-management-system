import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Save, Receipt, Info, Building2, Globe } from "lucide-react";

import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
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

  const cgstRate = Number(form.watch("cgstRate")) || 0;
  const sgstRate = Number(form.watch("sgstRate")) || 0;
  const igstRate = Number(form.watch("igstRate")) || 0;
  const totalIntrastate = cgstRate + sgstRate;

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

        {/* Header */}
        <div className="mb-8">
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

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate("/manager/vehicles")}
              className="h-9 w-9 flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
                GST Settings
              </h1>
              <p className="text-sm text-neutral-500 mt-0.5">
                Configure Goods and Services Tax rates for your branch.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Left — Live Rate Preview + Info */}
          <div className="space-y-4">

            {/* Live Rate Cards */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50/60">
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Live Preview</p>
              </div>
              <div className="p-5 space-y-3">

                {/* Intrastate */}
                <div className="rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-4 h-4 text-neutral-500" />
                    <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Intrastate</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-blue-600 font-medium mb-0.5">CGST</p>
                      <p className="text-xl font-bold text-blue-700">{cgstRate}%</p>
                    </div>
                    <div className="bg-violet-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-violet-600 font-medium mb-0.5">SGST</p>
                      <p className="text-xl font-bold text-violet-700">{sgstRate}%</p>
                    </div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs text-emerald-700 font-medium">Total</span>
                    <span className="text-lg font-bold text-emerald-700">{totalIntrastate}%</span>
                  </div>
                </div>

                {/* Interstate */}
                <div className="rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe className="w-4 h-4 text-neutral-500" />
                    <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Interstate</span>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <p className="text-[11px] text-orange-600 font-medium mb-0.5">IGST</p>
                    <p className="text-xl font-bold text-orange-700">{igstRate}%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Info card */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <div className="flex gap-2.5">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-blue-800">About GST Rates</p>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    <strong>CGST + SGST</strong> apply to intrastate transactions (same state).
                  </p>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    <strong>IGST</strong> applies to interstate transactions (different state). Typically CGST + SGST combined.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right — Form */}
          <div className="xl:col-span-2">
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100 bg-neutral-50/60">
                <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Receipt className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-neutral-900 text-[15px]">GST Configuration</h2>
                  <p className="text-xs text-neutral-500">Set your GSTIN and applicable tax rates</p>
                </div>
              </div>

              <div className="p-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                    {/* GST Number */}
                    <div>
                      <h3 className="text-sm font-medium text-neutral-700 mb-4">GST Registration</h3>
                      <FormField
                        control={form.control}
                        name="gstNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">GSTIN</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="e.g. 29ABCDE1234F1Z5"
                                className="h-11 font-mono tracking-wider uppercase"
                                {...field}
                              />
                            </FormControl>
                            <p className="text-xs text-neutral-400 mt-1.5">
                              15-character alphanumeric GST Identification Number
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="border-t border-neutral-100 pt-6">
                      <h3 className="text-sm font-medium text-neutral-700 mb-4">Tax Rates</h3>

                      {/* CGST + SGST */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
                        <FormField
                          control={form.control}
                          name="cgstRate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-neutral-700">CGST Rate</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="h-11 pr-8"
                                    {...field}
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm font-medium pointer-events-none">%</span>
                                </div>
                              </FormControl>
                              <p className="text-xs text-neutral-400">Central Goods and Services Tax</p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="sgstRate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-neutral-700">SGST Rate</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="h-11 pr-8"
                                    {...field}
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm font-medium pointer-events-none">%</span>
                                </div>
                              </FormControl>
                              <p className="text-xs text-neutral-400">State Goods and Services Tax</p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Combined intrastate preview inline */}
                      <div className="flex items-center gap-2 mb-5 px-4 py-2.5 bg-neutral-50 rounded-lg border border-neutral-200 text-sm">
                        <span className="text-neutral-500">Intrastate total:</span>
                        <span className="font-semibold text-neutral-800">{cgstRate}% + {sgstRate}% =</span>
                        <span className="font-bold text-emerald-600">{totalIntrastate}%</span>
                      </div>

                      {/* IGST */}
                      <FormField
                        control={form.control}
                        name="igstRate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">
                              IGST Rate
                              <span className="ml-2 text-xs font-normal text-neutral-400">(Optional)</span>
                            </FormLabel>
                            <FormControl>
                              <div className="relative max-w-xs">
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="h-11 pr-8"
                                  {...field}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm font-medium pointer-events-none">%</span>
                              </div>
                            </FormControl>
                            <p className="text-xs text-neutral-400 mt-1.5">
                              Integrated GST for interstate transactions. Leave 0 if not applicable.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end pt-2 border-t border-neutral-100">
                      <Button
                        type="submit"
                        className="bg-orange-500 hover:bg-orange-600 text-white h-10 min-w-[140px] gap-2"
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
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
        </div>
      </div>
    </ManagerLayout>
  );
};
