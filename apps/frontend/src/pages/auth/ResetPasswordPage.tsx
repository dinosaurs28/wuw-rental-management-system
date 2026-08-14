import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import AuthLayout from "@/components/layouts/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema } from "@repo/schemas";
import { z } from "zod";
import { useResetPassword } from "@/hooks/useAuth";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ResetPasswordFormInput = Omit<z.infer<typeof resetPasswordSchema>, "token">;

const fieldClass =
  "h-[58px] w-full rounded-[14px] bg-white border-[1.5px] border-zinc-200 px-5 text-[16px] font-medium text-zinc-900 placeholder:text-[#8a8a93] transition-colors hover:border-zinc-300 focus-visible:border-zinc-900 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none";

const labelClass =
  "text-[13px] font-bold tracking-[-0.01em] text-zinc-900 pl-1";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [showPassword, setShowPassword] = useState(false);
  const { mutate: resetPassword, isPending } = useResetPassword();

  const form = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordSchema.omit({ token: true })),
    defaultValues: { password: "" },
  });

  const onSubmit = (data: ResetPasswordFormInput) =>
    resetPassword({ token: token ?? "", password: data.password });

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a new password for your account."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reset-password" className={labelClass}>
            New password
          </Label>
          <div className="relative">
            <Input
              id="reset-password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              className={cn(fieldClass, "pr-12")}
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="size-5" />
              ) : (
                <Eye className="size-5" />
              )}
            </button>
          </div>
          {form.formState.errors.password && (
            <p className="text-[12px] font-semibold pl-1 text-red-500">
              {form.formState.errors.password.message}
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
              Resetting...
            </>
          ) : (
            <>
              Reset password
              <ArrowRight className="size-5" />
            </>
          )}
        </Button>
      </form>

      <div className="mt-7 text-center text-[13px] font-semibold text-zinc-500">
        <Link to="/auth/sign-in" className="hover:text-zinc-800 transition-colors">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
