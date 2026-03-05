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
                <TabsList className="grid w-full grid-cols-2 mb-5 bg-zinc-100/80 p-1 rounded-full h-12">
                    <TabsTrigger 
                        value="sign-in" 
                        className="rounded-full text-zinc-500 data-[state=active]:bg-white data-[state=active]:text-zinc-950 data-[state=active]:shadow-md font-bold text-xs sm:text-sm transition-all h-full"
                    >
                        Sign In
                    </TabsTrigger>
                    <TabsTrigger 
                        value="sign-up" 
                        className="rounded-full text-zinc-500 data-[state=active]:bg-white data-[state=active]:text-zinc-950 data-[state=active]:shadow-md font-bold text-xs sm:text-sm transition-all h-full"
                    >
                        Register
                    </TabsTrigger>
                </TabsList>

                <div className="grid gap-3 mb-5">
                    <Button variant="outline" className="w-full flex items-center justify-center gap-3 h-12 rounded-full font-bold border-zinc-200 text-zinc-700 bg-white shadow-sm hover:bg-zinc-50 hover:text-zinc-950 transition-all text-sm" onClick={() => authService.googleSignIn()}>
                        {/* Placeholder for Google Icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 0 24 24" width="18"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /><path d="M1 1h22v22H1z" fill="none" /></svg>
                        Continue with Google
                    </Button>
                    <div className="relative my-1">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-zinc-200" /></div>
                        <div className="relative flex justify-center text-[9px] font-bold uppercase tracking-[0.2em]"><span className="bg-white px-3 text-zinc-400">Or continue with email</span></div>
                    </div>
                </div>

                <div className="overflow-visible min-h-[290px]">
                    <AnimatePresence mode="wait" initial={false}>
                        {activeTab === "sign-in" ? (
                            <motion.div
                                key="sign-in"
                                role="tabpanel"
                                tabIndex={0}
                                initial={{ opacity: 0, x: -15, filter: "blur(2px)" }}
                                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                                exit={{ opacity: 0, x: 15, filter: "blur(2px)" }}
                                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                                className="w-full"
                            >
                                <form onSubmit={signInForm.handleSubmit(onSignIn)} className="space-y-4 pt-1">
                                    <div className="space-y-1">
                                        <Label htmlFor="signin-email" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-4">Email Address</Label>
                                        <Input id="signin-email" placeholder="name@example.com" className="h-12 rounded-full bg-zinc-50/50 border-zinc-200 px-5 font-medium focus-visible:ring-zinc-950 focus-visible:bg-white transition-all hover:bg-zinc-50 text-sm" {...signInForm.register("email")} />
                                        {signInForm.formState.errors.email && <p className="text-[10px] font-bold pl-4 text-red-500">{signInForm.formState.errors.email.message}</p>}
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between pl-4 pr-4">
                                            <Label htmlFor="signin-password" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Password</Label>
                                            <a href="#" className="text-[10px] text-orange-600 font-bold uppercase tracking-wider hover:text-orange-700 transition-colors">Forgot?</a>
                                        </div>
                                        <Input id="signin-password" type="password" placeholder="••••••••" className="h-12 rounded-full bg-zinc-50/50 border-zinc-200 px-5 font-medium focus-visible:ring-zinc-950 focus-visible:bg-white transition-all hover:bg-zinc-50 text-sm tracking-[0.2em] placeholder:tracking-normal" {...signInForm.register("password")} />
                                        {signInForm.formState.errors.password && <p className="text-[10px] font-bold pl-4 text-red-500">{signInForm.formState.errors.password.message}</p>}
                                    </div>
                                    
                                    <motion.button 
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        type="submit" 
                                        className="w-full h-12 rounded-full bg-zinc-950 hover:bg-orange-500 text-white font-bold text-sm uppercase tracking-widest transition-all duration-300 shadow-lg shadow-zinc-950/20 hover:shadow-orange-500/30 flex items-center justify-center gap-2 mt-3" 
                                        disabled={isSignInPending}
                                    >
                                        {isSignInPending ? "Verifying..." : "Sign In"}
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                    </motion.button>
                                </form>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="sign-up"
                                role="tabpanel"
                                tabIndex={0}
                                initial={{ opacity: 0, x: 15, filter: "blur(2px)" }}
                                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                                exit={{ opacity: 0, x: -15, filter: "blur(2px)" }}
                                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                                className="w-full"
                            >
                                <form onSubmit={signUpForm.handleSubmit(onSignUp)} className="space-y-4 pt-1">
                                    <div className="space-y-1">
                                        <Label htmlFor="signup-name" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-4">Full Name</Label>
                                        <Input id="signup-name" placeholder="John Doe" className="h-12 rounded-full bg-zinc-50/50 border-zinc-200 px-5 font-medium focus-visible:ring-zinc-950 focus-visible:bg-white transition-all hover:bg-zinc-50 text-sm" {...signUpForm.register("name")} />
                                        {signUpForm.formState.errors.name && <p className="text-[10px] font-bold pl-4 text-red-500">{signUpForm.formState.errors.name.message}</p>}
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="signup-email" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-4">Email Address</Label>
                                        <Input id="signup-email" placeholder="name@example.com" className="h-12 rounded-full bg-zinc-50/50 border-zinc-200 px-5 font-medium focus-visible:ring-zinc-950 focus-visible:bg-white transition-all hover:bg-zinc-50 text-sm" {...signUpForm.register("email")} />
                                        {signUpForm.formState.errors.email && <p className="text-[10px] font-bold pl-4 text-red-500">{signUpForm.formState.errors.email.message}</p>}
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="signup-password" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-4">Password</Label>
                                        <Input id="signup-password" type="password" placeholder="••••••••" className="h-12 rounded-full bg-zinc-50/50 border-zinc-200 px-5 font-medium focus-visible:ring-zinc-950 focus-visible:bg-white transition-all hover:bg-zinc-50 text-sm tracking-[0.2em] placeholder:tracking-normal" {...signUpForm.register("password")} />
                                        {signUpForm.formState.errors.password && <p className="text-[10px] font-bold pl-4 text-red-500">{signUpForm.formState.errors.password.message}</p>}
                                    </div>
                                    <motion.button 
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        type="submit" 
                                        className="w-full h-12 rounded-full bg-zinc-950 hover:bg-orange-500 text-white font-bold text-sm uppercase tracking-widest transition-all duration-300 shadow-lg shadow-zinc-950/20 hover:shadow-orange-500/30 flex items-center justify-center gap-2 mt-3" 
                                        disabled={isSignUpPending}
                                    >
                                        {isSignUpPending ? "Creating..." : "Create Account"}
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                    </motion.button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </Tabs>

            <div className="mt-6 text-center text-[10px] sm:text-xs font-medium text-zinc-400 px-2 leading-relaxed">
                By continuing, you agree to our <a href="#" className="underline hover:text-zinc-600 transition-colors">Terms of Service</a> & <a href="#" className="underline hover:text-zinc-600 transition-colors">Privacy Policy</a>.
                <br />Secure authentication via Drive Elite Identity.
            </div>
        </AuthLayout>
    );
}
