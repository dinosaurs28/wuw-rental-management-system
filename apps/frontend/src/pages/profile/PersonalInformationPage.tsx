import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import axios from "axios";
import { z } from "zod";
import { updateProfileSchema } from "@repo/schemas";

import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { useAuthStore } from "@/store/auth.store";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { userService, type UserProfile } from "@/services/user.service";
import { ageInputSchema, describeMissingProfileFields, formatAgeInput } from "@/lib/customerProfile";

// The form holds the age as typed (18–99, whole years); it is sent as a number.
const profileFormSchema = updateProfileSchema.extend({ age: ageInputSchema });
type ProfileFormValues = z.infer<typeof profileFormSchema>;

// Form values from a profile (GET /user/profile or the PUT response's data).
const toFormValues = (
  profile: Omit<UserProfile, "isProfileCompleted" | "missingFields">,
): ProfileFormValues => ({
  name: profile.name || "",
  phone: profile.phone || "",
  age: profile.age != null ? String(profile.age) : "",
  addressLine1: profile.addressLine1 || "",
  city: profile.city || "",
  state: profile.state || "",
  country: profile.country || "",
  zipCode: profile.zipCode || "",
  alternatePhone: profile.alternatePhone || "",
});

export const PersonalInformationPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  // Server-derived completeness (null = not loaded yet). Booking needs it.
  const [completeness, setCompleteness] = useState<{
    complete: boolean;
    missing: string[];
  } | null>(null);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      age: "",
      addressLine1: "",
      city: "",
      state: "",
      country: "",
      zipCode: "",
      alternatePhone: "",
    },
  });

  // Check auth and redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      toast.error("Please sign in to access your profile");
      navigate("/auth/sign-in", { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Fetch profile data on mount
  useEffect(() => {
    const fetchProfile = async () => {
      setIsLoadingProfile(true);
      try {
        const profile = await userService.getProfile();
        form.reset(toFormValues(profile));
        setUserEmail(profile.email || "");
        setCompleteness({
          complete: profile.isProfileCompleted,
          missing: profile.missingFields ?? [],
        });
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 || status === 403) {
            toast.error("Session expired. Please sign in again.");
            navigate("/auth/sign-in", { replace: true });
            return;
          }
        }
        toast.error("Failed to load profile data");
      } finally {
        setIsLoadingProfile(false);
      }
    };

    if (isAuthenticated) {
      fetchProfile();
    }
  }, [isAuthenticated, form, navigate]);

  const onSubmit = async (data: ProfileFormValues) => {
    setIsSubmitting(true);
    try {
      const response = await userService.updateProfile({ ...data, age: Number(data.age) });
      // The server stores normalised numbers — show what it saved.
      form.reset(toFormValues(response.data));
      setCompleteness({
        complete: response.isProfileCompleted,
        missing: response.missingFields ?? [],
      });
      toast.success("Profile updated successfully");
      // Sent here from checkout (PROFILE_INCOMPLETE) — go back to the booking.
      const { hasBookingIntent, clearBookingIntent } = useAuthStore.getState();
      const hasVehicle = useVehicleRentalStore.getState().hasVehicleSelected();
      if (hasBookingIntent && hasVehicle && response.isProfileCompleted) {
        clearBookingIntent();
        navigate("/booking/review-confirm");
        return;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          toast.error("Session expired. Please sign in again.");
          navigate("/auth/sign-in", { replace: true });
          return;
        }
        // VALIDATION_ERROR: put each issue under its input.
        const issues = error.response?.data?.errors;
        if (Array.isArray(issues)) {
          for (const issue of issues) {
            const field = issue?.path?.[0];
            if (typeof field === "string" && field in data) {
              form.setError(field as keyof ProfileFormValues, {
                message: issue.message,
              });
            }
          }
        }
        const message =
          error.response?.data?.message || "Failed to update profile";
        toast.error(message);
      } else {
        toast.error("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-zinc-50">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-6 md:py-10">
        {/* Main Card */}
        <Card className="max-w-3xl mx-auto shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl md:text-3xl font-bold">
              Personal Information
            </CardTitle>
            <CardDescription className="text-base">
              Manage your personal details and contact information.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            {isLoadingProfile ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-8"
                >
                  {/* Completeness banner — booking is blocked until complete */}
                  {completeness && !completeness.complete && (
                    <div
                      role="status"
                      className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                    >
                      <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                      <div className="text-sm">
                        <p className="font-semibold text-amber-900">
                          Complete your profile to book a vehicle
                        </p>
                        <p className="mt-0.5 text-amber-800">
                          {completeness.missing.length > 0
                            ? `Add your ${describeMissingProfileFields(completeness.missing)}.`
                            : "Fill in the required details below."}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Basic Info Section */}
                  <section>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                      Basic Info
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Full Name */}
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="John Doe"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Email (Read-only) */}
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address</Label>
                        <Input
                          id="email"
                          type="email"
                          value={userEmail}
                          disabled
                          className="h-12 bg-muted cursor-not-allowed"
                        />
                      </div>

                      {/* Phone Number */}
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="+1 (555) 000-0000"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Alternate Phone */}
                      <FormField
                        control={form.control}
                        name="alternatePhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Alternate Phone Number</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="9874158750"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>

                  {/* Personal Details Section */}
                  <section>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                      Personal Details
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Age (replaces the date of birth, Oct 2026) */}
                      <FormField
                        control={form.control}
                        name="age"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Age *</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="25"
                                inputMode="numeric"
                                autoComplete="off"
                                maxLength={2}
                                className="h-12"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(e) =>
                                  field.onChange(formatAgeInput(e.target.value))
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>

                  {/* Address Section */}
                  <section>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                      Address
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Address Line 1 */}
                      <FormField
                        control={form.control}
                        name="addressLine1"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Address Line 1</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Street address, City, State, ZIP"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* City */}
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Mangaluru"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* State */}
                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Karnataka"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Country */}
                      <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="India"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* ZIP Code */}
                      <FormField
                        control={form.control}
                        name="zipCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ZIP Code</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="575001"
                                className="h-12"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>

                  {/* Submit Button */}
                  <div className="flex justify-end pt-4 border-t">
                    <Button
                      type="submit"
                      size="lg"
                      className="min-w-[180px]"
                      disabled={isSubmitting}
                    >
                      {isSubmitting && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Update Profile
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </main>

      <Footer />
    </div>
  );
};

export default PersonalInformationPage;
