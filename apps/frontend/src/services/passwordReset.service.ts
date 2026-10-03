import apiClient from "@/lib/axios";

// SMS-code password reset (G2). One pair of endpoints per portal; each mount only touches
// accounts of its own role.
export type ResetScope = "customer" | "employee" | "branchManager" | "admin";

const SMS_BASE: Record<ResetScope, string> = {
  customer: "/auth/sms",
  employee: "/employee/auth/sms",
  branchManager: "/branchManager/auth/sms",
  admin: "/admin/auth/sms",
};

export interface ResetChannels {
  sms: boolean;
  email: boolean;
  defaultChannel: "SMS" | "EMAIL";
}

export interface SmsCodeRequested {
  message: string;
  expiresInMinutes: number;
  resendAfterSeconds: number;
}

export const passwordResetService = {
  // Never blocks the UI: a failed call is treated as "everything available".
  getChannels: async (): Promise<ResetChannels> => {
    try {
      const { data } = await apiClient.get<ResetChannels>("/auth/password-reset/channels");
      return {
        sms: data.sms !== false,
        email: data.email !== false,
        defaultChannel: data.defaultChannel === "EMAIL" ? "EMAIL" : "SMS",
      };
    } catch {
      return { sms: true, email: true, defaultChannel: "SMS" };
    }
  },

  requestSmsCode: async (scope: ResetScope, identifier: string): Promise<SmsCodeRequested> => {
    const { data } = await apiClient.post<SmsCodeRequested>(`${SMS_BASE[scope]}/forgot-password`, { identifier });
    return data;
  },

  resetWithSmsCode: async (
    scope: ResetScope,
    payload: { identifier: string; otp: string; password: string },
  ): Promise<{ message: string; signInEmail?: string }> => {
    const { data } = await apiClient.post<{ message: string; signInEmail?: string }>(
      `${SMS_BASE[scope]}/reset-password`,
      payload,
    );
    return data;
  },
};

export interface DeliveryDiagnostics {
  smtpConfigured: boolean;
  missing: string[];
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  fromEmail: string | null;
  fromName: string;
  smsConfigured: boolean;
  smsMissing: string[];
  connection?: { ok: boolean; durationMs: number; error?: string };
}

export interface RecoveryPhone {
  phone: string | null;
  maskedPhone: string | null;
  smsConfigured: boolean;
}

export const diagnosticsService = {
  getDelivery: async (verify = false): Promise<DeliveryDiagnostics> => {
    const { data } = await apiClient.get<DeliveryDiagnostics>("/admin/diagnostics/email", {
      params: verify ? { verify: 1 } : undefined,
    });
    return data;
  },
  sendTestEmail: async (to: string): Promise<{ message: string }> =>
    (await apiClient.post<{ message: string }>("/admin/diagnostics/email/test", { to })).data,
  sendTestSms: async (phone: string): Promise<{ message: string }> =>
    (await apiClient.post<{ message: string }>("/admin/diagnostics/sms/test", { phone })).data,
};

// Self-service recovery mobile number for logged-in ADMIN / MANAGER.
export const recoveryPhoneService = (portal: "admin" | "branchManager") => {
  const base = `/${portal}/account/recovery-phone`;
  return {
    get: async (): Promise<RecoveryPhone> => (await apiClient.get<RecoveryPhone>(base)).data,
    sendCode: async (phone: string): Promise<{ message: string; resendAfterSeconds: number }> =>
      (await apiClient.post(`${base}/send-code`, { phone })).data,
    verify: async (phone: string, otp: string): Promise<{ message: string; phone: string; maskedPhone: string }> =>
      (await apiClient.post(`${base}/verify`, { phone, otp })).data,
  };
};
