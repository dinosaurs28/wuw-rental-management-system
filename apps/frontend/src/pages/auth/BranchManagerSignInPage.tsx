import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { emailAuthSchemaSignin } from "@repo/schemas";
import { useBranchManagerAuthStore } from "@/store/branchManagerAuth.store";
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

export default function BranchManagerSignInPage() {
    const navigate = useNavigate();
    const { login } = useBranchManagerAuthStore();
    const [isLoading, setIsLoading] = useState(false);

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
            // Redirect to dashboard or home, assuming branch manager dashboard path or reusing a common one
            // Since dashboard path wasn't explicitly defined/created in this task,
            // we will redirect to /branch-manager/dashboard and user can implement that separately or reuse.
            // Wait, looking at routes: router.get("/dashboard/revenue", ...)
            // I'll redirect to a landing dashboard for managers if I can find one, 
            // or just /branch-manager/dashboard which likely will be the path.
            navigate("/manager/dashboard");
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
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?q=80&w=2670&auto=format&fit=crop')] bg-cover bg-center opacity-50" />
                <div className="relative z-20 flex h-full flex-col justify-between p-12 text-white">
                    <div className="flex items-center gap-2 font-medium text-lg">
                        <div className="h-6 w-6 rounded-md bg-white text-black flex items-center justify-center font-bold">V</div>
                        WUW Manager Portal
                    </div>
                    <div className="space-y-2">
                        <h1 className="text-4xl font-bold tracking-tight">Oversee operations with precision.</h1>
                        <p className="text-lg text-zinc-300">Advanced tools for branch management and analytics.</p>
                    </div>
                </div>
            </div>

            {/* Right Side - Auth Form */}
            <div className="flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-background">
                <div className="mx-auto w-full max-w-[400px] space-y-6">
                    <div className="flex flex-col space-y-2 text-center lg:text-left">
                        <h1 className="text-3xl font-semibold tracking-tight">Manager Login</h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your credentials to access the dashboard.
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
                                                placeholder="manager@company.com"
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
                                    className="text-sm font-medium text-primary hover:underline"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        toast.info("Please contact IT support to reset your password.");
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
                        By signing in, you agree to our{" "}
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
