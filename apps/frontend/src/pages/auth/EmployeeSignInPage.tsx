import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { emailAuthSchemaSignin } from "@repo/schemas";
import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
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
import { Checkbox } from "@/components/ui/checkbox";

export default function EmployeeSignInPage() {
    const navigate = useNavigate();
    const { login } = useEmployeeAuthStore();
    const [isLoading, setIsLoading] = useState(false);

    // Define schema locally if not exactly matching remote or just use remote
    // Using imported schema
    const form = useForm<z.infer<typeof emailAuthSchemaSignin>>({
        resolver: zodResolver(emailAuthSchemaSignin),
        defaultValues: {
            email: "",
            password: "",
        },
    });

    async function onSubmit(values: z.infer<typeof emailAuthSchemaSignin>) {
        setIsLoading(true);
        try {
            await login(values);
            toast.success("Welcome back!", {
                description: "You have successfully signed in.",
            });
            navigate("/employee/dashboard");
        } catch (error: any) {
            console.error(error);
            toast.error("Authentication Failed", {
                description: error.response?.data?.message || "Invalid email or password.",
            });
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="min-h-screen w-full lg:grid lg:grid-cols-2">
            {/* Left Side - Hero Image */}
            <div className="hidden lg:block relative h-full w-full bg-zinc-900 overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=2694&auto=format&fit=crop')] bg-cover bg-center opacity-50" />
                <div className="relative z-20 flex h-full flex-col justify-between p-12 text-white">
                    <div className="flex items-center gap-2 font-medium text-lg">
                        <div className="h-6 w-6 rounded-md bg-white text-black flex items-center justify-center font-bold">V</div>
                        VRMS Employee Portal
                    </div>
                    <div className="space-y-2">
                        <h1 className="text-4xl font-bold tracking-tight">Manage the world's finest fleet.</h1>
                        <p className="text-lg text-zinc-300">Secure access for authorized personnel only.</p>
                    </div>
                </div>
            </div>

            {/* Right Side - Auth Form */}
            <div className="flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-background">
                <div className="mx-auto w-full max-w-[400px] space-y-6">
                    <div className="flex flex-col space-y-2 text-center lg:text-left">
                        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your credentials to access your account.
                        </p>
                    </div>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Email Address</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="staff@company.com"
                                                type="email"
                                                autoComplete="email"
                                                disabled={isLoading}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="flex items-center justify-between">
                                            <FormLabel>Password</FormLabel>
                                            <a
                                                href="#"
                                                className="text-sm font-medium text-primary hover:underline md:hidden"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    toast.info("Please contact your administrator to reset your password.");
                                                }}
                                            >
                                                Forgot password?
                                            </a>
                                        </div>
                                        <FormControl>
                                            <Input
                                                placeholder="••••••••"
                                                type="password"
                                                autoComplete="current-password"
                                                disabled={isLoading}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="remember" />
                                    <label
                                        htmlFor="remember"
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        Keep me signed in
                                    </label>
                                </div>
                                <a
                                    href="#"
                                    className="hidden text-sm font-medium text-primary hover:underline md:block"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        toast.info("Please contact your administrator to reset your password.");
                                    }}
                                >
                                    Forgot password?
                                </a>
                            </div>

                            <Button type="submit" className="w-full" disabled={isLoading}>
                                {isLoading ? "Signing in..." : "Sign In"}
                            </Button>
                        </form>
                    </Form>

                    <p className="px-8 text-center text-sm text-muted-foreground">
                        By clicking continue, you agree to our{" "}
                        <a href="#" className="underline underline-offset-4 hover:text-primary">
                            Terms of Service
                        </a>{" "}
                        and{" "}
                        <a href="#" className="underline underline-offset-4 hover:text-primary">
                            Privacy Policy
                        </a>
                        .
                    </p>
                </div>
            </div>
        </div>
    );
}
