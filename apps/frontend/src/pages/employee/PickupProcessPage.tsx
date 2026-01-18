import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { bookingService, type EmployeeBooking } from "@/services/booking.service";
import { Loader2, Car, Fuel, Gauge } from "lucide-react";

// Schema for Pickup Form
const pickupSchema = z.object({
    odo: z.number({ invalid_type_error: "Must be a number" }).min(0, "Odometer must be positive"),
    fuelLevel: z.number({ invalid_type_error: "Must be a number" }).min(0).max(100, "Fuel level cannot exceed 100%"),
});

type PickupFormValues = z.infer<typeof pickupSchema>;

export default function PickupProcessPage() {
    const { bookingId } = useParams();
    const navigate = useNavigate();
    const [booking, setBooking] = useState<EmployeeBooking | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { register, handleSubmit, formState: { errors } } = useForm<PickupFormValues>({
        resolver: zodResolver(pickupSchema),
        defaultValues: {
            fuelLevel: 100 // Default to full tank
        }
    });

    // Fetch Booking Details to verify it exists and show info
    useEffect(() => {
        const fetchBooking = async () => {
            if (!bookingId) return;
            try {
                // Ideally we'd have a getBookingById endpoint, but we can reuse getEmployeeBookings with loop or assume context
                // For now, let's try to find it in the list (inefficient but works without new endpoint)
                // OR better, we just blindly trust ID and show form, but fetching info is better UX.
                // Since I cannot easily add a new endpoint right now, I will skip fetching details for now 
                // and just rely on the form.

                // WAIT, I really should show vehicle info.
                // Let's assume getEmployeeBookings can filter by ID or I just fetch all for today?
                // Actually, I'll fetch today's bookings and find it.
                const bookings = await bookingService.getEmployeeBookings(new Date());
                const found = bookings.find(b => b.publicId === bookingId);
                if (found) {
                    setBooking(found);
                }
                // If not found, it might be for a different date. We'll proceed without details if not found, 
                // but user verifies ID from URL/Scanner.
            } catch (error) {
                console.error(error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchBooking();
    }, [bookingId]);

    const onSubmit = async (data: PickupFormValues) => {
        if (!bookingId) return;
        setIsSubmitting(true);
        try {
            await bookingService.approvePickup(bookingId, data);
            toast.success("Vehicle Pickup Confirmed!");
            navigate("/employee/dashboard");
        } catch (error: any) {
            console.error(error);
            toast.error(error.response?.data?.message || "Failed to confirm pickup");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50/50 pb-20">
            <DashboardNavbar />
            <div className="container max-w-lg py-10">
                <Card>
                    <CardHeader>
                        <CardTitle>Pickup Process</CardTitle>
                        <CardDescription>Enter initial vehicle condition for Booking #{bookingId}</CardDescription>
                    </CardHeader>
                    {booking && (
                        <div className="px-6 pb-4 mb-4 border-b bg-muted/20">
                            <div className="flex items-center gap-4 py-4">
                                <div className="h-16 w-16 bg-white rounded border flex items-center justify-center">
                                    {booking.items[0]?.vehicle.images?.[0]?.file?.url ? (
                                        <img src={booking.items[0].vehicle.images[0].file.url} className="h-full w-full object-cover rounded" alt="Car" />
                                    ) : (
                                        <Car className="h-8 w-8 text-muted-foreground" />
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-semibold">{booking.items[0]?.vehicle.make} {booking.items[0]?.vehicle.model}</h3>
                                    <p className="text-sm text-muted-foreground">{booking.customer.user.name}</p>
                                </div>
                            </div>
                        </div>
                    )}
                    <CardContent>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="odo">Odometer Reading (km)</Label>
                                <div className="relative">
                                    <Gauge className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="odo"
                                        type="number"
                                        placeholder="e.g. 15000"
                                        className="pl-9"
                                        {...register("odo", { valueAsNumber: true })}
                                    />
                                </div>
                                {errors.odo && <p className="text-sm text-red-500">{errors.odo.message}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="fuelLevel">Fuel Level (%)</Label>
                                <div className="relative">
                                    <Fuel className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="fuelLevel"
                                        type="number"
                                        placeholder="e.g. 100"
                                        className="pl-9"
                                        min={0}
                                        max={100}
                                        {...register("fuelLevel", { valueAsNumber: true })}
                                    />
                                </div>
                                {errors.fuelLevel && <p className="text-sm text-red-500">{errors.fuelLevel.message}</p>}
                            </div>

                            <Button type="submit" className="w-full bg-orange-600 hover:bg-orange-700" disabled={isSubmitting}>
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...
                                    </>
                                ) : (
                                    "Confirm Pickup"
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
