import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { rateLimit } from "../../utils/rateLimiter.js";
import { maskIndianMobile, normalizeIndianMobile, toMsg91Mobile } from "../../utils/phone.js";
import { getClientIp } from "../../utils/clientIp.js";
import { auditService, AuditCategory, AuditSeverity } from "../../services/audit/audit.service.js";
import {
  getSmtpStatus,
  sendMailWithTimeout,
  verifySmtpConnection,
} from "../../services/email/mailer.js";
import { isSmsConfigured, sendOTP, smsMissingEnv } from "../../services/otp/otpservice.js";

// Admin delivery diagnostics: forgot-password emails silently never arrived
// because production had no SMTP settings. These endpoints tell the admin
// whether email / SMS can go out and let them send a test of each.

const TEST_LIMIT = 5;
const TEST_WINDOW_SECONDS = 600;

const testEmailSchema = z.object({
  to: z.string().trim().email("Enter a valid email address."),
});

// A broken limiter (Redis down) must not block an admin's diagnostics.
async function testAllowed(key: string): Promise<boolean> {
  try {
    return await rateLimit(key, TEST_LIMIT, TEST_WINDOW_SECONDS);
  } catch (error) {
    console.error(`Rate limiter unavailable for key ${key}:`, error);
    return true;
  }
}

function rateLimited(res: Response, what: string) {
  return res.status(StatusCode.TOO_MANY_REQUESTS).json({
    success: false,
    code: "RATE_LIMITED",
    message: `Too many test ${what}. Try again in a few minutes.`,
  });
}

async function auditTest(
  req: Request,
  description: string,
  ok: boolean,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = req.public_Id
      ? await prisma.user.findUnique({
          where: { publicId: req.public_Id },
          select: { id: true, name: true },
        })
      : null;
    await auditService.log({
      actorId: admin?.id,
      actorName: admin?.name ?? "Admin",
      actorRole: Role.ADMIN,
      action: "DELIVERY_TEST",
      category: AuditCategory.SYSTEM,
      severity: ok ? AuditSeverity.INFO : AuditSeverity.WARNING,
      description,
      entity: "System",
      entityId: "delivery",
      ipAddress: getClientIp(req),
      metadata,
    });
  } catch (error) {
    console.error("Failed to write delivery test audit log:", error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * GET /api/admin/diagnostics/email[?verify=1]
 * SMTP (and SMS) configuration status; `verify=1` also logs in to the SMTP
 * server without sending anything.
 */
export const GetEmailDiagnostics = async (req: Request, res: Response) => {
  try {
    const smtp = getSmtpStatus();
    const wantsVerify = req.query.verify === "1" || req.query.verify === "true";
    const connection =
      wantsVerify && smtp.configured ? await verifySmtpConnection(15_000) : undefined;

    return res.status(StatusCode.OK).json({
      success: true,
      smtpConfigured: smtp.configured,
      missing: smtp.missing,
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user,
      fromEmail: smtp.fromEmail,
      fromName: smtp.fromName,
      smsConfigured: isSmsConfigured(),
      smsMissing: smsMissingEnv(),
      ...(connection ? { connection } : {}),
    });
  } catch (error) {
    console.error("Internal Error in GetEmailDiagnostics", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't read the email settings. Please try again.",
    });
  }
};

/**
 * POST /api/admin/diagnostics/email/test  { to }
 * Sends one test email through the same transport the reset emails use.
 */
export const SendTestEmail = async (req: Request, res: Response) => {
  try {
    const parsed = testEmailSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
      });
    }
    const to = parsed.data.to.toLowerCase();

    const smtp = getSmtpStatus();
    if (!smtp.configured) {
      return res.status(StatusCode.SERVICE_UNAVAILABLE).json({
        success: false,
        code: "SMTP_NOT_CONFIGURED",
        message:
          "Email isn't set up on the server. Set SMTP_USER and SMTP_APP_PASSWORD (and SMTP_HOST / SMTP_PORT / SMTP_FROM_EMAIL if not Gmail), then restart the backend.",
        missing: smtp.missing,
      });
    }

    if (!(await testAllowed(`diag:email:test:${req.public_Id ?? "admin"}`))) {
      return rateLimited(res, "emails");
    }

    const sentAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const startedAt = Date.now();
    try {
      await sendMailWithTimeout(
        {
          to,
          subject: "WUW Rentals — test email",
          html: `<p>This is a test email from the WUW Rentals server.</p>
<p>If you can read this, password reset and other emails can be delivered.</p>
<p style="color:#666;font-size:12px">Sent ${sentAt} IST via ${smtp.host}:${smtp.port}.</p>`,
        },
        20_000,
      );
    } catch (error) {
      const reason = errorMessage(error);
      void auditTest(req, `Test email to ${to} FAILED: ${reason}`, false, { to, host: smtp.host });
      return res.status(StatusCode.BAD_GATEWAY).json({
        success: false,
        code: "SMTP_SEND_FAILED",
        message: `The mail server did not accept the test email: ${reason}`,
        error: reason,
      });
    }

    const durationMs = Date.now() - startedAt;
    void auditTest(req, `Test email sent to ${to}`, true, { to, host: smtp.host, durationMs });
    return res.status(StatusCode.OK).json({
      success: true,
      message: `Test email sent to ${to}. Check the inbox and the spam folder.`,
      durationMs,
    });
  } catch (error) {
    console.error("Internal Error in SendTestEmail", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Something went wrong while sending the test email. Please try again.",
    });
  }
};

/**
 * POST /api/admin/diagnostics/sms/test  { phone }
 * Sends one SMS through the MSG91 OTP template the password reset uses.
 */
export const SendTestSms = async (req: Request, res: Response) => {
  try {
    const rawPhone = (req.body ?? {}).phone;
    const mobile = normalizeIndianMobile(typeof rawPhone === "string" ? rawPhone : undefined);
    if (!mobile) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Enter a valid 10-digit mobile number.",
      });
    }

    if (!isSmsConfigured()) {
      return res.status(StatusCode.SERVICE_UNAVAILABLE).json({
        success: false,
        code: "SMS_NOT_CONFIGURED",
        message:
          "SMS isn't set up on the server. Set MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID and MSG91_OTP_URL, then restart the backend.",
        missing: smsMissingEnv(),
      });
    }

    if (!(await testAllowed(`diag:sms:test:${req.public_Id ?? "admin"}`))) {
      return rateLimited(res, "SMS");
    }

    const startedAt = Date.now();
    const result = await sendOTP({
      mobile: toMsg91Mobile(mobile),
      otp: crypto.randomInt(100000, 1000000),
      templateId: process.env.MSG91_PASSWORD_RESET_TEMPLATE_ID?.trim() || undefined,
    });
    const durationMs = Date.now() - startedAt;
    const masked = maskIndianMobile(mobile);

    if (!result.success) {
      const reason = result.error || result.message || "Unknown error";
      void auditTest(req, `Test SMS to ${masked} FAILED: ${reason}`, false, { phone: masked });
      return res.status(StatusCode.BAD_GATEWAY).json({
        success: false,
        code: "SMS_SEND_FAILED",
        message: `MSG91 did not accept the test SMS: ${reason}`,
        error: reason,
      });
    }

    void auditTest(req, `Test SMS sent to ${masked}`, true, { phone: masked, durationMs });
    return res.status(StatusCode.OK).json({
      success: true,
      message: `Test SMS sent to +91${mobile}. The code in it is only a test.`,
      durationMs,
    });
  } catch (error) {
    console.error("Internal Error in SendTestSms", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Something went wrong while sending the test SMS. Please try again.",
    });
  }
};
