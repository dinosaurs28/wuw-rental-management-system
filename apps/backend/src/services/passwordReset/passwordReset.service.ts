import crypto from "crypto";
import { prisma, AuthProvider, Role } from "@repo/database/client";
import { hashpassword } from "../../utils/PasswordCrypt/password.js";
import { rateLimit } from "../../utils/rateLimiter.js";
import { auditService, AuditCategory, AuditSeverity } from "../audit/audit.service.js";
import { sendMail } from "../email/mailer.js";
import { generatePasswordResetEmailTemplate } from "../email/passwordResetTemplate.js";

export type PortalPath = "auth" | "employee" | "branchManager" | "admin";

const RESET_TOKEN_EXPIRY_MINUTES = Number(
  process.env.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES,
) || 30;

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Fails open: if the rate limiter itself is unavailable (e.g. Redis down),
// we don't want that to take down the entire password reset flow..
export async function safeRateLimit(
  key: string,
  limit: number,
  ttl: number,
): Promise<boolean> {
  try {
    return await rateLimit(key, limit, ttl);
  } catch (error) {
    console.error(`Rate limiter unavailable for key ${key}:`, error);
    return true;
  }
}

export async function requestPasswordReset(
  email: string,
  portalPath: PortalPath,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  const ipLimitOk = ip
    ? await safeRateLimit(`pwreset:req:ip:${ip}`, 5, 3600)
    : true;
  const emailLimitOk = await safeRateLimit(
    `pwreset:req:email:${normalizedEmail}`,
    3,
    3600,
  );

  if (!ipLimitOk || !emailLimitOk) {
    auditService.log({
      actorName: "Unknown",
      actorRole: Role.CUSTOMER,
      action: "PASSWORD_RESET_REQUESTED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset request rate-limited for ${normalizedEmail}`,
      entity: "User",
      entityId: "unknown",
      ipAddress: ip,
      userAgent,
      metadata: { attemptedEmail: normalizedEmail, portalPath },
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user || user.authProvider !== AuthProvider.PASSWORD || !user.isActive) {
    auditService.log({
      actorName: "Unknown",
      actorRole: Role.CUSTOMER,
      action: "PASSWORD_RESET_REQUESTED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset requested for unresettable account: ${normalizedEmail}`,
      entity: "User",
      entityId: user?.publicId ?? "unknown",
      ipAddress: ip,
      userAgent,
      metadata: { attemptedEmail: normalizedEmail, portalPath },
    });
    return;
  }

  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    data: { used: true },
  });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60_000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt, requestIp: ip },
  });

  const resetLink = `${process.env.FRONTEND_REDIRECT_URL}/${portalPath === "auth" ? "auth" : portalPath === "branchManager" ? "branch-manager" : portalPath}/reset-password/${rawToken}`;

  try {
    await sendMail({
      to: user.email,
      subject: "Reset your password",
      html: generatePasswordResetEmailTemplate({
        userName: user.name,
        resetLink,
        expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
      }),
    });
  } catch (error) {
    console.error("Failed to send password reset email:", error);
  }

  auditService.log({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: "PASSWORD_RESET_REQUESTED",
    category: AuditCategory.AUTH,
    description: `Password reset requested for ${user.email}`,
    entity: "User",
    entityId: user.publicId,
    ipAddress: ip,
    userAgent,
    metadata: { portalPath },
  });
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  ip?: string,
  userAgent?: string,
): Promise<
  { ok: true } | { ok: false; reason: "INVALID_TOKEN" | "EXPIRED_TOKEN" | "USED_TOKEN" }
> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findFirst({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) {
    auditService.log({
      actorName: "Unknown",
      actorRole: Role.CUSTOMER,
      action: "PASSWORD_RESET_FAILED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: "Password reset attempted with an invalid token",
      entity: "User",
      entityId: "unknown",
      ipAddress: ip,
      userAgent,
    });
    return { ok: false, reason: "INVALID_TOKEN" };
  }

  if (record.used) {
    auditService.log({
      actorId: record.userId,
      actorName: record.user.name,
      actorRole: record.user.role,
      action: "PASSWORD_RESET_FAILED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset attempted with an already-used token for ${record.user.email}`,
      entity: "User",
      entityId: record.user.publicId,
      ipAddress: ip,
      userAgent,
    });
    return { ok: false, reason: "USED_TOKEN" };
  }

  if (record.expiresAt < new Date()) {
    auditService.log({
      actorId: record.userId,
      actorName: record.user.name,
      actorRole: record.user.role,
      action: "PASSWORD_RESET_FAILED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset attempted with an expired token for ${record.user.email}`,
      entity: "User",
      entityId: record.user.publicId,
      ipAddress: ip,
      userAgent,
    });
    return { ok: false, reason: "EXPIRED_TOKEN" };
  }

  const passwordHash = await hashpassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used: true, usedAt: new Date() },
    }),
  ]);

  auditService.log({
    actorId: record.userId,
    actorName: record.user.name,
    actorRole: record.user.role,
    action: "PASSWORD_RESET_COMPLETED",
    category: AuditCategory.AUTH,
    description: `Password reset completed for ${record.user.email}`,
    entity: "User",
    entityId: record.user.publicId,
    ipAddress: ip,
    userAgent,
  });

  return { ok: true };
}
