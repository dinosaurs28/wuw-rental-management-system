import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, MailCheck } from "lucide-react";
import { forgotPasswordSchema, resetPasswordSchema } from "@repo/schemas";
import { toast } from "sonner";

import AuthLayout from "@/components/layouts/AuthLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForgotPassword, useResetPassword } from "@/hooks/useAuth";

// Three states: ask for the email, then take the code + new password, then a
// terminal confirmation. The email is captured in step 1 and carried forward —
// the reset endpoint needs it alongside the OTP because the code alone doesn't
// identify the account.
type Step = "email" | "reset" | "done";

// The backend allows one send per minute per user; mirroring that here means
// the resend link is only live when a resend would actually be accepted.
const RESEND_COOLDOWN_SECONDS = 60;

type EmailForm = z.infer<typeof forgotPasswordSchema>;

// Reuses the shared reset rules so the password constraints can't drift from
// what the backend enforces; email comes from step 1, and confirmPassword is a
// client-only guard against typos in a field the user can't read back.
const resetFormSchema = resetPasswordSchema
  .omit({ email: true })
  .extend({ confirmPassword: z.string().min(1, "Please confirm your password") })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type ResetForm = z.infer<typeof resetFormSchema>;

const inputClass =
  "h-12 rounded-full bg-zinc-50/50 border-zinc-200 px-5 font-medium focus-visible:ring-zinc-950 focus-visible:bg-white transition-all hover:bg-zinc-50 text-sm";
const labelClass =
  "text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-4";
const errorClass = "text-[10px] font-bold pl-4 text-red-500";
const submitClass =
  "w-full h-12 rounded-full bg-zinc-950 hover:bg-orange-500 text-white font-bold text-sm uppercase tracking-widest transition-all duration-300 shadow-lg shadow-zinc-950/20 hover:shadow-orange-500/30 flex items-center justify-center gap-2 mt-3 disabled:opacity-60 disabled:cursor-not-allowed";

const stepCopy: Record<Step, { title: string; subtitle: string }> = {
  email: {
    title: "Forgot password",
    subtitle:
      "Enter the email on your account and we'll send you a 6-digit reset code.",
  },
  reset: {
    title: "Enter your code",
    subtitle: "Check your inbox, then choose a new password below.",
  },
  done: {
    title: "Password updated",
    subtitle: "You can now sign in with your new password.",
  },
};

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const { mutate: requestCode, isPending: isSending } = useForgotPassword();
  const { mutate: submitReset, isPending: isResetting } = useResetPassword();

  const emailForm = useForm<EmailForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const resetForm = useForm<ResetForm>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { otp: "", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Success here only means the request was accepted — it is not confirmation
  // that an account exists, so the message stays conditional.
  const onRequestCode = ({ email: value }: EmailForm) => {
    requestCode(
      { email: value },
      {
        onSuccess: () => {
          setEmail(value);
          setStep("reset");
          setCooldown(RESEND_COOLDOWN_SECONDS);
          toast.success(
            `If an account exists for ${value}, a reset code is on its way.`,
          );
        },
      },
    );
  };

  const onResend = () => {
    if (cooldown > 0 || isSending) return;
    requestCode(
      { email },
      {
        onSuccess: () => {
          setCooldown(RESEND_COOLDOWN_SECONDS);
          toast.success("Reset code sent again.");
        },
      },
    );
  };

  const onReset = (data: ResetForm) => {
    submitReset(
      { email, otp: data.otp, password: data.password },
      {
        onSuccess: () => {
          setStep("done");
          toast.success("Password reset successfully.");
        },
        onError: () => {
          // The code is the only field worth retrying; the password stays put
          // so a mistyped OTP doesn't cost the user their whole entry.
          resetForm.resetField("otp");
        },
      },
    );
  };

  const copy = stepCopy[step];

  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle}>
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" && (
          <motion.div
            key="email"
            initial={{ opacity: 0, x: -15, filter: "blur(2px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 15, filter: "blur(2px)" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <form
              onSubmit={emailForm.handleSubmit(onRequestCode)}
              className="space-y-4"
            >
              <div className="space-y-1">
                <Label htmlFor="forgot-email" className={labelClass}>
                  Email Address
                </Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="name@example.com"
                  className={inputClass}
                  {...emailForm.register("email")}
                />
                {emailForm.formState.errors.email && (
                  <p className={errorClass}>
                    {emailForm.formState.errors.email.message}
                  </p>
                )}
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                className={submitClass}
                disabled={isSending}
              >
                {isSending ? "Sending..." : "Send Reset Code"}
              </motion.button>
            </form>
          </motion.div>
        )}

        {step === "reset" && (
          <motion.div
            key="reset"
            initial={{ opacity: 0, x: 15, filter: "blur(2px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -15, filter: "blur(2px)" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-start gap-3 rounded-3xl bg-zinc-50 border border-zinc-200 px-5 py-4 mb-5">
              <MailCheck className="size-4 text-orange-600 mt-0.5 shrink-0" />
              <p className="text-xs font-medium text-zinc-600 leading-relaxed">
                We sent a 6-digit code to{" "}
                <span className="font-bold text-zinc-950 break-all">
                  {email}
                </span>
                . It expires in 10 minutes.
              </p>
            </div>

            <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="reset-otp" className={labelClass}>
                  6-Digit Code
                </Label>
                <Input
                  id="reset-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  placeholder="123456"
                  className={`${inputClass} text-center tracking-[0.5em] placeholder:tracking-[0.5em]`}
                  {...resetForm.register("otp")}
                />
                {resetForm.formState.errors.otp && (
                  <p className={errorClass}>
                    {resetForm.formState.errors.otp.message}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="reset-password" className={labelClass}>
                  New Password
                </Label>
                <div className="relative">
                  <Input
                    id="reset-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={`${inputClass} pr-12 tracking-[0.2em] placeholder:tracking-normal`}
                    {...resetForm.register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                    tabIndex={-1}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {resetForm.formState.errors.password ? (
                  <p className={errorClass}>
                    {resetForm.formState.errors.password.message}
                  </p>
                ) : (
                  <p className="text-[10px] font-medium pl-4 text-zinc-400">
                    At least 6 characters, one uppercase letter and one special
                    character.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="reset-confirm" className={labelClass}>
                  Confirm Password
                </Label>
                <Input
                  id="reset-confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className={`${inputClass} tracking-[0.2em] placeholder:tracking-normal`}
                  {...resetForm.register("confirmPassword")}
                />
                {resetForm.formState.errors.confirmPassword && (
                  <p className={errorClass}>
                    {resetForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                className={submitClass}
                disabled={isResetting}
              >
                {isResetting ? "Updating..." : "Update Password"}
              </motion.button>
            </form>

            <div className="mt-5 flex items-center justify-between gap-3 px-1">
              <button
                type="button"
                onClick={() => setStep("email")}
                className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 transition-colors"
              >
                <ArrowLeft className="size-3" />
                Change email
              </button>
              <button
                type="button"
                onClick={onResend}
                disabled={cooldown > 0 || isSending}
                className="text-[10px] font-bold uppercase tracking-wider text-orange-600 hover:text-orange-700 transition-colors disabled:text-zinc-400 disabled:cursor-not-allowed"
              >
                {cooldown > 0
                  ? `Resend in 0:${String(cooldown).padStart(2, "0")}`
                  : isSending
                    ? "Resending..."
                    : "Resend code"}
              </button>
            </div>
          </motion.div>
        )}

        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-green-50 border border-green-200">
              <CheckCircle2 className="size-7 text-green-600" />
            </div>
            <p className="text-sm font-medium text-zinc-600 leading-relaxed mb-6">
              Your password has been changed. Use it the next time you sign in
              on the web or in the app.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => navigate("/auth/sign-in", { replace: true })}
              className={submitClass}
            >
              Back to Sign In
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {step !== "done" && (
        <div className="mt-6 text-center text-xs font-medium text-zinc-400">
          Remembered it?{" "}
          <Link
            to="/auth/sign-in"
            className="font-bold text-orange-600 hover:text-orange-700 transition-colors"
          >
            Sign in
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
