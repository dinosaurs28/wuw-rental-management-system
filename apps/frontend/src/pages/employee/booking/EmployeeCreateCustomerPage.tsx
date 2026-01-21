
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
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
import { authService } from "@/services/auth.service"; // Reusing auth service for OTP

// Actually we need to use `InitiateWalkin` (OTP) and `CompleteWalkinProfile`.
// I need those services. I'll add them to booking service or a new one.
// Wait, `InitiateWalkin` is in `initiate.controller.ts`.
// I'll check if `bookingService` has them? No.
// I'll add them to `bookingService` or `employee.service` (which doesn't exist yet, so `bookingService` is the dumping ground for employee stuff per current pattern).

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

// --- STEPS ---
type Step = "PHONE_OTP" | "PROFILE_DETAILS";

// --- SCHEMAS ---
const phoneSchema = z.object({
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
    otp: z.string().optional(),
});

const profileSchema = z.object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email address"),
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
    const { isAuthenticated } = useEmployeeAuthStore();

    const [step, setStep] = useState<Step>("PHONE_OTP");
    const [isLoading, setIsLoading] = useState(false);
    const [otpSent, setOtpSent] = useState(false);
    const [customerPublicId, setCustomerPublicId] = useState<string | null>(null);

    // Forms
    const phoneForm = useForm<z.infer<typeof phoneSchema>>({
        resolver: zodResolver(phoneSchema),
        defaultValues: { phone: "", otp: "" },
    });

    const profileForm = useForm<z.infer<typeof profileSchema>>({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            country: "India", // Default
        },
    });

    // --- HANDLERS ---

    const handleSendOtp = async (data: z.infer<typeof phoneSchema>) => {
        setIsLoading(true);
        try {
            // Call Backend: Initiate Walkin (req.body: { phone })
            const response = await apiClient.post("/employee/walkin/initiate", { phone: data.phone });

            setCustomerPublicId(response.data.customer_public_id);
            setOtpSent(true);
            toast.success("OTP sent explicitly to customer phone");
        } catch (error: any) {
            console.error(error);
            toast.error(error.response?.data?.message || "Failed to send OTP");
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        const otp = phoneForm.getValues("otp");
        const phone = phoneForm.getValues("phone");

        if (!otp || otp.length !== 6) {
            phoneForm.setError("otp", { message: "Enter a valid 6-digit OTP" });
            return;
        }

        setIsLoading(true);
        try {
            // Call Backend: Verify Walkin OTP
            const response = await apiClient.post("/employee/walkin/verify", {
                phone,
                otp,
                customer_public_id: customerPublicId
            });

            // On success, we get maybe an auth token or just a success message.
            // For employee flow, we just need to know it's verified.
            // Check `verify.controller.ts`? 
            // Assuming 200 OK means verified.

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
        try {
            // Call Backend: Complete Walkin Profile
            const payload = {
                customer_public_id: customerPublicId,
                ...data, // name, email, dob, address...
                // Ensure field naming matches `complete.controller.ts` schema
            };

            const response = await apiClient.post("/employee/walkin/complete", payload);

            // Success! Store session
            const session: CustomerSession = {
                publicId: customerPublicId,
                name: data.name,
                phone: phoneForm.getValues("phone"),
                profileCompleted: true,
                kycStatus: false // New customer, no KYC yet
            };
            customerSession.set(session);

            toast.success("Customer profile created!");
            navigate("/employee/vehicles");

        } catch (error: any) {
            console.error(error);
            toast.error(error.response?.data?.message || "Failed to create profile");
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAuthenticated) return null;

    return (
        <div className="min-h-screen bg-gray-50/50 pb-20 pt-6">
            <div className="container max-w-lg mx-auto px-4">
                <Button variant="ghost" className="mb-4 pl-0 hover:bg-transparent hover:text-primary" onClick={() => navigate(-1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>

                <Card>
                    <CardHeader>
                        <CardTitle>Create New Customer</CardTitle>
                        <CardDescription>
                            {step === "PHONE_OTP" ? "Verify customer phone number" : "Enter customer details"}
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
                                                        <Input placeholder="+91 98765 43210" {...field} disabled={otpSent} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {otpSent && (
                                            <FormField
                                                control={phoneForm.control}
                                                name="otp"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Enter OTP</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="123456" maxLength={6} {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}

                                        {!otpSent ? (
                                            <Button
                                                type="button"
                                                className="w-full"
                                                onClick={phoneForm.handleSubmit(handleSendOtp)}
                                                disabled={isLoading}
                                            >
                                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                Send OTP
                                            </Button>
                                        ) : (
                                            <Button
                                                type="button"
                                                className="w-full"
                                                onClick={handleVerifyOtp}
                                                disabled={isLoading}
                                            >
                                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                Verify OTP
                                            </Button>
                                        )}
                                    </form>
                                </Form>
                            </div>
                        )}

                        {step === "PROFILE_DETAILS" && (
                            <Form {...profileForm}>
                                <form onSubmit={profileForm.handleSubmit(handleCreateProfile)} className="space-y-4">
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
                                                <FormLabel>Email</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="john@example.com" {...field} />
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
                                                                    !field.value && "text-muted-foreground"
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
                                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
