import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "@/components/layouts/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema } from "@repo/schemas";
import { z } from "zod";
import { useForgotPassword } from "@/hooks/useAuth";
import { ArrowRight, Loader2 } from "lucide-react";
import SmsResetFlow from "@/components/auth/SmsResetFlow";
import { passwordResetService, type ResetChannels } from "@/services/passwordReset.service";

type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

const fieldClass =
  "h-[58px] w-full rounded-[14px] bg-white border-[1.5px] border-zinc-200 px-5 text-[16px] font-medium text-zinc-900 placeholder:text-[#8a8a93] transition-colors hover:border-zinc-300 focus-visible:border-zinc-900 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none";

const labelClass =
  "text-[13px] font-bold tracking-[-0.01em] text-zinc-900 pl-1";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [mode, setMode] = useState<"sms" | "email">("sms");
  const [channels, setChannels] = useState<ResetChannels | null>(null);

  useEffect(() => {
    passwordResetService.getChannels().then((c) => {
      setChannels(c);
      if (!c.sms) setMode("email");
    });
  }, []);
  const { mutate: forgotPassword, isPending } = useForgotPassword();

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = (data: ForgotPasswordInput) =>
    forgotPassword(data.email, { onSuccess: () => setSubmitted(true) });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={
        mode === "sms"
          ? "Enter your mobile number or email and we'll text you a 6-digit code."
          : "Enter your email address and we'll send you a link to reset your password."
      }
    >
      {mode === "sms" ? (
        <SmsResetFlow
          scope="customer"
          variant="customer"
          signInPath="/auth/sign-in"
          emailAvailable={channels?.email !== false}
          onUseEmail={() => setMode("email")}
        />
      ) : submitted ? (
        <p className="text-zinc-600 font-medium">
          If that email is registered, a reset link has been sent. Please
          check your inbox.
        </p>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="forgot-email" className={labelClass}>
              Email address
            </Label>
            <Input
              id="forgot-email"
              placeholder="name@example.com"
              className={fieldClass}
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <p className="text-[12px] font-semibold pl-1 text-red-500">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full h-[58px] rounded-[14px] bg-[#f0500a] hover:bg-[#d9470a] text-white font-bold text-[17px] tracking-[-0.01em] transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                Send reset link
                <ArrowRight className="size-5" />
              </>
            )}
          </Button>
        </form>
      )}

      {mode === "email" && channels?.email === false && (
        <p className="mt-3 text-center text-[12px] font-semibold text-amber-600">
          Email reset is unavailable right now — use the SMS code.
        </p>
      )}
      {mode === "email" && channels?.sms !== false && (
        <div className="mt-5 text-center text-[13px] font-semibold text-zinc-500">
          <button type="button" onClick={() => setMode("sms")} className="hover:text-zinc-800 transition-colors underline underline-offset-2">
            Text me a code instead
          </button>
        </div>
      )}

      <div className="mt-7 text-center text-[13px] font-semibold text-zinc-500">
        <Link to="/auth/sign-in" className="hover:text-zinc-800 transition-colors">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
