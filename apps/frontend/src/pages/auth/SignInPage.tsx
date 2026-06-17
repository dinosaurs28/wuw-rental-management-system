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
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";

interface SignInPageProps {
  defaultTab?: "sign-in" | "sign-up";
}

const fieldClass =
  "h-[58px] w-full rounded-[14px] bg-white border-[1.5px] border-zinc-200 px-5 text-[16px] font-medium text-zinc-900 placeholder:text-[#8a8a93] transition-colors hover:border-zinc-300 focus-visible:border-zinc-900 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none";

const labelClass =
  "text-[13px] font-bold tracking-[-0.01em] text-zinc-900 pl-1";

export default function SignInPage({
  defaultTab = "sign-in",
}: SignInPageProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

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
      subtitle={
        activeTab === "sign-in"
          ? "Please enter your details to access your account."
          : "Enter your details to get started."
      }
    >
      <Tabs
        defaultValue={defaultTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        {/* Tabs styled like the landing page category pills */}
        <TabsList className="grid w-full grid-cols-2 mb-6 bg-[#f3f3f5] p-[5px] rounded-full h-[54px]">
          <TabsTrigger
            value="sign-in"
            className="rounded-full text-zinc-500 data-[state=active]:bg-zinc-900 data-[state=active]:text-white data-[state=active]:shadow-sm font-semibold text-[15px] tracking-[-0.01em] transition-all h-full"
          >
            Sign In
          </TabsTrigger>
          <TabsTrigger
            value="sign-up"
            className="rounded-full text-zinc-500 data-[state=active]:bg-zinc-900 data-[state=active]:text-white data-[state=active]:shadow-sm font-semibold text-[15px] tracking-[-0.01em] transition-all h-full"
          >
            Register
          </TabsTrigger>
        </TabsList>

        <div className="grid gap-5 mb-5">
          <Button
            variant="outline"
            className="w-full flex items-center justify-center gap-3 h-[58px] rounded-[14px] font-semibold text-[16px] border-[1.5px] border-zinc-200 text-zinc-800 bg-white shadow-none hover:bg-zinc-50 hover:border-zinc-300 hover:text-zinc-950 transition-colors"
            onClick={() => authService.googleSignIn()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="20"
              viewBox="0 0 24 24"
              width="20"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
              <path d="M1 1h22v22H1z" fill="none" />
            </svg>
            Continue with Google
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-200" />
            </div>
            <div className="relative flex justify-center text-[11px] font-bold uppercase tracking-[0.18em]">
              <span className="bg-white px-4 text-zinc-400">
                Or continue with email
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-visible min-h-[300px]">
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
                <form
                  onSubmit={signInForm.handleSubmit(onSignIn)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="signin-email" className={labelClass}>
                      Email address
                    </Label>
                    <Input
                      id="signin-email"
                      placeholder="name@example.com"
                      className={fieldClass}
                      {...signInForm.register("email")}
                    />
                    {signInForm.formState.errors.email && (
                      <p className="text-[12px] font-semibold pl-1 text-red-500">
                        {signInForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between pl-1 pr-1">
                      <Label htmlFor="signin-password" className={labelClass}>
                        Password
                      </Label>
                      <a
                        href="#"
                        className="text-[13px] text-[#f0500a] font-bold hover:text-[#d9470a] transition-colors"
                      >
                        Forgot?
                      </a>
                    </div>
                    <div className="relative">
                      <Input
                        id="signin-password"
                        type={showSignInPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className={cn(fieldClass, "pr-12")}
                        {...signInForm.register("password")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignInPassword((v) => !v)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                        tabIndex={-1}
                      >
                        {showSignInPassword ? (
                          <EyeOff className="size-5" />
                        ) : (
                          <Eye className="size-5" />
                        )}
                      </button>
                    </div>
                    {signInForm.formState.errors.password && (
                      <p className="text-[12px] font-semibold pl-1 text-red-500">
                        {signInForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>

                  <motion.button
                    whileHover={!isSignInPending ? { scale: 1.01 } : {}}
                    whileTap={!isSignInPending ? { scale: 0.99 } : {}}
                    type="submit"
                    className="w-full h-[58px] rounded-[14px] bg-[#f0500a] hover:bg-[#d9470a] text-white font-bold text-[17px] tracking-[-0.01em] transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={isSignInPending}
                  >
                    {isSignInPending ? (
                      <>
                        <Loader2 className="size-5 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        Sign In
                        <ArrowRight className="size-5" />
                      </>
                    )}
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
                <form
                  onSubmit={signUpForm.handleSubmit(onSignUp)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="signup-name" className={labelClass}>
                      Full name
                    </Label>
                    <Input
                      id="signup-name"
                      placeholder="John Doe"
                      className={fieldClass}
                      {...signUpForm.register("name")}
                    />
                    {signUpForm.formState.errors.name && (
                      <p className="text-[12px] font-semibold pl-1 text-red-500">
                        {signUpForm.formState.errors.name.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className={labelClass}>
                      Email address
                    </Label>
                    <Input
                      id="signup-email"
                      placeholder="name@example.com"
                      className={fieldClass}
                      {...signUpForm.register("email")}
                    />
                    {signUpForm.formState.errors.email && (
                      <p className="text-[12px] font-semibold pl-1 text-red-500">
                        {signUpForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className={labelClass}>
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showSignUpPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className={cn(fieldClass, "pr-12")}
                        {...signUpForm.register("password")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignUpPassword((v) => !v)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                        tabIndex={-1}
                      >
                        {showSignUpPassword ? (
                          <EyeOff className="size-5" />
                        ) : (
                          <Eye className="size-5" />
                        )}
                      </button>
                    </div>
                    {signUpForm.formState.errors.password && (
                      <p className="text-[12px] font-semibold pl-1 text-red-500">
                        {signUpForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>
                  <motion.button
                    whileHover={!isSignUpPending ? { scale: 1.01 } : {}}
                    whileTap={!isSignUpPending ? { scale: 0.99 } : {}}
                    type="submit"
                    className="w-full h-[58px] rounded-[14px] bg-[#f0500a] hover:bg-[#d9470a] text-white font-bold text-[17px] tracking-[-0.01em] transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={isSignUpPending}
                  >
                    {isSignUpPending ? (
                      <>
                        <Loader2 className="size-5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        Create Account
                        <ArrowRight className="size-5" />
                      </>
                    )}
                  </motion.button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Tabs>

      <div className="mt-7 text-center text-[12px] font-medium text-zinc-400 px-2 leading-relaxed">
        By continuing, you agree to our{" "}
        <a
          href="#"
          className="underline hover:text-zinc-600 transition-colors"
        >
          Terms of Service
        </a>{" "}
        &{" "}
        <a
          href="#"
          className="underline hover:text-zinc-600 transition-colors"
        >
          Privacy Policy
        </a>
        .
        <br />
        Secure authentication via WUW Rentals Identity.
      </div>
    </AuthLayout>
  );
}
