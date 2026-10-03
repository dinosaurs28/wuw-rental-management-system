import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import RecoveryPhoneCard from "@/components/auth/RecoveryPhoneCard";
import { diagnosticsService, type DeliveryDiagnostics } from "@/services/passwordReset.service";

const errMsg = (e: any, fallback: string) => e.response?.data?.message || fallback;

export const AdminDeliveryPage = () => {
  const [diag, setDiag] = useState<DeliveryDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);

  const load = async (verify = false) => {
    try {
      verify ? setChecking(true) : setLoading(true);
      setDiag(await diagnosticsService.getDelivery(verify));
    } catch (e: any) {
      toast.error(errMsg(e, "Failed to load delivery status"));
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const sendEmail = async () => {
    try {
      setSendingEmail(true);
      const res = await diagnosticsService.sendTestEmail(testEmail.trim());
      toast.success(res.message);
    } catch (e: any) {
      toast.error(errMsg(e, "Test email failed"));
    } finally {
      setSendingEmail(false);
    }
  };

  const sendSms = async () => {
    try {
      setSendingSms(true);
      const res = await diagnosticsService.sendTestSms(testPhone.trim());
      toast.success(res.message);
    } catch (e: any) {
      toast.error(errMsg(e, "Test SMS failed"));
    } finally {
      setSendingSms(false);
    }
  };

  const status = (ok: boolean) => (
    <Badge variant={ok ? "default" : "secondary"}>{ok ? "Configured" : "Not configured"}</Badge>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 pt-8 pb-12 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Email &amp; SMS delivery</h1>
        <p className="text-neutral-500 mt-2 text-lg">
          Check that password-reset codes and links can actually reach people.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Email (SMTP)</CardTitle>
            {diag && status(diag.smtpConfigured)}
          </div>
          <CardDescription>Used for emailed reset links and codes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {diag && (
            <>
              {diag.smtpConfigured ? (
                <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Server</dt>
                  <dd>
                    {diag.host}:{diag.port} {diag.secure ? "(secure)" : ""}
                  </dd>
                  <dt className="text-muted-foreground">Login</dt>
                  <dd>{diag.user ?? "—"}</dd>
                  <dt className="text-muted-foreground">From</dt>
                  <dd>
                    {diag.fromName}
                    {diag.fromEmail ? ` <${diag.fromEmail}>` : ""}
                  </dd>
                </dl>
              ) : (
                <p className="text-sm text-amber-600">
                  Email isn't set up on the server. Missing: {diag.missing.join(", ") || "—"}. Set them and restart the
                  backend.
                </p>
              )}
              {diag.connection && (
                <p className={`text-sm ${diag.connection.ok ? "text-green-600" : "text-red-600"}`}>
                  {diag.connection.ok
                    ? `Connection OK (${diag.connection.durationMs} ms).`
                    : `Connection failed: ${diag.connection.error ?? "unknown error"}`}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => load(true)}
                  disabled={checking || !diag.smtpConfigured}
                >
                  {checking ? "Testing..." : "Test connection"}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-email">Send a test email to</Label>
                <div className="flex gap-2">
                  <Input
                    id="test-email"
                    type="email"
                    placeholder="you@example.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                  />
                  <Button onClick={sendEmail} disabled={sendingEmail || !testEmail.trim()}>
                    {sendingEmail ? "Sending..." : "Send test email"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>SMS (MSG91)</CardTitle>
            {diag && status(diag.smsConfigured)}
          </div>
          <CardDescription>Used for password-reset codes and phone verification.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {diag && !diag.smsConfigured && (
            <p className="text-sm text-amber-600">
              SMS isn't set up on the server. Missing: {diag.smsMissing.join(", ") || "—"}.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="test-phone">Send a test SMS to</Label>
            <div className="flex gap-2">
              <Input
                id="test-phone"
                inputMode="tel"
                placeholder="98765 43210"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
              <Button onClick={sendSms} disabled={sendingSms || !testPhone.trim()}>
                {sendingSms ? "Sending..." : "Send test SMS"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <RecoveryPhoneCard portal="admin" />
    </div>
  );
};
