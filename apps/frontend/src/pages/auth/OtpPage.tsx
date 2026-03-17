import { useState, useEffect } from "react";
import AuthLayout from "@/components/layouts/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSendOtp, useVerifyOtp } from "@/hooks/useAuth";

export default function OtpPage() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [timer, setTimer] = useState(59);

  const { mutate: sendOtp, isPending: isSendPending } = useSendOtp();
  const { mutate: verifyOtp, isPending: isVerifyPending } = useVerifyOtp();

  useEffect(() => {
    let interval: any;
    if (step === "otp" && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  const handleSendOtp = (e?: React.FormEvent) => {
    e?.preventDefault();
    sendOtp(phone, {
      onSuccess: () => {
        setStep("otp");
        setTimer(59);
      },
    });
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    verifyOtp({ phone, otp });
  };

  return (
    <AuthLayout
      title="Verify Your Identity"
      subtitle="To ensure a seamless vehicle pickup experience, please verify your mobile number."
    >
      {step === "phone" ? (
        <form onSubmit={handleSendOtp} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="phone">Mobile Number</Label>
            <div className="flex gap-2">
              {/* Country code placeholder */}
              <div className="flex h-12 w-[80px] items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                IN +91
              </div>
              <Input
                id="phone"
                className="h-12 flex-1"
                placeholder="8784512451"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>
          <Button
            type="submit"
            className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold"
            disabled={isSendPending}
          >
            {isSendPending ? "Sending Code..." : "Send Code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-6">
          <div className="space-y-2 text-center">
            <Label>6-Digit Code</Label>
            <div className="flex justify-center gap-2">
              <Input
                className="h-12 text-center tracking-widest text-lg"
                placeholder="123456"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                autoFocus
              />
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Code Sent to {phone}.{" "}
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="text-orange-600 hover:underline"
              >
                Change number
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold"
            disabled={isVerifyPending}
          >
            {isVerifyPending ? "Verifying..." : "Verify & Continue ->"}
          </Button>

          <div className="text-center text-sm text-gray-500">
            {timer > 0 ? (
              <span>Resend code in 0:{timer.toString().padStart(2, "0")}</span>
            ) : (
              <button
                type="button"
                onClick={() => handleSendOtp()}
                className="text-orange-600 hover:underline disabled:opacity-50"
                disabled={isSendPending}
              >
                {isSendPending ? "Resending..." : "Resend Code"}
              </button>
            )}
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
