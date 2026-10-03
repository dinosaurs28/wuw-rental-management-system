import { Request, Response } from "express";
import type { Role } from "@repo/database/client";
import { otpSchema, passwordRule } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { getClientIp } from "../../utils/clientIp.js";
import { getSmtpStatus } from "../email/mailer.js";
import { isSmsConfigured } from "../otp/otpservice.js";
import { RESET_CODE_EXPIRY_MINUTES, RESET_CODE_RESEND_SECONDS } from "./passwordReset.service.js";
import {
  parseResetIdentifier,
  requestPasswordResetSms,
  resetPasswordWithSmsCode,
} from "./smsReset.service.js";

// Same answer whether or not an account matched, had a phone, or hit a limit.
const GENERIC_SMS_SENT_MESSAGE =
  "If an account matches, a 6-digit code has been sent by SMS to the mobile number on that account.";
const IDENTIFIER_MESSAGE = "Enter your registered mobile number or email address.";
const INVALID_CODE_MESSAGE = "Invalid or expired reset code.";

function userAgentOf(req: Request): string | undefined {
  const header = req.headers["user-agent"];
  return typeof header === "string" ? header : undefined;
}

// `identifier` is the documented field; `phone` / `email` are accepted aliases
// so a form that already names its field either way works unchanged.
function identifierFrom(body: unknown) {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const raw = [source.identifier, source.phone, source.email].find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  return parseResetIdentifier(raw);
}

function validationError(res: Response, message: string) {
  return res.status(StatusCode.BAD_REQUEST).json({
    success: false,
    code: "VALIDATION_ERROR",
    message,
  });
}

// Express 4 ignores rejected promises from async handlers; every handler here
// catches and answers.
function internalError(res: Response, where: string, error: unknown, message: string) {
  console.error(`Internal Error in ${where}`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message,
  });
}

// GET /api/auth/password-reset/channels — which reset channels can deliver
// right now, so a client can steer people away from email when SMTP is off.
export function passwordResetChannelsController(_req: Request, res: Response) {
  const sms = isSmsConfigured();
  const email = getSmtpStatus().configured;
  return res.status(StatusCode.OK).json({
    success: true,
    sms,
    email,
    defaultChannel: sms ? "SMS" : "EMAIL",
  });
}

// `allowedRoles` scopes each mount (customer / employee / branchManager /
// admin): phones are not unique across roles, so each portal only ever
// resolves to accounts it can sign in.
export function makeForgotPasswordSmsController(allowedRoles: Role[]) {
  return async (req: Request, res: Response) => {
    try {
      const identifier = identifierFrom(req.body);
      if (!identifier) return validationError(res, IDENTIFIER_MESSAGE);

      const result = await requestPasswordResetSms(
        identifier,
        allowedRoles,
        getClientIp(req),
        userAgentOf(req),
      );

      if (!result.ok) {
        return res.status(StatusCode.TOO_MANY_REQUESTS).json({
          success: false,
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
        });
      }

      return res.status(StatusCode.OK).json({
        success: true,
        channel: "SMS",
        message: GENERIC_SMS_SENT_MESSAGE,
        expiresInMinutes: RESET_CODE_EXPIRY_MINUTES,
        resendAfterSeconds: RESET_CODE_RESEND_SECONDS,
      });
    } catch (error) {
      return internalError(
        res,
        "forgotPasswordSms",
        error,
        "Something went wrong while sending the reset code. Please try again.",
      );
    }
  };
}

export function makeResetPasswordSmsController(allowedRoles: Role[]) {
  return async (req: Request, res: Response) => {
    try {
      const identifier = identifierFrom(req.body);
      if (!identifier) return validationError(res, IDENTIFIER_MESSAGE);

      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawCode = body.otp ?? body.code;
      const codeParsed = otpSchema.shape.otp.safeParse(
        typeof rawCode === "number" ? String(rawCode) : typeof rawCode === "string" ? rawCode.trim() : rawCode,
      );
      if (!codeParsed.success) {
        return validationError(
          res,
          codeParsed.error.issues[0]?.message ?? "OTP must be exactly 6 digits",
        );
      }
      const passwordParsed = passwordRule.safeParse(body.password);
      if (!passwordParsed.success) {
        return validationError(
          res,
          passwordParsed.error.issues[0]?.message ?? "Please choose a stronger password",
        );
      }

      const result = await resetPasswordWithSmsCode(
        identifier,
        codeParsed.data,
        passwordParsed.data,
        allowedRoles,
        getClientIp(req),
        userAgentOf(req),
      );

      if (!result.ok) {
        if (result.reason === "RATE_LIMITED") {
          return res.status(StatusCode.TOO_MANY_REQUESTS).json({
            success: false,
            code: "RATE_LIMITED",
            message: "Too many attempts. Please try again later.",
          });
        }
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "INVALID_RESET_CODE",
          message: INVALID_CODE_MESSAGE,
        });
      }

      return res.status(StatusCode.OK).json({
        success: true,
        message: "Password reset successfully. You can now sign in.",
        signInEmail: result.signInEmail,
      });
    } catch (error) {
      return internalError(
        res,
        "resetPasswordSms",
        error,
        "Something went wrong while resetting the password. Please try again.",
      );
    }
  };
}
