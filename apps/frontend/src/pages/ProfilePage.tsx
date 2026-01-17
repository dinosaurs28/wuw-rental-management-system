import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import axios from 'axios';
import { updateProfileSchema } from '@repo/schemas';
import type { UpdateProfileInput } from '@repo/schemas';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, parse } from 'date-fns';

import { useAuthStore } from '@/store/auth.store';
import { userService } from '@/services/user.service';
import { cn } from '@/lib/utils';

export function ProfilePage() {
    const navigate = useNavigate();
    const { isAuthenticated, isLoading: authLoading } = useAuthStore();

    const [isLoadingProfile, setIsLoadingProfile] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [originalData, setOriginalData] = useState<UpdateProfileInput | null>(null);
    const [userEmail, setUserEmail] = useState<string>('');

    const form = useForm<UpdateProfileInput>({
        resolver: zodResolver(updateProfileSchema),
        defaultValues: {
            name: '',
            phone: '',
            dob: '',
            addressLine1: '',
            city: '',
            state: '',
            country: '',
            zipCode: '',
            alternatePhone: '',
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
                    name: profile.name || '',
                    phone: profile.phone || '',
                    dob: profile.dob || '',
                    addressLine1: profile.addressLine1 || '',
                    city: profile.city || '',
                    state: profile.state || '',
                    country: profile.country || '',
                    zipCode: profile.zipCode || '',
                    alternatePhone: profile.alternatePhone || '',
                };
                form.reset(formData);
                setOriginalData(formData);
                setUserEmail(profile.email || '');
            } catch (error) {
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    if (status === 401 || status === 403) {
                        toast.error('Session expired. Please sign in again.');
                        navigate('/auth/sign-in', { replace: true });
                        return;
                    }
                }
                toast.error('Failed to load profile data');
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
            toast.success('Profile updated successfully');
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                if (status === 401 || status === 403) {
                    toast.error('Session expired. Please sign in again.');
                    navigate('/auth/sign-in', { replace: true });
                    return;
                }
                const message = error.response?.data?.message || 'Failed to update profile';
                toast.error(message);
            } else {
                toast.error('An unexpected error occurred');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // Parse DOB string to Date object for calendar
    const parseDobToDate = (dob: string | undefined): Date | undefined => {
        if (!dob) return undefined;
        try {
            return parse(dob, 'yyyy-MM-dd', new Date());
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
                <Card className="shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xl font-semibold">
                            Personal Information
                        </CardTitle>
                        <CardDescription>
                            Update your personal details below.
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
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
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
                                            {/* Date of Birth */}
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
                                                                        variant="outline"
                                                                        className={cn(
                                                                            'h-12 w-full justify-start text-left font-normal',
                                                                            !field.value && 'text-muted-foreground'
                                                                        )}
                                                                    >
                                                                        {field.value
                                                                            ? format(parseDobToDate(field.value) || new Date(), 'PPP')
                                                                            : 'dd-mm-yyyy'}
                                                                    </Button>
                                                                </FormControl>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-auto p-0" align="start">
                                                                <Calendar
                                                                    mode="single"
                                                                    selected={parseDobToDate(field.value)}
                                                                    onSelect={(date) => {
                                                                        if (date) {
                                                                            field.onChange(format(date, 'yyyy-MM-dd'));
                                                                        }
                                                                    }}
                                                                    disabled={(date) =>
                                                                        date > new Date() || date < new Date('1900-01-01')
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
                                            disabled={!hasChanges || !form.formState.isValid || isSubmitting}
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
