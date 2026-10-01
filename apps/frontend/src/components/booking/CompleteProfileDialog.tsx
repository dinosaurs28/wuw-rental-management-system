import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  aadhaarNumberSchema,
  drivingLicenceNumberSchema,
  optionalEmailSchema,
} from "@repo/schemas";
import { customerSession, type CustomerSession } from "@/utils/customerSession";
import {
  employeeCustomerKey,
  employeeCustomerService,
  type CompleteWalkinProfilePayload,
} from "@/services/employeeCustomer.service";
import {
  apiErrorCode,
  describeMissingProfileFields,
  EMAIL_CHANGE_NOT_ALLOWED,
  formatAadhaarInput,
  formatDrivingLicenceInput,
  isVerificationPendingError,
} from "@/lib/customerProfile";
import { useNavigate } from "react-router-dom";

const profileSchema = z.object({
  name: z.string().min(2, "Name is required"),
  // Optional at the counter (#1) — left out of the payload when blank.
  email: optionalEmailSchema,
  drivingLicenceNumber: drivingLicenceNumberSchema,
  aadhaarNumber: aadhaarNumberSchema,
  dob: z.date({
    required_error: "Date of birth is required.",
  }),
  addressLine1: z.string().min(5, "Address is required"),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  zipCode: z.string().min(5, "Zip code is required"),
  country: z.string().min(2, "Country is required"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

interface CompleteProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerSession;
  onSuccess: () => void;
}

export const CompleteProfileDialog = ({
  open,
  onOpenChange,
  customer,
  onSuccess,
}: CompleteProfileDialogProps) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  // Empty required fields reported by the server (e.g. the DL/Aadhaar numbers).
  const [missingFields, setMissingFields] = useState<string[]>([]);
  // The customer already has a real (sign-in) email — read-only at the counter.
  const [hasStoredEmail, setHasStoredEmail] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: customer.name || "",
      email: "",
      drivingLicenceNumber: "",
      aadhaarNumber: "",
      country: "India",
      city: "",
      state: "",
      addressLine1: "",
      zipCode: "",
    },
  });

  useEffect(() => {
    const fetchDetails = async () => {
      if (!open) return;

      setIsFetching(true);
      try {
        const data = await employeeCustomerService.getCustomer(
          customer.publicId,
        );

        if (data) {
          form.reset({
            name: data.name || customer.name || "",
            // null for a walk-in placeholder — never prefill or resend one.
            email: data.email || "",
            drivingLicenceNumber: formatDrivingLicenceInput(
              data.drivingLicenceNumber,
            ),
            aadhaarNumber: formatAadhaarInput(data.aadhaarNumber),
            country: data.country || "India",
            city: data.city || "",
            state: data.state || "",
            addressLine1: data.addressLine1 || "",
            zipCode: data.zipCode || "",
            dob: data.dob ? new Date(data.dob) : undefined,
          });
          setMissingFields(data.missingFields ?? []);
          setHasStoredEmail(!!data.email);
        }
      } catch (error) {
        console.error("Failed to fetch customer details", error);
        // We don't block the UI, just let them fill it manually
      } finally {
        setIsFetching(false);
      }
    };

    fetchDetails();
  }, [open, customer.publicId, customer.name, form]);

  // Never log the form values or the request: they carry the Aadhaar number.
  const onSubmit = async (data: ProfileFormValues) => {
    setIsLoading(true);
    try {
      const email = data.email?.trim();
      const payload: CompleteWalkinProfilePayload = {
        customer_public_id: customer.publicId,
        name: data.name,
        // Blank = keep the stored email (real or placeholder). A real stored
        // email is never resent: the counter can't change it.
        ...(email && !hasStoredEmail ? { email } : {}),
        drivingLicenceNumber: data.drivingLicenceNumber,
        aadhaarNumber: data.aadhaarNumber,
        dob: data.dob ? format(data.dob, "yyyy-MM-dd") : undefined,
        addressLine1: data.addressLine1,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        country: data.country,
      };

      const result =
        await employeeCustomerService.completeWalkinProfile(payload);

      // Update local session with the server-derived completeness
      const newSession: CustomerSession = {
        ...customer,
        name: data.name,
        profileCompleted: result.isProfileCompleted,
      };
      customerSession.set(newSession);
      setMissingFields(result.missingFields ?? []);
      // Refresh the DL / Aadhaar line shown for this customer.
      queryClient.invalidateQueries({
        queryKey: employeeCustomerKey(customer.publicId),
      });

      if (result.isProfileCompleted) {
        toast.success("Profile updated successfully");
      } else {
        toast.warning(result.message);
      }
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      const body = error?.response?.data;
      // VALIDATION_ERROR: per-field messages under errors.fieldErrors
      const fieldErrors: Record<string, string[] | undefined> =
        body?.errors?.fieldErrors ?? {};
      for (const [field, messages] of Object.entries(fieldErrors)) {
        if (messages?.[0] && field in profileSchema.shape) {
          form.setError(field as keyof ProfileFormValues, {
            message: messages[0],
          });
        }
      }
      if (
        body?.code === "EMAIL_ALREADY_EXISTS" ||
        apiErrorCode(error) === EMAIL_CHANGE_NOT_ALLOWED
      ) {
        form.setError("email", { message: body.message });
      }
      if (isVerificationPendingError(error)) {
        // An earlier walk-in whose phone OTP was never verified: entering the
        // number on the new-customer page resumes that same walk-in.
        toast.error(body?.message || "Verify the customer's phone number first.", {
          action: {
            label: "Verify phone",
            onClick: () => {
              onOpenChange(false);
              navigate(
                customer.phone
                  ? `/employee/customer/create?phone=${encodeURIComponent(customer.phone)}`
                  : "/employee/customer/create",
              );
            },
          },
        });
        return;
      }
      toast.error(body?.message || "Failed to update profile");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Customer Profile</DialogTitle>
          <DialogDescription>
            Complete the profile for {customer.phone} to proceed with KYC.
            {missingFields.length > 0 && (
              <span className="mt-1 block text-amber-700">
                Missing: {describeMissingProfileFields(missingFields)}.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isFetching ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="animate-spin size-8 text-zinc-300" />
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, () => {
                toast.error("Please fill in all required fields");
              })}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="john@example.com"
                        {...field}
                        value={field.value ?? ""}
                        // A real email is the customer's login: only they can change it.
                        readOnly={hasStoredEmail}
                        className={cn(hasStoredEmail && "bg-zinc-50 text-zinc-500")}
                      />
                    </FormControl>
                    {hasStoredEmail && (
                      <FormDescription>
                        This is the customer's sign-in email. It can't be
                        changed at the counter.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="drivingLicenceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Driving Licence number *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="KA01 20110012345"
                          autoComplete="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          {...field}
                          onChange={(e) =>
                            field.onChange(
                              formatDrivingLicenceInput(e.target.value),
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="aadhaarNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Aadhaar number *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="1234 5678 9012"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={14}
                          className="tabular-nums"
                          {...field}
                          onChange={(e) =>
                            field.onChange(formatAadhaarInput(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="dob"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Date of Birth</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
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
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                          captionLayout="dropdown"
                          fromYear={1900}
                          toYear={new Date().getFullYear()}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="addressLine1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="City" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input placeholder="State" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="zipCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zip Code</FormLabel>
                      <FormControl>
                        <Input placeholder="123456" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <FormControl>
                        <Input placeholder="Country" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Profile
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};
