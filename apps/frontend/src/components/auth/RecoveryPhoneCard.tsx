import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recoveryPhoneService, type RecoveryPhone } from "@/services/passwordReset.service";

// Self-service "recovery mobile number" so an ADMIN / BRANCH MANAGER can reset a password by SMS.
export default function RecoveryPhoneCard({ portal }: { portal: "admin" | "branchManager" }) {
  const api = recoveryPhoneService(portal);
  const [info, setInfo] = useState<RecoveryPhone | null>(null);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const load = () =>
    api.get().then(setInfo).catch(() => setInfo(null));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setBusy(true);
    try {
      const res = await api.sendCode(phone.trim());
      toast.success(res.message);
      setSent(true);
      setOtp("");
      setCooldown(res.resendAfterSeconds || 60);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const res = await api.verify(phone.trim(), otp);
      toast.success(res.message);
      setSent(false);
      setPhone("");
      setOtp("");
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Couldn't verify the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery mobile number</CardTitle>
        <CardDescription>
          {info?.maskedPhone
            ? `Password reset codes are texted to ${info.maskedPhone}.`
            : "Not set — add one so you can reset your password by SMS."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {info && !info.smsConfigured && (
          <p className="text-sm text-amber-600">SMS isn't set up on the server yet.</p>
        )}
        <div className="space-y-2">
          <Label htmlFor={`recovery-phone-${portal}`}>{info?.maskedPhone ? "New mobile number" : "Mobile number"}</Label>
          <div className="flex gap-2">
            <Input
              id={`recovery-phone-${portal}`}
              inputMode="tel"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
            />
            <Button type="button" variant="outline" onClick={sendCode} disabled={busy || !phone.trim() || cooldown > 0}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : sent ? "Resend code" : "Send code"}
            </Button>
          </div>
        </div>
        {sent && (
          <div className="space-y-2">
            <Label htmlFor={`recovery-otp-${portal}`}>6-digit code</Label>
            <div className="flex gap-2">
              <Input
                id={`recovery-otp-${portal}`}
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={busy}
              />
              <Button type="button" onClick={verify} disabled={busy || otp.length !== 6}>
                Verify &amp; save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
