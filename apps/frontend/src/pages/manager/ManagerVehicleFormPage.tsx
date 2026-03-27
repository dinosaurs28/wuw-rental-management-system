import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft, CalendarIcon } from "lucide-react";
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
    .max(new Date().getFullYear() + 1), // Kept for UI, might not be saved by backend
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
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      make: "",
      model: "",
      year: new Date().getFullYear(),
      licensePlate: "", // regNo
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

          // Store original images to track deletions
          // Only track non-thumbnails for deletion logic usually, but
          // if user sees thumbnails and deletes them, we want to delete the underlying image?
          // The UI now filters OUT thumbnails. So user only sees original uploads.
          // So we should track original images that are NOT thumbnails.
          // OR, better: invalidating ANY image ID that isn't in current list.
          // But duplicates issue: The LIST only shows raw uploads.
          // So let's store all images, filter for non-thumbnails logic is OK.
          setOriginalImages(vehicle.images || []);

          // Safe mapping
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
              vehicle.images
                ?.filter((img) => !img.isThumbnail)
                .map((img) => img.file.url) || [],
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

  const onSubmit = async (data: VehicleFormValues) => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("make", data.make);
      formData.append("model", data.model);
      formData.append("regNo", data.licensePlate);
      formData.append("odo", data.odo.toString());
      formData.append("categoryId", data.category);
      formData.append("insuranceExpiry", data.insuranceExpiry.toISOString());
      formData.append("policyNumber", data.policyNumber);
      formData.append("provider", data.provider);
      formData.append("status", data.status);

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

      // Handle Images
      data.images.forEach((img) => {
        if (img instanceof File) {
          formData.append("images", img);
        }
      });

      // Handle Image Deletion
      if (isEditMode) {
        // Get current URLs (strings only)
        const currentImageUrls = data.images.filter(
          (img) => typeof img === "string",
        ) as string[];

        // Find images that were in original but NOT in current
        // We compare against originalImages which contains FULL objects.
        // We filtered OUT thumbnails in the FORM, so 'currentImageUrls' only contains non-thumbnails.
        // But 'originalImages' contains EVERYTHING (including thumbnails).
        // If we delete an original image, its thumbnail should also go (backend handles cascade or we send both IDs).
        // But typically we delete by ID.
        // Let's look at what the user SEES. They see non-thumbnail images.
        // If they remove one, its URL is gone from `currentImageUrls`.
        // So we find the original image object (non-thumbnail) corresponding to the missing URL.

        const deletedImageIds = originalImages
          .filter((img) => !img.isThumbnail) // Only consider the ones displayed/editable
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
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
        <div className="mb-8">
          <Breadcrumb className="mb-4">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/dashboard">
                  Dashboard
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/vehicles">
                  Vehicles
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {isEditMode ? "Edit Vehicle" : "Add Vehicle"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/manager/vehicles")}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
              {isEditMode ? "Edit Vehicle" : "Add New Vehicle"}
            </h1>
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              {/* Section 1: Vehicle Details */}
              <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
                <h2 className="text-xl font-semibold text-neutral-900">
                  Vehicle Details
                </h2>
                <Separator />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="make"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Make</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Toyota"
                            className="h-12"
                            {...field}
                          />
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
                        <FormLabel>Model</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Camry"
                            className="h-12"
                            {...field}
                          />
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
                        <FormLabel>Year</FormLabel>
                        <FormControl>
                          <Input type="number" className="h-12" {...field} />
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
                        <FormLabel>License Plate (Reg No)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. KA01AB1234"
                            className="h-12"
                            {...field}
                          />
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
                        <FormLabel>Odometer Reading (km)</FormLabel>
                        <FormControl>
                          <Input type="number" className="h-12" {...field} />
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
                        <FormLabel>Category</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="h-12">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem
                                key={category.id}
                                value={category.id.toString()}
                              >
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
                        <FormLabel>Status</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="h-12">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="AVAILABLE">Available</SelectItem>
                            <SelectItem value="MAINTENANCE">
                              Maintenance
                            </SelectItem>
                            <SelectItem value="INACTIVE">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Section 2: Pricing & Insurance */}
              <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
                <h2 className="text-xl font-semibold text-neutral-900">
                  Pricing & Insurance
                </h2>
                <Separator />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <FormField
                    control={form.control}
                    name="price24Hour"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Daily Price (₹)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
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
                        <FormLabel>Free KM / Day</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hourlyRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hourly Rate (₹)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="price12Hour"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>12-Hour Price (₹)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
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
                        <FormLabel>Free KM / 12-Hour</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priceMonthly"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Monthly Price (₹)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
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
                        <FormLabel>Free KM / Month</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="extraKmRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Extra KM Rate (₹/km)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
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
                        <FormLabel>Extra Hour Rate (₹/hr)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Separator />
                <h3 className="font-medium text-neutral-800">Advance Payment</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="advancePayAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Advance Amount (₹)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="0 (disabled)"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Fixed advance amount customers pay upfront. Set 0 to disable advance payment.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Separator />
                <h3 className="font-medium text-neutral-800">Insurance Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="insuranceExpiry"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Insurance Expiry</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                  "w-full pl-3 text-left font-normal h-12",
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
                        <FormLabel>Policy Number</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Policy #"
                            className="h-12"
                            {...field}
                          />
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
                        <FormLabel>Insurance Provider</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Provider Name"
                            className="h-12"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Section 3: Images */}
              <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
                <h2 className="text-xl font-semibold text-neutral-900">
                  Vehicle Images
                </h2>
                <Separator />
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

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-4 fixed bottom-0 left-0 right-0 p-4 bg-white border-t z-50 md:static md:bg-transparent md:border-none md:p-0 md:block">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 flex-1 md:flex-none"
                  onClick={() => navigate("/manager/vehicles")}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-orange-500 hover:bg-orange-600 text-white min-w-[150px] h-12 flex-1 md:flex-none"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Vehicle"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </ManagerLayout>
  );
};
