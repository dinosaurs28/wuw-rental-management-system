import { useEffect, useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { adminService, type WhatsAppSupportConfigInput } from "@/services/admin.service";
import { resolveTemplate } from "@/hooks/useWhatsAppConfig";

const DEFAULT_TEMPLATE =
  "Hi, I need help with my rental booking {{bookingId}}. Please assist me.";

export const AdminWhatsAppConfigPage = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_TEMPLATE);
  const [isEnabled, setIsEnabled] = useState(true);

  const [previewVars, setPreviewVars] = useState("bookingId=BK-1234");

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const config = await adminService.getWhatsAppConfig();
      if (config) {
        setPhoneNumber(config.phoneNumber);
        setMessageTemplate(config.messageTemplate);
        setIsEnabled(config.isEnabled);
      }
    } catch {
      // No config yet — defaults stay
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async () => {
    if (!phoneNumber.trim()) {
      toast.error("Phone number is required");
      return;
    }
    if (!messageTemplate.trim()) {
      toast.error("Message template is required");
      return;
    }

    const payload: WhatsAppSupportConfigInput = {
      phoneNumber: phoneNumber.trim(),
      messageTemplate: messageTemplate.trim(),
      isEnabled,
    };

    try {
      setSaving(true);
      await adminService.upsertWhatsAppConfig(payload);
      toast.success("WhatsApp config saved successfully");
    } catch {
      toast.error("Failed to save WhatsApp config");
    } finally {
      setSaving(false);
    }
  };

  const handleClearCache = async () => {
    try {
      setClearing(true);
      await adminService.clearWhatsAppConfigCache();
      toast.success("Cache cleared");
    } catch {
      toast.error("Failed to clear cache");
    } finally {
      setClearing(false);
    }
  };

  // Build live preview URL
  const previewVariables = Object.fromEntries(
    previewVars
      .split(",")
      .map((s) => s.trim().split("="))
      .filter(([k]) => k)
      .map(([k, v]) => [k, v ?? ""])
  );
  const previewMessage = resolveTemplate(messageTemplate, previewVariables);
  const previewUrl = phoneNumber
    ? `https://wa.me/${phoneNumber.replace(/\D/g, "")}?text=${encodeURIComponent(previewMessage)}`
    : "";

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 pt-8 pb-12">
      <div className="mb-8">
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>WhatsApp Support</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
              WhatsApp Support
            </h1>
            <p className="text-neutral-500 mt-2 text-lg">
              Configure the WhatsApp support button shown to customers.
            </p>
          </div>
          <Badge
            variant={isEnabled ? "default" : "secondary"}
            className="mt-2 cursor-pointer select-none text-sm px-3 py-1"
            onClick={() => setIsEnabled((v) => !v)}
          >
            {isEnabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-neutral-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Config card */}
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>
                The phone number must include the country code (e.g.{" "}
                <span className="font-mono text-xs">919876543210</span> for India). Use{" "}
                <span className="font-mono text-xs">{"{{bookingId}}"}</span>,{" "}
                <span className="font-mono text-xs">{"{{vehicleName}}"}</span>, etc. as template
                variables in the message.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="phoneNumber">Phone Number (with country code)</Label>
                <Input
                  id="phoneNumber"
                  placeholder="919876543210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="messageTemplate">Message Template</Label>
                <Textarea
                  id="messageTemplate"
                  rows={4}
                  placeholder="Hi, I need help with booking {{bookingId}}."
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                />
                <p className="text-xs text-neutral-500">
                  Supported variables:{" "}
                  <span className="font-mono">
                    {"{{bookingId}}"}, {"{{vehicleName}}"}, {"{{orderId}}"}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save Config"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Live preview card */}
          <Card>
            <CardHeader>
              <CardTitle>Live Preview</CardTitle>
              <CardDescription>
                Enter comma-separated key=value pairs to preview the resolved message.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="previewVars">Preview Variables</Label>
                <Input
                  id="previewVars"
                  placeholder="bookingId=BK-1234, vehicleName=Honda Activa"
                  value={previewVars}
                  onChange={(e) => setPreviewVars(e.target.value)}
                />
              </div>

              <div className="rounded-md bg-neutral-50 border p-3 text-sm text-neutral-700 break-all">
                <p className="font-medium text-neutral-500 text-xs mb-1">Resolved message</p>
                {previewMessage || <span className="text-neutral-400 italic">— empty —</span>}
              </div>

              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1ebe5d] transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  Test on WhatsApp
                </a>
              )}
            </CardContent>
          </Card>

          {/* Cache management card */}
          <Card>
            <CardHeader>
              <CardTitle>Cache Management</CardTitle>
              <CardDescription>
                The config is cached in Redis for 5 minutes. Saving automatically invalidates the
                cache. Use the button below to force-clear it manually.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Separator className="mb-4" />
              <Button variant="outline" onClick={handleClearCache} disabled={clearing}>
                {clearing ? "Clearing…" : "Clear Cache"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
