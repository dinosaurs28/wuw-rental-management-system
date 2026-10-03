import crypto from "crypto";
import { Request, Response } from "express";
import { prisma, Role } from "@repo/database/client";
import { otpSchema } from "@repo/schemas";
import { redis } from "../../lib/redisconfig.js";
import { StatusCode } from "../../types/statusCode.js";
import { getClientIp } from "../../utils/clientIp.js";
import { comparehash, hashpassword } from "../../utils/PasswordCrypt/password.js";
import { rateLimit } from "../../utils/rateLimiter.js";
import {
  indianMobileLookupVariants,
  maskIndianMobile,
  normalizeIndianMobile,
  toMsg91Mobile,
} from "../../utils/phone.js";
import { AuditCategory, AuditSeverity } from "../audit/audit.service.js";
import { isSmsConfigured, sendOTP } from "../otp/otpservice.js";
import {
  logAudit,
  RESET_CODE_EXPIRY_MINUTES,
  RESET_CODE_MAX_WRONG_ATTEMPTS,
  RESET_CODE_RESEND_SECONDS,
} from "./passwordReset.service.js";

// ── Recovery mobile number (Admin + Branch Manager, logged in) ──────────────
// Branch Manager and Admin accounts were created without a phone, so the SMS
// password reset had nowhere to send their code. These endpoints let them add
// one, proving it with a code sent to the new number before it is saved.
// Pending codes live in Redis (not EmailVerificationOtp) so a phone-change
// code can never be used as a password reset code.

const ROLE_LABEL: Partial<Record<Role, string>> = {
  [Role.MANAGER]: "branch manager",
  [Role.ADMIN]: "admin",
};

type PendingCode = { phone: string; hash: string; expiresAt: number };

const codeKey = (userId: number) => `recovery-phone:code:${userId}`;
const wrongKey = (userId: number) => `recovery-phone:wrong:${userId}`;

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, code, message });
}

function internalError(res: Response, where: string, error: unknown) {
  console.error(`Internal Error in ${where}`, error);
  return fail(
    res,
    StatusCode.INTERNAL_SERVER_ERROR,
    "INTERNAL_ERROR",
    "Something went wrong. Please try again.",
  );
}

async function currentUser(req: Request, role: Role) {
  if (!req.public_Id) return null;
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, publicId: true, name: true, email: true, phone: true, role: true, deletedAt: true, isActive: true },
  });
  return user && user.role === role && !user.deletedAt && user.isActive ? user : null;
}

// One number per account within the role, or SMS reset by phone can't tell
// the accounts apart.
async function phoneTakenInRole(phone: string, role: Role, exceptUserId: number): Promise<boolean> {
  const other = await prisma.user.findFirst({
    where: {
      role,
      deletedAt: null,
      id: { not: exceptUserId },
      phone: { in: indianMobileLookupVariants(phone) },
    },
    select: { id: true },
  });
  return !!other;
}

function phoneInUse(res: Response, role: Role) {
  return fail(
    res,
    StatusCode.CONFLICT,
    "PHONE_IN_USE",
    `This mobile number is already on another ${ROLE_LABEL[role] ?? "staff"} account.`,
  );
}

export function makeRecoveryPhoneHandlers(role: Role) {
  const unauthorized = (res: Response) =>
    fail(res, StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "Please sign in again.");

  // GET …/account/recovery-phone
  const get = async (req: Request, res: Response) => {
    try {
      const user = await currentUser(req, role);
      if (!user) return unauthorized(res);
      const phone = normalizeIndianMobile(user.phone);
      return res.status(StatusCode.OK).json({
        success: true,
        phone,
        maskedPhone: phone ? maskIndianMobile(phone) : null,
        smsConfigured: isSmsConfigured(),
      });
    } catch (error) {
      return internalError(res, "getRecoveryPhone", error);
    }
  };

  // POST …/account/recovery-phone/send-code { phone }
  const sendCode = async (req: Request, res: Response) => {
    try {
      const user = await currentUser(req, role);
      if (!user) return unauthorized(res);

      const rawPhone = (req.body ?? {}).phone;
      const phone = normalizeIndianMobile(typeof rawPhone === "string" ? rawPhone : undefined);
      if (!phone) {
        return fail(res, StatusCode.BAD_REQUEST, "INVALID_PHONE", "Enter a valid 10-digit mobile number.");
      }
      if (normalizeIndianMobile(user.phone) === phone) {
        return fail(res, StatusCode.CONFLICT, "PHONE_UNCHANGED", "This is already your recovery mobile number.");
      }
      if (await phoneTakenInRole(phone, role, user.id)) return phoneInUse(res, role);
      if (!isSmsConfigured()) {
        return fail(res, StatusCode.SERVICE_UNAVAILABLE, "SMS_NOT_CONFIGURED", "SMS isn't set up on the server yet.");
      }

      const minuteAllowed = await rateLimit(
        `recovery-phone:send_1min:${user.id}`,
        1,
        RESET_CODE_RESEND_SECONDS,
      );
      const hourAllowed =
        minuteAllowed && (await rateLimit(`recovery-phone:send_hour:${user.id}`, 5, 3600));
      if (!hourAllowed) {
        return fail(
          res,
          StatusCode.TOO_MANY_REQUESTS,
          "RATE_LIMITED",
          "Please wait a minute before requesting another code.",
        );
      }

      const code = crypto.randomInt(100000, 1000000);
      const pending: PendingCode = {
        phone,
        hash: await hashpassword(String(code)),
        expiresAt: Date.now() + RESET_CODE_EXPIRY_MINUTES * 60_000,
      };
      await redis.set(codeKey(user.id), JSON.stringify(pending), "EX", RESET_CODE_EXPIRY_MINUTES * 60);
      await redis.del(wrongKey(user.id));

      const result = await sendOTP({ mobile: toMsg91Mobile(phone), otp: code });
      if (!result.success) {
        await redis.del(codeKey(user.id));
        logAudit({
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: "RECOVERY_PHONE_CODE_FAILED",
          category: AuditCategory.AUTH,
          severity: AuditSeverity.WARNING,
          description: `Recovery phone code SMS FAILED to send to ${maskIndianMobile(phone)} for ${user.email}`,
          entity: "User",
          entityId: user.publicId,
          ipAddress: getClientIp(req),
          metadata: { providerMessage: result.message, providerError: result.error },
        });
        return fail(res, StatusCode.BAD_GATEWAY, "SMS_SEND_FAILED", "Couldn't send the SMS right now. Please try again.");
      }

      return res.status(StatusCode.OK).json({
        success: true,
        message: `We've sent a 6-digit code to ${maskIndianMobile(phone)}.`,
        expiresInMinutes: RESET_CODE_EXPIRY_MINUTES,
        resendAfterSeconds: RESET_CODE_RESEND_SECONDS,
      });
    } catch (error) {
      return internalError(res, "sendRecoveryPhoneCode", error);
    }
  };

  // POST …/account/recovery-phone/verify { phone, otp }
  const verify = async (req: Request, res: Response) => {
    try {
      const user = await currentUser(req, role);
      if (!user) return unauthorized(res);

      const body = (req.body ?? {}) as Record<string, unknown>;
      const phone = normalizeIndianMobile(typeof body.phone === "string" ? body.phone : undefined);
      if (!phone) {
        return fail(res, StatusCode.BAD_REQUEST, "INVALID_PHONE", "Enter a valid 10-digit mobile number.");
      }
      const rawCode = body.otp ?? body.code;
      const codeParsed = otpSchema.shape.otp.safeParse(
        typeof rawCode === "number" ? String(rawCode) : typeof rawCode === "string" ? rawCode.trim() : rawCode,
      );
      if (!codeParsed.success) {
        return fail(res, StatusCode.BAD_REQUEST, "VALIDATION_ERROR", "Enter the 6-digit code.");
      }

      const stored = await redis.get(codeKey(user.id));
      const pending = stored ? (JSON.parse(stored) as PendingCode) : null;
      const live = !!pending && pending.phone === phone && pending.expiresAt > Date.now();
      const matches = live && (await comparehash(codeParsed.data, pending!.hash));

      if (!matches) {
        if (live) {
          // A pending code survives a few wrong guesses, then must be re-sent.
          const withinLimit = await rateLimit(
            wrongKey(user.id),
            RESET_CODE_MAX_WRONG_ATTEMPTS - 1,
            RESET_CODE_EXPIRY_MINUTES * 60,
          );
          if (!withinLimit) await redis.del(codeKey(user.id), wrongKey(user.id));
        }
        return fail(res, StatusCode.BAD_REQUEST, "INVALID_CODE", "Invalid or expired code.");
      }

      if (await phoneTakenInRole(phone, role, user.id)) return phoneInUse(res, role);

      // Consume the code first so a double submit can't save twice.
      const removed = await redis.del(codeKey(user.id));
      if (removed === 0) {
        return fail(res, StatusCode.BAD_REQUEST, "INVALID_CODE", "Invalid or expired code.");
      }
      await redis.del(wrongKey(user.id));

      await prisma.user.update({ where: { id: user.id }, data: { phone } });

      logAudit({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: "RECOVERY_PHONE_UPDATED",
        category: AuditCategory.AUTH,
        severity: AuditSeverity.INFO,
        description: `Recovery mobile number set to ${maskIndianMobile(phone)} for ${user.email}`,
        entity: "User",
        entityId: user.publicId,
        ipAddress: getClientIp(req),
        metadata: {
          previous: normalizeIndianMobile(user.phone)
            ? maskIndianMobile(normalizeIndianMobile(user.phone)!)
            : null,
        },
      });

      return res.status(StatusCode.OK).json({
        success: true,
        message: "Recovery mobile number saved.",
        phone,
        maskedPhone: maskIndianMobile(phone),
      });
    } catch (error) {
      return internalError(res, "verifyRecoveryPhone", error);
    }
  };

  return { get, sendCode, verify };
}
