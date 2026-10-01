import { Request, Response } from "express";
import type { Role } from "@repo/database/client";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  resetPasswordWithOtpSchema,
} from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { getClientIp } from "../../utils/clientIp.js";
import {
  requestPasswordReset,
  requestPasswordResetCode,
  resetPassword,
  resetPasswordWithCode,
  safeRateLimit,
  PortalPath,
  RESET_CODE_EXPIRY_MINUTES,
  RESET_CODE_RESEND_SECONDS,
} from "./passwordReset.service.js";

// Every forgot endpoint answers the same way whether or not the email has an
// account, so none of them can be used to discover registered addresses.
const GENERIC_LINK_SENT_MESSAGE =
  "If that email is registered, a reset link has been sent.";
const GENERIC_CODE_SENT_MESSAGE =
  "If an account exists for that email, a reset code has been sent.";
// One message for every code failure so a caller can't tell which factor
// (email, code or expiry) was wrong.
const INVALID_CODE_MESSAGE = "Invalid or expired reset code.";

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid Inputs";
}

function userAgentOf(req: Request): string | undefined {
  const header = req.headers["user-agent"];
  return typeof header === "string" ? header : undefined;
}

// Express 4 ignores rejected promises from async handlers, which would leave
// the request hanging and crash the process; every handler here catches.
function internalError(res: Response, where: string, error: unknown, message: string) {
  console.error(`Internal Error in ${where}`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message,
  });
}

// portalPath only labels the audit row: the emailed link always opens the
// portal that matches the account's role.
export function makeForgotPasswordController(portalPath: PortalPath) {
  return async (req: Request, res: Response) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: firstIssueMessage(parsed.error),
          error: parsed.error,
        });
      }

      await requestPasswordReset(
        parsed.data.email,
        portalPath,
        getClientIp(req),
        userAgentOf(req),
      );

      return res.status(StatusCode.OK).json({
        success: true,
        message: GENERIC_LINK_SENT_MESSAGE,
      });
    } catch (error) {
      return internalError(
        res,
        "forgotPassword",
        error,
        "Something went wrong while requesting the reset link. Please try again.",
      );
    }
  };
}

export async function resetPasswordController(req: Request, res: Response) {
  try {
    const ip = getClientIp(req);
    if (ip) {
      const allowed = await safeRateLimit(`pwreset:confirm:ip:${ip}`, 10, 3600);
      if (!allowed) {
        return res.status(StatusCode.TOO_MANY_REQUESTS).json({
          success: false,
          code: "RATE_LIMITED",
          message: "Too many attempts. Please try again later.",
        });
      }
    }

    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: firstIssueMessage(parsed.error),
        error: parsed.error,
      });
    }

    const result = await resetPassword(
      parsed.data.token,
      parsed.data.password,
      ip,
      userAgentOf(req),
    );

    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        INVALID_TOKEN: "This reset link is invalid.",
        EXPIRED_TOKEN: "This reset link has expired. Please request a new one.",
        USED_TOKEN: "This reset link has already been used.",
      };
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: result.reason,
        message: messages[result.reason],
      });
    }

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Password reset successful. Please sign in with your new password.",
    });
  } catch (error) {
    return internalError(
      res,
      "resetPassword",
      error,
      "Something went wrong while resetting the password. Please try again.",
    );
  }
}

// 6-digit code flow for the mobile apps. `allowedRoles` scopes each mount:
// /api/auth/email/* is CUSTOMER only, /api/employee/auth/email/* STAFF only.
// Any other account gets the same generic answer and no email.
export function makeForgotPasswordCodeController(allowedRoles: Role[]) {
  return async (req: Request, res: Response) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: firstIssueMessage(parsed.error),
          errors: parsed.error.flatten(),
        });
      }

      const result = await requestPasswordResetCode(
        parsed.data.email,
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
        message: GENERIC_CODE_SENT_MESSAGE,
        expiresInMinutes: RESET_CODE_EXPIRY_MINUTES,
        resendAfterSeconds: RESET_CODE_RESEND_SECONDS,
      });
    } catch (error) {
      return internalError(
        res,
        "forgotPasswordCode",
        error,
        "Internal error while processing the password reset request",
      );
    }
  };
}

export function makeResetPasswordCodeController(allowedRoles: Role[]) {
  return async (req: Request, res: Response) => {
    try {
      const parsed = resetPasswordWithOtpSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: firstIssueMessage(parsed.error),
          errors: parsed.error.flatten(),
        });
      }

      const result = await resetPasswordWithCode(
        parsed.data.email,
        parsed.data.otp,
        parsed.data.password,
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
      });
    } catch (error) {
      return internalError(
        res,
        "resetPasswordCode",
        error,
        "Internal error while resetting the password",
      );
    }
  };
}
