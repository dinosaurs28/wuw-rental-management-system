import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, Ban, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";
// Reusing auth service for OTP

// Actually we need to use `InitiateWalkin` (OTP) and `CompleteWalkinProfile`.
// I need those services. I'll add them to booking service or a new one.
// Wait, `InitiateWalkin` is in `initiate.controller.ts`.
// I'll check if `bookingService` has them? No.
// I'll add them to `bookingService` or `employee.service` (which doesn't exist yet, so `bookingService` is the dumping ground for employee stuff per current pattern).

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { customerSession, type CustomerSession } from "@/utils/customerSession";
import apiClient from "@/lib/axios";
import {
  aadhaarNumberSchema,
  drivingLicenceNumberSchema,
  optionalEmailSchema,
} from "@repo/schemas";
import {
  employeeCustomerService,
  type CompleteWalkinProfilePayload,
} from "@/services/employeeCustomer.service";
import {
  apiErrorCode,
  formatAadhaarInput,
  formatDrivingLicenceInput,
  isVerificationPendingError,
} from "@/lib/customerProfile";
import { apiErrorMessage } from "@/lib/counterErrors";

// --- STEPS ---
type Step = "PHONE_OTP" | "PROFILE_DETAILS";

// --- SCHEMAS ---
const phoneSchema = z.object({
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  otp: z.string().optional(),
});

const profileSchema = z.object({
  name: z.string().min(2, "Name is required"),
  // Optional for walk-ins (#1) — left out of the payload when blank.
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

export default function EmployeeCreateCustomerPage() {
  const navigate = useNavigate();
  // ?phone= — sent here to verify an earlier walk-in's phone (VERIFICATION_PENDING).
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useEmployeeAuthStore();

  const [step, setStep] = useState<Step>("PHONE_OTP");
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [customerPublicId, setCustomerPublicId] = useState<string | null>(null);
  const [receivedOtp, setReceivedOtp] = useState<string | null>(null);
  // Set when the phone already belongs to a customer (CUSTOMER_ALREADY_EXISTS).
  const [existingCustomerId, setExistingCustomerId] = useState<string | null>(
    null,
  );
  // That existing customer is blacklisted (#13): new bookings are blocked.
  const [existingBlacklist, setExistingBlacklist] = useState<{
    customerId: string;
    reason: string | null;
  } | null>(null);
  const blacklistedExisting =
    existingBlacklist && existingBlacklist.customerId === existingCustomerId
      ? existingBlacklist
      : null;

  // Forms
  const phoneForm = useForm<z.infer<typeof phoneSchema>>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: searchParams.get("phone") ?? "", otp: "" },
  });

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      // Every text input starts controlled ("" not undefined) — React warns otherwise
      name: "",
      email: "",
      drivingLicenceNumber: "",
      aadhaarNumber: "",
      addressLine1: "",
      city: "",
      state: "",
      zipCode: "",
      country: "India", // Default
    },
  });

  // --- HANDLERS ---

  const handleSendOtp = async (data: z.infer<typeof phoneSchema>) => {
    setIsLoading(true);
    setExistingCustomerId(null);
    setExistingBlacklist(null);
    try {
      // Call Backend: Initiate Walkin (req.body: { phone })
      const response = await employeeCustomerService.initiateWalkin(data.phone);

      setCustomerPublicId(response.customer_public_id);
      setReceivedOtp(String(response.otp));
      setOtpSent(true);
      if (response.resumed) {
        // An earlier walk-in for this number never finished OTP — same customer.
        toast.info("Resuming the earlier walk-in for this number");
      }
      toast.success(
        `OTP sent explicitly to customer phone: ${response.otp}`,
      );
    } catch (error: any) {
      console.error(error);
      const existingId = error?.response?.data?.customer_public_id;
      if (
        apiErrorCode(error) === "CUSTOMER_ALREADY_EXISTS" &&
        typeof existingId === "string"
      ) {
        setExistingCustomerId(existingId);
        // Look the customer up now so a blacklist shows next to the prompt.
        employeeCustomerService
          .getCustomer(existingId)
          .then((existing) => {
            if (existing.isBlacklisted) {
              setExistingBlacklist({
                customerId: existingId,
                reason: existing.blacklistReason ?? null,
              });
            }
          })
          .catch(() => {
            // Checked again on "Continue with existing customer".
          });
      }
      toast.error(error.response?.data?.message || "Failed to send OTP");
    } finally {
      setIsLoading(false);
    }
  };

  // The phone already belongs to a customer: continue with that account
  // instead of creating a new one (complete its profile on the vehicle page).
  const handleUseExistingCustomer = async () => {
    if (!existingCustomerId) return;
    setIsLoading(true);
    try {
      const existing =
        await employeeCustomerService.getCustomer(existingCustomerId);
      if (existing.isBlacklisted) {
        // Same rule as the customer search: no new booking for this customer.
        setExistingBlacklist({
          customerId: existingCustomerId,
          reason: existing.blacklistReason ?? null,
        });
        toast.error(
          `This customer is blacklisted and can't make new bookings${
            existing.blacklistReason ? ` (reason: ${existing.blacklistReason})` : ""
          }.`,
        );
        return;
      }
      const session: CustomerSession = {
        publicId: existingCustomerId,
        name: existing.name,
        phone: existing.phone || phoneForm.getValues("phone"),
        profileCompleted: existing.isProfileCompleted ?? false,
        kycStatus: false,
      };
      customerSession.set(session);
      useEmployeeBookingStore.getState().clearCounterPayment();
      toast.success(`Selected customer: ${existing.name}`);
      navigate("/employee/vehicles");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to load the customer"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otp = phoneForm.getValues("otp");

    if (!otp || otp.length !== 6) {
      phoneForm.setError("otp", { message: "Enter a valid 6-digit OTP" });
      return;
    }

    setIsLoading(true);
    try {
      // Call Backend: Verify Walkin OTP
      await apiClient.post("/employee/walkin/verify", {
        otp,
        customer_public_id: customerPublicId,
      });

      toast.success("Phone verified successfully");
      setStep("PROFILE_DETAILS");
    } catch (error: any) {
      console.error(error);
      toast.error(error.response?.data?.message || "Invalid OTP");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProfile = async (data: z.infer<typeof profileSchema>) => {
    if (!customerPublicId) {
      toast.error("Missing customer ID");
      return;
    }

    setIsLoading(true);
    // Never log the form values or the request: they carry the Aadhaar number.
    try {
      // Call Backend: Complete Walkin Profile
      const email = data.email?.trim();
      const payload: CompleteWalkinProfilePayload = {
        customer_public_id: customerPublicId,
        name: data.name,
        // Blank = the walk-in keeps its (hidden) placeholder email.
        ...(email ? { email } : {}),
        drivingLicenceNumber: data.drivingLicenceNumber,
        aadhaarNumber: data.aadhaarNumber,
        dob: format(data.dob, "yyyy-MM-dd"),
        addressLine1: data.addressLine1,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        country: data.country,
      };

      const result =
        await employeeCustomerService.completeWalkinProfile(payload);

      // Success! Store session with the server-derived profile status
      const session: CustomerSession = {
        publicId: customerPublicId,
        name: data.name,
        phone: phoneForm.getValues("phone"),
        profileCompleted: result.isProfileCompleted,
        kycStatus: false, // New customer, no KYC yet
      };
      customerSession.set(session);
      useEmployeeBookingStore.getState().clearCounterPayment();

      if (result.isProfileCompleted) {
        toast.success("Customer profile created!");
      } else {
        toast.warning(result.message);
      }
      navigate("/employee/vehicles");
    } catch (error: any) {
      const body = error?.response?.data;
      // VALIDATION_ERROR: per-field messages under errors.fieldErrors
      const fieldErrors: Record<string, string[] | undefined> =
        body?.errors?.fieldErrors ?? {};
      for (const [field, messages] of Object.entries(fieldErrors)) {
        if (messages?.[0] && field in profileSchema.shape) {
          profileForm.setError(field as keyof z.infer<typeof profileSchema>, {
            message: messages[0],
          });
        }
      }
      if (body?.code === "EMAIL_ALREADY_EXISTS" || body?.code === "EMAIL_CHANGE_NOT_ALLOWED") {
        profileForm.setError("email", { message: body.message });
      }
      if (isVerificationPendingError(error)) {
        // The phone OTP is not verified for this customer: back to that step.
        setStep("PHONE_OTP");
        setOtpSent(false);
        setReceivedOtp(null);
        phoneForm.setValue("otp", "");
      }
      toast.error(body?.message || "Failed to create profile");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20 pt-6">
      <div className="container max-w-lg mx-auto px-4">
        <Button
          variant="ghost"
          className="mb-4 pl-0 hover:bg-transparent hover:text-primary"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Create New Customer</CardTitle>
            <CardDescription>
              {step === "PHONE_OTP"
                ? "Verify customer phone number"
                : "Enter customer details"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "PHONE_OTP" && (
              <div className="space-y-4">
                <Form {...phoneForm}>
                  <form className="space-y-4">
                    <FormField
                      control={phoneForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="+91 98765 43210"
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                // The "already exists" match was for the old number.
                                setExistingCustomerId(null);
                              }}
                              disabled={otpSent}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {otpSent && (
                      <>
                        {receivedOtp && (
                          <div className="mb-6 rounded-lg border bg-card text-card-foreground shadow-sm p-4">
                            <div className="flex flex-col space-y-1.5">
                              <h3 className="font-semibold leading-none tracking-tight">
                                One-Time Password
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                Share this code with the customer.
                              </p>
                            </div>
                            <div className="mt-4 flex items-center justify-center rounded-md bg-muted p-4">
                              <span className="text-2xl font-bold tracking-widest">
                                {receivedOtp}
                              </span>
                            </div>
                          </div>
                        )}
                        <FormField
                          control={phoneForm.control}
                          name="otp"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Enter OTP</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="123456"
                                  maxLength={6}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    {existingCustomerId && !otpSent && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                        <p className="text-sm text-amber-800 flex items-center gap-2 flex-wrap">
                          A customer with this phone number already exists.
                          {blacklistedExisting && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                              <Ban className="h-3 w-3" /> Blacklisted
                            </span>
                          )}
                        </p>
                        {blacklistedExisting ? (
                          <div className="rounded-md bg-red-50 px-3 py-2 text-xs flex items-start gap-2 text-red-700">
                            <Ban className="h-3.5 w-3.5 shrink-0 mt-px" />
                            <span>
                              <span className="font-semibold uppercase tracking-wide">Blacklisted</span>
                              {blacklistedExisting.reason ? ` — ${blacklistedExisting.reason}` : ""}
                              . Booking is blocked; a branch manager can remove the blacklist from the Customers tab.
                            </span>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-amber-800">
                              Continue with that customer instead of creating a
                              new account.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              onClick={handleUseExistingCustomer}
                              disabled={isLoading}
                            >
                              Continue with existing customer
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {!otpSent ? (
                      <Button
                        type="button"
                        className="w-full"
                        onClick={phoneForm.handleSubmit(handleSendOtp)}
                        disabled={isLoading}
                      >
                        {isLoading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Send OTP
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        className="w-full"
                        onClick={handleVerifyOtp}
                        disabled={isLoading}
                      >
                        {isLoading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Verify OTP
                      </Button>
                    )}
                  </form>
                </Form>
              </div>
            )}

            {step === "PROFILE_DETAILS" && (
              <Form {...profileForm}>
                <form
                  onSubmit={profileForm.handleSubmit(handleCreateProfile)}
                  className="space-y-4"
                >
                  <FormField
                    control={profileForm.control}
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
                    control={profileForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email (optional)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="john@example.com"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={profileForm.control}
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
                    control={profileForm.control}
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
                  <FormField
                    control={profileForm.control}
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
                                date > new Date() ||
                                date < new Date("1900-01-01")
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
                    control={profileForm.control}
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
                      control={profileForm.control}
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
                      control={profileForm.control}
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
                      control={profileForm.control}
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
                      control={profileForm.control}
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

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Complete Profile
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
