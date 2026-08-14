import { Request, Response } from "express";
import { forgotPasswordSchema, resetPasswordSchema } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { requestPasswordReset, resetPassword, safeRateLimit, PortalPath } from "./passwordReset.service.js";

export function makeForgotPasswordController(portalPath: PortalPath) {
  return async (req: Request, res: Response) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid Inputs",
        error: parsed.error,
      });
    }

    await requestPasswordReset(
      parsed.data.email,
      portalPath,
      req.ip,
      req.headers["user-agent"] as string,
    );

    return res.status(StatusCode.OK).json({
      message: "If that email is registered, a reset link has been sent.",
    });
  };
}

export async function resetPasswordController(req: Request, res: Response) {
  if (req.ip) {
    const allowed = await safeRateLimit(`pwreset:confirm:ip:${req.ip}`, 10, 3600);
    if (!allowed) {
      return res.status(StatusCode.TOO_MANY_REQUESTS).json({
        message: "Too many attempts. Please try again later.",
      });
    }
  }

  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid Inputs",
      error: parsed.error,
    });
  }

  const result = await resetPassword(
    parsed.data.token,
    parsed.data.password,
    req.ip,
    req.headers["user-agent"] as string,
  );

  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      INVALID_TOKEN: "This reset link is invalid.",
      EXPIRED_TOKEN: "This reset link has expired. Please request a new one.",
      USED_TOKEN: "This reset link has already been used.",
    };
    return res.status(StatusCode.BAD_REQUEST).json({
      message: messages[result.reason],
    });
  }

  return res.status(StatusCode.OK).json({
    message: "Password reset successful. Please sign in with your new password.",
  });
}
