import { useState } from "react";
import AuthLayout from "@/components/layouts/AuthLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { emailAuthSchema, emailAuthSchemaSignin } from "@repo/schemas";
import { useSignIn, useSignUp } from "@/hooks/useAuth";
import type { SignInInput, SignUpInput } from "@/services/auth.service";
import { authService } from "@/services/auth.service";
import { Label } from "@/components/ui/label";
import { motion, AnimatePresence } from "motion/react";
// Icons
// import { GoogleIcon } from "@/components/icons/GoogleIcon"; 


interface SignInPageProps {
    defaultTab?: "sign-in" | "sign-up";
}

export default function SignInPage({ defaultTab = "sign-in" }: SignInPageProps) {
    const [activeTab, setActiveTab] = useState<string>(defaultTab);

    const { mutate: signIn, isPending: isSignInPending } = useSignIn();
    const { mutate: signUp, isPending: isSignUpPending } = useSignUp();

    const signInForm = useForm<SignInInput>({
        resolver: zodResolver(emailAuthSchemaSignin),
        defaultValues: { email: "", password: "" },
    });

    const signUpForm = useForm<SignUpInput>({
        resolver: zodResolver(emailAuthSchema),
        defaultValues: { name: "", email: "", password: "" },
    });

    const onSignIn = (data: SignInInput) => signIn(data);
    const onSignUp = (data: SignUpInput) => signUp(data);

    return (
        <AuthLayout
            title={activeTab === "sign-in" ? "Welcome back" : "Create an account"}
            subtitle={activeTab === "sign-in" ? "Please enter your details to access your account." : "Enter your details to get started."}
        >
            <Tabs defaultValue={defaultTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="sign-in">Sign In</TabsTrigger>
                    <TabsTrigger value="sign-up">Register</TabsTrigger>
                </TabsList>

                <div className="grid gap-4 mb-6">
                    <Button variant="outline" className="w-full flex items-center gap-2 h-12 text-md" onClick={() => authService.googleSignIn()}>
                        {/* Placeholder for Google Icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /><path d="M1 1h22v22H1z" fill="none" /></svg>
                        Continue with Google
                    </Button>
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-500">Or continue with</span></div>
                    </div>
                </div>

                <div className="overflow-hidden">
                    <AnimatePresence mode="wait" initial={false}>
                        {activeTab === "sign-in" ? (
                            <motion.div
                                key="sign-in"
                                role="tabpanel"
                                tabIndex={0}
                                initial={{ opacity: 0, x: -25 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 25 }}
                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                className="w-full"
                            >
                                <form onSubmit={signInForm.handleSubmit(onSignIn)} className="space-y-4 pt-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="signin-email">Email Address</Label>
                                        <Input id="signin-email" placeholder="name@example.com" {...signInForm.register("email")} />
                                        {signInForm.formState.errors.email && <p className="text-sm text-red-500">{signInForm.formState.errors.email.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="signin-password">Password</Label>
                                            <a href="#" className="text-sm text-orange-600 font-medium hover:underline">Forgot Password?</a>
                                        </div>
                                        <Input id="signin-password" type="password" placeholder="••••••••" {...signInForm.register("password")} />
                                        {signInForm.formState.errors.password && <p className="text-sm text-red-500">{signInForm.formState.errors.password.message}</p>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input type="checkbox" id="keep-signed-in" className="rounded border-gray-300 text-orange-600 focus:ring-orange-600" />
                                        <label htmlFor="keep-signed-in" className="text-sm text-gray-500">Keep me signed in for 30 days</label>
                                    </div>
                                    <Button type="submit" className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold" disabled={isSignInPending}>
                                        {isSignInPending ? "Signing In..." : "CONTINUE ->"}
                                    </Button>
                                </form>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="sign-up"
                                role="tabpanel"
                                tabIndex={0}
                                initial={{ opacity: 0, x: 25 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -25 }}
                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                className="w-full"
                            >
                                <form onSubmit={signUpForm.handleSubmit(onSignUp)} className="space-y-4 pt-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="signup-name">Full Name</Label>
                                        <Input id="signup-name" placeholder="John Doe" {...signUpForm.register("name")} />
                                        {signUpForm.formState.errors.name && <p className="text-sm text-red-500">{signUpForm.formState.errors.name.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="signup-email">Email Address</Label>
                                        <Input id="signup-email" placeholder="name@example.com" {...signUpForm.register("email")} />
                                        {signUpForm.formState.errors.email && <p className="text-sm text-red-500">{signUpForm.formState.errors.email.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="signup-password">Password</Label>
                                        <Input id="signup-password" type="password" placeholder="••••••••" {...signUpForm.register("password")} />
                                        {signUpForm.formState.errors.password && <p className="text-sm text-red-500">{signUpForm.formState.errors.password.message}</p>}
                                    </div>
                                    <Button type="submit" className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold" disabled={isSignUpPending}>
                                        {isSignUpPending ? "Creating Account..." : "CONTINUE ->"}
                                    </Button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </Tabs>

            <div className="mt-6 text-center text-xs text-gray-500 px-4">
                By continuing, you agree to our <a href="#" className="underline">Terms of Service</a> and <a href="#" className="underline">Privacy Policy</a>.
                Secure, encrypted authentication provided by Drive Elite Identity.
            </div>
        </AuthLayout>
    );
}
