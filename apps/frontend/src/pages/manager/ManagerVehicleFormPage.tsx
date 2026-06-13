import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  CalendarIcon,
  Truck,
  Car,
  Gauge,
  Shield,
  ImageIcon,
  Receipt,
  Clock,
  Timer,
  Sun,
  CalendarDays,
  MapPin,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  createVehicle,
  updateVehicle,
  fetchManagerVehicleDetails,
  fetchVehicleCategories,
  type Category,
} from "@/services/vehicle.service";
import { VehicleImageUpload } from "@/components/manager/vehicles/VehicleImageUpload";

const vehicleSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.coerce
    .number()
    .min(1900)
    .max(new Date().getFullYear() + 1),
  licensePlate: z.string().min(1, "License Plate (Reg No) is required"),
  odo: z.coerce.number().min(0, "Odometer reading is required"),
  category: z.string().min(1, "Category is required"),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"]),
  hourlyRate: z.coerce.number().min(0, "Hourly rate must be non-negative").optional(),
  price12Hour: z.coerce.number().min(0, "12-hour price must be non-negative").optional(),
  freeKm12Hour: z.coerce.number().min(0, "Free KM for 12 hours must be non-negative").optional(),
  price24Hour: z.coerce.number().min(0, "24-hour price must be non-negative"),
  freeKm24Hour: z.coerce.number().min(0, "Free KM for 24 hours must be non-negative").optional(),
  priceMonthly: z.coerce.number().min(0, "Monthly price must be non-negative").optional(),
  freeKmMonthly: z.coerce.number().min(0, "Free KM for month must be non-negative").optional(),
  extraKmRate: z.coerce.number().min(0, "Extra KM rate must be non-negative"),
  extraHourRate: z.coerce.number().min(0, "Extra Hour rate must be non-negative"),
  isCustomPricingEnabled: z.boolean(),
  advancePayAmount: z.coerce.number().min(0, "Advance amount must be non-negative").optional(),
  insuranceExpiry: z.date({
    required_error: "Insurance Expiry is required",
  }),
  policyNumber: z.string().min(1, "Policy Number is required"),
  provider: z.string().min(1, "Insurance Provider is required"),
  images: z
    .array(z.custom<string | File>())
    .min(1, "At least one image is required"),
  hasFastag: z.boolean().default(false),
  fastagNumber: z.string().optional(),
});

type VehicleFormValues = z.infer<typeof vehicleSchema>;

export const ManagerVehicleFormPage = () => {
  const { vehicleId } = useParams();
  const navigate = useNavigate();
  const isEditMode = !!vehicleId;
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditMode);
  const [categories, setCategories] = useState<Category[]>([]);
  const [originalImages, setOriginalImages] = useState<any[]>([]);

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleSchema) as any,
    defaultValues: {
      make: "",
      model: "",
      year: new Date().getFullYear(),
      licensePlate: "",
      odo: 0,
      category: "",
      status: "AVAILABLE",
      hourlyRate: 0,
      price12Hour: 0,
      freeKm12Hour: 100,
      price24Hour: 0,
      freeKm24Hour: 150,
      priceMonthly: 0,
      freeKmMonthly: 1500,
      extraKmRate: 8,
      extraHourRate: 100,
      isCustomPricingEnabled: true,
      advancePayAmount: 0,
      policyNumber: "",
      provider: "",
      images: [],
      hasFastag: false,
      fastagNumber: "",
    },
  });

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const data = await fetchVehicleCategories();
        setCategories(data);
      } catch (error) {
        console.error("Failed to load categories", error);
        toast.error("Failed to load vehicle categories");
      }
    };
    loadCategories();
  }, []);

  useEffect(() => {
    if (isEditMode && vehicleId) {
      const loadVehicle = async () => {
        try {
          const response = await fetchManagerVehicleDetails(vehicleId);
          const vehicle = response.data;

          setOriginalImages(vehicle.images || []);

          const latestInsurance = vehicle.insuranceRecords?.[0];

          form.reset({
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year || new Date().getFullYear(),
            licensePlate: vehicle.regNo,
            odo: vehicle.odo || 0,
            category: String(vehicle.categoryId || ""),
            status: vehicle.status as "AVAILABLE" | "MAINTENANCE" | "INACTIVE",
            hourlyRate: vehicle.customPricing?.hourlyRate ? Number(vehicle.customPricing.hourlyRate) : 0,
            price12Hour: vehicle.customPricing?.price12Hour ? Number(vehicle.customPricing.price12Hour) : 0,
            freeKm12Hour: vehicle.customPricing?.freeKm12Hour ?? 100,
            price24Hour: vehicle.customPricing?.price24Hour ? Number(vehicle.customPricing.price24Hour) : 0,
            freeKm24Hour: vehicle.customPricing?.freeKm24Hour ?? 150,
            priceMonthly: vehicle.customPricing?.priceMonthly ? Number(vehicle.customPricing.priceMonthly) : 0,
            freeKmMonthly: vehicle.customPricing?.freeKmMonthly ?? 1500,
            extraKmRate: vehicle.customPricing?.extraKmRate ? Number(vehicle.customPricing.extraKmRate) : 8,
            extraHourRate: vehicle.customPricing?.extraHourRate ? Number(vehicle.customPricing.extraHourRate) : 100,
            isCustomPricingEnabled: vehicle.customPricing?.enabled ?? true,
            advancePayAmount: vehicle.advancePayAmount ? Number(vehicle.advancePayAmount) : 0,
            insuranceExpiry: vehicle.insuranceExpiry
              ? new Date(vehicle.insuranceExpiry)
              : undefined,
            policyNumber:
              vehicle.policyNumber || latestInsurance?.policyNumber || "",
            provider: vehicle.provider || latestInsurance?.provider || "",
            images:
              (vehicle.images || [])
                .filter((img: any) => !img.isThumbnail)
                .map((img: any) => img.file.url),
            hasFastag: vehicle.hasFastag ?? false,
            fastagNumber: vehicle.fastagNumber ?? "",
          });
        } catch (error) {
          toast.error("Failed to load vehicle details");
          navigate("/manager/vehicles");
        } finally {
          setIsFetching(false);
        }
      };
      loadVehicle();
    }
  }, [isEditMode, vehicleId, form, navigate]);

  const onSubmit = async (data: any) => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("make", data.make);
      formData.append("model", data.model);
      formData.append("year", data.year.toString());
      formData.append("regNo", data.licensePlate);
      formData.append("odo", data.odo.toString());
      formData.append("categoryId", data.category);
      formData.append("insuranceExpiry", data.insuranceExpiry.toISOString());
      formData.append("policyNumber", data.policyNumber);
      formData.append("provider", data.provider);
      formData.append("status", data.status);
      formData.append("hasFastag", data.hasFastag.toString());
      if (data.hasFastag && data.fastagNumber) {
        formData.append("fastagNumber", data.fastagNumber);
      }

      formData.append("hourlyRate", data.hourlyRate?.toString() || "0");
      formData.append("price12Hour", data.price12Hour?.toString() || "0");
      formData.append("freeKm12Hour", data.freeKm12Hour?.toString() || "100");
      formData.append("price24Hour", data.price24Hour.toString());
      formData.append("freeKm24Hour", data.freeKm24Hour?.toString() || "150");
      formData.append("priceMonthly", data.priceMonthly?.toString() || "0");
      formData.append("freeKmMonthly", data.freeKmMonthly?.toString() || "1500");
      formData.append("extraKmRate", data.extraKmRate.toString());
      formData.append("extraHourRate", data.extraHourRate.toString());
      formData.append("isCustomPricingEnabled", data.isCustomPricingEnabled.toString());
      if (data.advancePayAmount !== undefined) {
        formData.append("advancePayAmount", data.advancePayAmount.toString());
      }

      data.images.forEach((img: any) => {
        if (img instanceof File) {
          formData.append("images", img);
        }
      });

      if (isEditMode) {
        const currentImageUrls = data.images.filter(
          (img: any) => typeof img === "string",
        ) as string[];

        const deletedImageIds = originalImages
          .filter((img) => !img.isThumbnail)
          .filter((img) => !currentImageUrls.includes(img.file.url))
          .map((img) => img.publicId);

        if (deletedImageIds.length > 0) {
          formData.append("deleteImageIds", JSON.stringify(deletedImageIds));
        }
      }

      if (isEditMode && vehicleId) {
        await updateVehicle(vehicleId, formData);
        toast.success("Vehicle updated successfully");
      } else {
        await createVehicle(formData);
        toast.success("Vehicle created successfully");
      }
      navigate("/manager/vehicles");
    } catch (error) {
      console.error(error);
      toast.error(
        isEditMode ? "Failed to update vehicle" : "Failed to create vehicle",
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
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
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-28">

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
                <BreadcrumbPage>{isEditMode ? "Edit Vehicle" : "Add Vehicle"}</BreadcrumbPage>
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
                {isEditMode ? "Edit Vehicle" : "Add New Vehicle"}
              </h1>
              <p className="text-sm text-neutral-500 mt-0.5">
                {isEditMode
                  ? "Update vehicle details, pricing, and insurance information."
                  : "Fill in the details to add a new vehicle to your fleet."}
              </p>
            </div>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

              {/* Left Column — Vehicle Details + Pricing */}
              <div className="xl:col-span-2 space-y-6">

                {/* Section: Vehicle Details */}
                <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100 bg-neutral-50/60">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <Car className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-neutral-900 text-[15px]">Vehicle Details</h2>
                      <p className="text-xs text-neutral-500">Basic information about the vehicle</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <FormField
                        control={form.control}
                        name="make"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">Make</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Toyota" className="h-11" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="model"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">Model</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Camry" className="h-11" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="year"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">Year</FormLabel>
                            <FormControl>
                              <Input type="number" className="h-11" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="licensePlate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">License Plate</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. KA01AB1234" className="h-11 font-mono" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="odo"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">
                              <span className="flex items-center gap-1.5">
                                <Gauge className="w-3.5 h-3.5" />
                                Odometer (km)
                              </span>
                            </FormLabel>
                            <FormControl>
                              <Input type="number" className="h-11" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="category"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">Category</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-11">
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
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-neutral-700">Status</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-11">
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="AVAILABLE">
                                  <span className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                    Available
                                  </span>
                                </SelectItem>
                                <SelectItem value="MAINTENANCE">
                                  <span className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                                    Maintenance
                                  </span>
                                </SelectItem>
                                <SelectItem value="INACTIVE">
                                  <span className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-red-500" />
                                    Inactive
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Separator />

                    {/* FASTag */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <Truck className="w-4 h-4 text-neutral-500" />
                        <h3 className="font-medium text-neutral-800 text-sm">FASTag</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-end">
                        <FormField
                          control={form.control}
                          name="hasFastag"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-lg border border-neutral-200 p-4 bg-neutral-50/50">
                              <FormControl>
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                              <div className="space-y-0.5 leading-none">
                                <FormLabel className="cursor-pointer text-sm">Has FASTag?</FormLabel>
                                <p className="text-xs text-neutral-500">
                                  Vehicle has a FASTag sticker fitted.
                                </p>
                              </div>
                            </FormItem>
                          )}
                        />
                        {form.watch("hasFastag") && (
                          <FormField
                            control={form.control}
                            name="fastagNumber"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-neutral-700">FASTag Number</FormLabel>
                                <FormControl>
                                  <Input placeholder="e.g. 1234567890" className="h-11 font-mono" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Pricing */}
                <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100 bg-neutral-50/60">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Receipt className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-neutral-900 text-[15px]">Pricing</h2>
                      <p className="text-xs text-neutral-500">Set rental rates per time period</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-6">

                    {/* Pricing tiers grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                      {/* Hourly */}
                      <div className="rounded-lg border border-neutral-200 p-4 bg-neutral-50/40">
                        <div className="flex items-center gap-2 mb-3">
                          <Clock className="w-4 h-4 text-neutral-500" />
                          <span className="text-sm font-medium text-neutral-700">Hourly</span>
                        </div>
                        <FormField
                          control={form.control}
                          name="hourlyRate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-neutral-500">Rate (₹/hr)</FormLabel>
                              <FormControl>
                                <Input type="number" min="0" className="h-10" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* 12-Hour */}
                      <div className="rounded-lg border border-neutral-200 p-4 bg-neutral-50/40">
                        <div className="flex items-center gap-2 mb-3">
                          <Timer className="w-4 h-4 text-neutral-500" />
                          <span className="text-sm font-medium text-neutral-700">12-Hour</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField
                            control={form.control}
                            name="price12Hour"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-neutral-500">Price (₹)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" className="h-10" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="freeKm12Hour"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-neutral-500">Free KM</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" className="h-10" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>

                      {/* Daily */}
                      <div className="rounded-lg border border-orange-200 p-4 bg-orange-50/30">
                        <div className="flex items-center gap-2 mb-3">
                          <Sun className="w-4 h-4 text-orange-500" />
                          <span className="text-sm font-medium text-neutral-700">Daily (24hr)</span>
                          <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium ml-auto">Primary</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField
                            control={form.control}
                            name="price24Hour"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-neutral-500">Price (₹)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" className="h-10" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="freeKm24Hour"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-neutral-500">Free KM</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" className="h-10" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>

                      {/* Monthly */}
                      <div className="rounded-lg border border-neutral-200 p-4 bg-neutral-50/40">
                        <div className="flex items-center gap-2 mb-3">
                          <CalendarDays className="w-4 h-4 text-neutral-500" />
                          <span className="text-sm font-medium text-neutral-700">Monthly</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField
                            control={form.control}
                            name="priceMonthly"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-neutral-500">Price (₹)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" className="h-10" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="freeKmMonthly"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-neutral-500">Free KM</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" className="h-10" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Duration discount callout */}
                    <button
                      type="button"
                      onClick={() => navigate("/manager/payment/discounts?tab=config", { state: { scrollTo: "duration-discount-slabs" } })}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50/60 border border-blue-100 hover:bg-blue-100/60 transition-colors group text-left"
                    >
                      <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        <Receipt className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-blue-800">Duration Discount Slabs</p>
                        <p className="text-xs text-blue-600/80 mt-0.5">Automatic discounts for multi-day rentals — configure in Discount Settings</p>
                      </div>
                      <ArrowLeft className="w-3.5 h-3.5 text-blue-400 rotate-180 group-hover:translate-x-0.5 transition-transform shrink-0" />
                    </button>

                    <Separator />

                    {/* Extra charges */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <Zap className="w-4 h-4 text-neutral-500" />
                        <h3 className="text-sm font-medium text-neutral-700">Extra Charges</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <FormField
                          control={form.control}
                          name="extraKmRate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-neutral-700">
                                <span className="flex items-center gap-1.5">
                                  <MapPin className="w-3.5 h-3.5" />
                                  Extra KM Rate (₹/km)
                                </span>
                              </FormLabel>
                              <FormControl>
                                <Input type="number" min="0" className="h-11" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="extraHourRate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-neutral-700">
                                <span className="flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5" />
                                  Extra Hour Rate (₹/hr)
                                </span>
                              </FormLabel>
                              <FormControl>
                                <Input type="number" min="0" className="h-11" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <Separator />

                    {/* Advance Payment */}
                    <div>
                      <h3 className="text-sm font-medium text-neutral-700 mb-4">Advance Payment</h3>
                      <div className="max-w-xs">
                        <FormField
                          control={form.control}
                          name="advancePayAmount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-neutral-700">Advance Amount (₹)</FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="0 (disabled)" className="h-11" {...field} />
                              </FormControl>
                              <p className="text-xs text-neutral-400 mt-1.5">
                                Set 0 to disable advance payment requirement.
                              </p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column — Insurance + Images */}
              <div className="xl:col-span-1 space-y-6">

                {/* Section: Insurance */}
                <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100 bg-neutral-50/60">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-neutral-900 text-[15px]">Insurance</h2>
                      <p className="text-xs text-neutral-500">Policy and expiry details</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-5">
                    <FormField
                      control={form.control}
                      name="insuranceExpiry"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel className="text-neutral-700">Expiry Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal h-11",
                                    !field.value && "text-muted-foreground",
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => date < new Date("2000-01-01")}
                                captionLayout="dropdown"
                                startMonth={new Date(new Date().getFullYear() - 1, 0)}
                                endMonth={new Date(new Date().getFullYear() + 15, 11)}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="policyNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-neutral-700">Policy Number</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. POL-2024-001" className="h-11 font-mono" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="provider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-neutral-700">Insurance Provider</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. HDFC Ergo" className="h-11" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Section: Images */}
                <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                  <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100 bg-neutral-50/60">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-neutral-900 text-[15px]">Vehicle Images</h2>
                      <p className="text-xs text-neutral-500">Upload at least one photo</p>
                    </div>
                  </div>
                  <div className="p-6">
                    <FormField
                      control={form.control}
                      name="images"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <VehicleImageUpload
                              existingImages={field.value}
                              onImagesChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Sticky Footer Actions */}
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-neutral-200 px-4 py-3 flex items-center justify-end gap-3">
              <div className="max-w-[1440px] w-full mx-auto flex items-center justify-end gap-3">
                <span className="text-sm text-neutral-400 mr-auto hidden sm:block">
                  {isEditMode ? "Editing vehicle" : "Adding new vehicle"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 min-w-[100px]"
                  onClick={() => navigate("/manager/vehicles")}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-orange-500 hover:bg-orange-600 text-white h-10 min-w-[140px] gap-2"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    isEditMode ? "Save Changes" : "Add Vehicle"
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </div>
    </ManagerLayout>
  );
};
