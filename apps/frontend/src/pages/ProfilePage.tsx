import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import axios from "axios";
import { updateProfileSchema } from "@repo/schemas";
import type { UpdateProfileInput } from "@repo/schemas";

import { DashboardLayout } from "@/components/layouts/DashboardLayout";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, parse } from "date-fns";

import { useAuthStore } from "@/store/auth.store";
import { userService } from "@/services/user.service";
import { cn } from "@/lib/utils";

export function ProfilePage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [originalData, setOriginalData] = useState<UpdateProfileInput | null>(
    null,
  );
  const [userEmail, setUserEmail] = useState<string>("");

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: "",
      phone: "",
      dob: "",
      addressLine1: "",
      city: "",
      state: "",
      country: "",
      zipCode: "",
      alternatePhone: "",
    },
  });

  const watchedValues = form.watch();

  // Check if form has changes
  const hasChanges = originalData
    ? JSON.stringify(watchedValues) !== JSON.stringify(originalData)
    : false;

  // Fetch profile data on mount
  useEffect(() => {
    const fetchProfile = async () => {
      setIsLoadingProfile(true);
      try {
        const profile = await userService.getProfile();
        const formData: UpdateProfileInput = {
          name: profile.name || "",
          phone: profile.phone || "",
          dob: profile.dob || "",
          addressLine1: profile.addressLine1 || "",
          city: profile.city || "",
          state: profile.state || "",
          country: profile.country || "",
          zipCode: profile.zipCode || "",
          alternatePhone: profile.alternatePhone || "",
        };
        form.reset(formData);
        setOriginalData(formData);
        setUserEmail(profile.email || "");
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

  const onSubmit = async (data: UpdateProfileInput) => {
    setIsSubmitting(true);
    try {
      await userService.updateProfile(data);
      setOriginalData(data);
      toast.success("Profile updated successfully");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          toast.error("Session expired. Please sign in again.");
          navigate("/auth/sign-in", { replace: true });
          return;
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

  // Parse DOB string to Date object for calendar
  const parseDobToDate = (dob: string | undefined): Date | undefined => {
    if (!dob) return undefined;
    try {
      return parse(dob, "yyyy-MM-dd", new Date());
    } catch {
      return undefined;
    }
  };

  // Loading state
  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex items-center justify-center p-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Profile
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage your personal details and contact information
          </p>
        </div>

        {/* Main Card */}
        <Card className="border-0 shadow-2xl bg-zinc-900/40 backdrop-blur-2xl rounded-[2rem] overflow-hidden relative">
          {/* Subtle Inner Glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none" />

          <CardHeader className="pb-6 pt-8 px-8 border-b border-white/5 relative z-10">
            <CardTitle className="text-2xl font-serif font-black tracking-tight text-white">
              Personal Information
            </CardTitle>
            <CardDescription className="text-zinc-400 font-medium text-sm">
              Update your personal details below. All information is stored
              securely.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-8 px-8 pb-8 relative z-10">
            {isLoadingProfile ? (
              <div className="space-y-12">
                <section>
                  <h3 className="text-xs font-black text-zinc-500/50 uppercase tracking-widest mb-6 pb-2 border-b border-white/5">
                    <Skeleton className="h-3 w-24 bg-white/10 rounded-full" />
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="space-y-3">
                        <Skeleton className="h-3 w-20 bg-white/10 rounded-full" />
                        <Skeleton className="h-14 w-full bg-white/5 rounded-full" />
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-black text-zinc-500/50 uppercase tracking-widest mb-6 pb-2 border-b border-white/5">
                    <Skeleton className="h-3 w-32 bg-white/10 rounded-full" />
                  </h3>
                  <div className="grid grid-cols-1 gap-6">
                    {[1].map((i) => (
                      <div key={i} className="space-y-3">
                        <Skeleton className="h-3 w-28 bg-white/10 rounded-full" />
                        <Skeleton className="h-14 w-[50%] bg-white/5 rounded-full" />
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-8"
                >
                  {/* Basic Info Section */}
                  <section>
                    <h3 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-white/5">
                      Basic Info
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Full Name */}
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              Full Name
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="John Doe"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />

                      {/* Email (Read-only) */}
                      <div className="space-y-2">
                        <Label
                          htmlFor="email"
                          className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase"
                        >
                          Email Address
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          value={userEmail}
                          disabled
                          className="h-14 rounded-full bg-black/20 border-white/5 text-zinc-500 cursor-not-allowed px-6"
                        />
                      </div>

                      {/* Phone Number */}
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              Phone Number
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="+1 (555) 000-0000"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />

                      {/* Alternate Phone */}
                      <FormField
                        control={form.control}
                        name="alternatePhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              Alternate Phone Number
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="9874158750"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>

                  {/* Personal Details Section */}
                  <section>
                    <h3 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-white/5">
                      Personal Details
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Date of Birth */}
                      <FormField
                        control={form.control}
                        name="dob"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              Date of Birth
                            </FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "h-14 rounded-full bg-black/40 border-white/10 text-white px-6 w-full justify-start text-left font-medium hover:bg-black/60 hover:text-white transition-all duration-300",
                                      !field.value && "text-zinc-600",
                                    )}
                                  >
                                    {field.value
                                      ? format(
                                          parseDobToDate(field.value) ||
                                            new Date(),
                                          "PPP",
                                        )
                                      : "Select your birth date"}
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-auto p-0 border-white/10 bg-zinc-900 text-zinc-50"
                                align="start"
                              >
                                <Calendar
                                  mode="single"
                                  selected={parseDobToDate(field.value)}
                                  onSelect={(date) => {
                                    if (date) {
                                      field.onChange(
                                        format(date, "yyyy-MM-dd"),
                                      );
                                    }
                                  }}
                                  disabled={(date) =>
                                    date > new Date() ||
                                    date < new Date("1900-01-01")
                                  }
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
                    </div>
                  </section>

                  {/* Address Section */}
                  <section>
                    <h3 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-white/5">
                      Address
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Address Line 1 */}
                      <FormField
                        control={form.control}
                        name="addressLine1"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              Address Line 1
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Street address, City, State, ZIP"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />

                      {/* City */}
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              City
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Mangaluru"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />

                      {/* State */}
                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              State
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Karnataka"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />

                      {/* Country */}
                      <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              Country
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="India"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />

                      {/* ZIP Code */}
                      <FormField
                        control={form.control}
                        name="zipCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                              ZIP Code
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="575001"
                                className="h-14 rounded-full bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 transition-all duration-300 px-6"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-red-400/90" />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>

                  {/* Submit Button */}
                  <div className="flex justify-end pt-8 mt-8 border-t border-white/5">
                    <Button
                      type="submit"
                      size="lg"
                      className="min-w-[200px] h-14 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 transition-all duration-300 font-bold tracking-wide shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
                      disabled={
                        !hasChanges || !form.formState.isValid || isSubmitting
                      }
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
      </div>
    </DashboardLayout>
  );
}
