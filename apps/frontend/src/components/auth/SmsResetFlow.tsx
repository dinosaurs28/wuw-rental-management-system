import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { passwordRule } from "@repo/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { passwordResetService, type ResetScope } from "@/services/passwordReset.service";

interface Props {
  scope: ResetScope;
  signInPath: string;
  // "customer" uses the storefront look, "portal" the shadcn look of the staff/admin pages.
  variant: "customer" | "portal";
  onUseEmail: () => void;
  emailAvailable?: boolean;
}

const customerField =
  "h-[58px] w-full rounded-[14px] bg-white border-[1.5px] border-zinc-200 px-5 text-[16px] font-medium text-zinc-900 placeholder:text-[#8a8a93] transition-colors hover:border-zinc-300 focus-visible:border-zinc-900 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none";
const customerLabel = "text-[13px] font-bold tracking-[-0.01em] text-zinc-900 pl-1";
const customerButton =
  "w-full h-[58px] rounded-[14px] bg-[#f0500a] hover:bg-[#d9470a] text-white font-bold text-[17px] tracking-[-0.01em] transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-60 disabled:cursor-not-allowed";

export default function SmsResetFlow({ scope, signInPath, variant, onUseEmail, emailAvailable = true }: Props) {
  const customer = variant === "customer";
  const [step, setStep] = useState<"request" | "verify" | "done">("request");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [signInEmail, setSignInEmail] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fieldClass = customer ? customerField : undefined;
  const labelClass = customer ? customerLabel : undefined;
  const buttonClass = customer ? customerButton : "w-full";
  const errClass = customer ? "text-[12px] font-semibold pl-1 text-red-500" : "text-sm font-medium text-destructive";
  const mutedClass = customer ? "text-zinc-600 font-medium text-[14px]" : "text-sm text-muted-foreground";
  const linkClass = customer
    ? "font-bold text-zinc-800 underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
    : "underline underline-offset-4 hover:text-primary disabled:opacity-50 disabled:no-underline";

  const requestCode = async () => {
    if (!identifier.trim()) {
      setError("Enter your registered mobile number or email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await passwordResetService.requestSmsCode(scope, identifier.trim());
      setCooldown(res.resendAfterSeconds || 60);
      setOtp("");
      setStep("verify");
      toast.success(res.message);
    } catch (e: any) {
      setError(e.response?.data?.message || "Couldn't send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code from the SMS.");
      return;
    }
    const parsed = passwordRule.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Choose a stronger password.");
      return;
    }
    setBusy(true);
    try {
      const res = await passwordResetService.resetWithSmsCode(scope, {
        identifier: identifier.trim(),
        otp,
        password,
      });
      setSignInEmail(res.signInEmail ?? null);
      setStep("done");
      toast.success(res.message);
    } catch (e: any) {
      setError(e.response?.data?.message || "Couldn't reset the password. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <div className="space-y-4">
        <p className={mutedClass}>Your password has been reset. You can now sign in.</p>
        {signInEmail && (
          <p className={mutedClass}>
            Sign in with: <span className="font-bold text-foreground">{signInEmail}</span>
          </p>
        )}
        <Button asChild className={buttonClass}>
          <Link to={signInPath}>Go to sign in</Link>
        </Button>
      </div>
    );
  }

  const emailLink = emailAvailable && (
    <button type="button" onClick={onUseEmail} className={linkClass}>
      Email me a link instead
    </button>
  );

  return (
    <div className="space-y-4">
      {step === "request" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            requestCode();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="sms-identifier" className={labelClass}>
              Mobile number or email
            </Label>
            <Input
              id="sms-identifier"
              inputMode="text"
              autoComplete="username"
              placeholder="98765 43210 or name@example.com"
              className={fieldClass}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={busy}
            />
            <p className={cn(mutedClass, "text-xs")}>
              We'll text a 6-digit code to the mobile number on the account.
            </p>
          </div>
          {error && <p className={errClass}>{error}</p>}
          <Button type="submit" className={buttonClass} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin" /> Sending...
              </>
            ) : (
              <>
                Text me a code <ArrowRight className="size-5" />
              </>
            )}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitReset();
          }}
          className="space-y-4"
        >
          <p className={mutedClass}>
            If an account matches, a 6-digit code has been sent by SMS to the mobile number on it. It is valid for 10
            minutes.
          </p>
          <div className="space-y-2">
            <Label htmlFor="sms-otp" className={labelClass}>
              6-digit code
            </Label>
            <Input
              id="sms-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className={fieldClass}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms-password" className={labelClass}>
              New password
            </Label>
            <div className="relative">
              <Input
                id="sms-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                className={cn(fieldClass, "pr-12")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
            <p className={cn(mutedClass, "text-xs")}>
              At least 6 characters, with one uppercase letter and one special character.
            </p>
          </div>
          {error && <p className={errClass}>{error}</p>}
          <Button type="submit" className={buttonClass} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin" /> Resetting...
              </>
            ) : (
              <>
                Reset password <ArrowRight className="size-5" />
              </>
            )}
          </Button>
          <div className={cn(mutedClass, "flex flex-wrap items-center justify-between gap-2 text-xs")}>
            <button
              type="button"
              className={linkClass}
              disabled={busy || cooldown > 0}
              onClick={requestCode}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              className={linkClass}
              onClick={() => {
                setStep("request");
                setError(null);
              }}
            >
              Change number
            </button>
          </div>
          <p className={cn(mutedClass, "text-xs")}>
            Didn't get a code? Check the number, or use your email address instead — the code still goes to the mobile
            number on your account.
          </p>
        </form>
      )}
      {emailLink && <div className={cn(mutedClass, "text-center text-xs")}>{emailLink}</div>}
    </div>
  );
}
