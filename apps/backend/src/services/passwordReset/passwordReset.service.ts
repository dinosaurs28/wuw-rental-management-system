import crypto from "crypto";
import { prisma, Role } from "@repo/database/client";
import { comparehash, hashpassword } from "../../utils/PasswordCrypt/password.js";
import { rateLimit } from "../../utils/rateLimiter.js";
import { auditService, AuditCategory, AuditSeverity } from "../audit/audit.service.js";
import { sendMail } from "../email/mailer.js";
import {
  generatePasswordResetCodeEmailTemplate,
  generatePasswordResetEmailTemplate,
} from "../email/passwordResetTemplate.js";

export type PortalPath = "auth" | "employee" | "branchManager" | "admin";

const RESET_TOKEN_EXPIRY_MINUTES = Number(
  process.env.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES,
) || 30;

// Mobile reset codes (6 digits, emailed). One live code per user: a new
// request replaces the previous one.
export const RESET_CODE_EXPIRY_MINUTES = 10;
export const RESET_CODE_RESEND_SECONDS = 60;

// The emailed link opens the reset page of the portal that accepts the
// account's role, whichever forgot form was used. Otherwise a Fleet Executive
// using the customer form would land on a sign-in page that rejects them.
const RESET_PORTAL_BY_ROLE: Record<Role, string> = {
  [Role.CUSTOMER]: "auth",
  [Role.STAFF]: "employee",
  [Role.MANAGER]: "branch-manager",
  [Role.ADMIN]: "admin",
};

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Who may reset: any active, non-deleted account. Google sign-ups are included
// on purpose: proving control of the inbox lets them set a password (the
// mobile code flow always allowed it; authProvider is left unchanged).
function canResetPassword(user: { isActive: boolean; deletedAt: Date | null }): boolean {
  return user.isActive && !user.deletedAt;
}

// Audit writes are fire-and-forget here; a failed insert must never surface as
// an unhandled rejection (Express 4 does not catch them and Node exits).
function logAudit(input: Parameters<typeof auditService.log>[0]): void {
  auditService.log(input).catch((error) => {
    console.error("Failed to write password reset audit log:", error);
  });
}

// Sending is not awaited by the request handlers: a slow SMTP round-trip only
// for registered addresses would reveal which emails have accounts.
function deliverResetEmail(params: {
  to: string;
  subject: string;
  html: string;
  audit: { userId: number; userName: string; role: Role; publicId: string; what: string };
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): void {
  const { audit } = params;
  sendMail({ to: params.to, subject: params.subject, html: params.html })
    .then(() => true)
    .catch((error) => {
      console.error(`Failed to send ${audit.what} email:`, error);
      return false;
    })
    .then((sent) => {
      logAudit({
        actorId: audit.userId,
        actorName: audit.userName,
        actorRole: audit.role,
        action: "PASSWORD_RESET_REQUESTED",
        category: AuditCategory.AUTH,
        severity: sent ? AuditSeverity.INFO : AuditSeverity.WARNING,
        description: `Password reset ${audit.what} ${sent ? "sent" : "FAILED to send"} for ${params.to}`,
        entity: "User",
        entityId: audit.publicId,
        ipAddress: params.ip,
        userAgent: params.userAgent,
        metadata: params.metadata,
      });
    });
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
    ? await safeRateLimit(`pwreset:req:ip:${ip}`, 10, 3600)
    : true;
  const emailLimitOk = await safeRateLimit(
    `pwreset:req:email:${normalizedEmail}`,
    3,
    3600,
  );

  if (!ipLimitOk || !emailLimitOk) {
    logAudit({
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

  if (!user || !canResetPassword(user)) {
    logAudit({
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

  // The token write and the email happen only for real accounts, so they run
  // after the response: the reply time then reveals nothing about the address.
  void issueResetLink(user, portalPath, ip, userAgent).catch((error) => {
    console.error("Failed to issue a password reset link:", error);
  });
}

async function issueResetLink(
  user: { id: number; name: string; email: string; role: Role; publicId: string },
  portalPath: PortalPath,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60_000);

  // Only the newest link works: retire the older ones in the same transaction.
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
      data: { used: true },
    }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt, requestIp: ip },
    }),
  ]);

  const linkPortal = RESET_PORTAL_BY_ROLE[user.role];
  const resetLink = `${process.env.FRONTEND_REDIRECT_URL}/${linkPortal}/reset-password/${rawToken}`;

  deliverResetEmail({
    to: user.email,
    subject: "Reset your password",
    html: generatePasswordResetEmailTemplate({
      userName: user.name,
      resetLink,
      expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
    }),
    audit: {
      userId: user.id,
      userName: user.name,
      role: user.role,
      publicId: user.publicId,
      what: "link",
    },
    ip,
    userAgent,
    metadata: { portalPath, linkPortal },
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
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  // A link issued before the account was deactivated or deleted is dead too.
  if (!record || !canResetPassword(record.user)) {
    logAudit({
      actorName: "Unknown",
      actorRole: Role.CUSTOMER,
      action: "PASSWORD_RESET_FAILED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: record
        ? `Password reset attempted for an inactive or deleted account: ${record.user.email}`
        : "Password reset attempted with an invalid token",
      entity: "User",
      entityId: record?.user.publicId ?? "unknown",
      ipAddress: ip,
      userAgent,
    });
    return { ok: false, reason: "INVALID_TOKEN" };
  }

  if (record.used) {
    logAudit({
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
    logAudit({
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
  const now = new Date();

  // Claim the token with a conditional update so two simultaneous submissions
  // of the same link can't both succeed.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: record.id, used: false },
      data: { used: true, usedAt: now },
    });
    if (claim.count === 0) return false;

    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // Opening the emailed link proves control of the inbox.
        emailVerifiedAt: record.user.emailVerifiedAt ?? now,
      },
    });
    // Any other outstanding link or app reset code dies with this reset. The
    // email is verified now, so a pending signup code is moot as well.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, used: false },
      data: { used: true },
    });
    await tx.emailVerificationOtp.deleteMany({ where: { userId: record.userId } });
    return true;
  });

  if (!claimed) {
    return { ok: false, reason: "USED_TOKEN" };
  }

  logAudit({
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

// ── 6-digit code flow (mobile apps) ─────────────────────────────────────────
// The code lives in the EmailVerificationOtp table (one row per user, unique
// userId), shared with signup verification: both delete-then-create for the
// user, and a successful reset also verifies the email, so they never clash.

let timingDecoyHash: Promise<string> | null = null;

// Compares against a throwaway hash so an unknown email costs the same bcrypt
// time as a known one with a wrong code.
async function spendCompareTime(code: string): Promise<void> {
  timingDecoyHash ??= hashpassword(crypto.randomBytes(16).toString("hex"));
  await comparehash(code, await timingDecoyHash);
}

export async function requestPasswordResetCode(
  email: string,
  allowedRoles: Role[],
  ip?: string,
  userAgent?: string,
): Promise<{ ok: true } | { ok: false; reason: "RATE_LIMITED" }> {
  const normalizedEmail = email.toLowerCase().trim();
  const flowMeta = { flow: "code", allowedRoles };

  // The IP throttle is the only limit that answers 429: it applies whether or
  // not the account exists, so it reveals nothing about the address.
  if (ip) {
    const ipAllowed = await safeRateLimit(`pwreset:code:req:ip:${ip}`, 10, 3600);
    if (!ipAllowed) {
      return { ok: false, reason: "RATE_LIMITED" };
    }
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user || !allowedRoles.includes(user.role) || !canResetPassword(user)) {
    logAudit({
      actorName: "Unknown",
      actorRole: allowedRoles[0] ?? Role.CUSTOMER,
      action: "PASSWORD_RESET_REQUESTED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset code requested for unresettable account: ${normalizedEmail}`,
      entity: "User",
      entityId: user?.publicId ?? "unknown",
      ipAddress: ip,
      userAgent,
      metadata: { attemptedEmail: normalizedEmail, ...flowMeta },
    });
    return { ok: true };
  }

  // Everything below (limiter round-trips, bcrypt, DB writes, SMTP) happens only
  // for real accounts, so it runs after the response: both paths then answer
  // right after the lookup and the reply time reveals nothing about the address.
  void issueResetCode(user, flowMeta, ip, userAgent).catch((error) => {
    console.error("Failed to issue a password reset code:", error);
  });

  return { ok: true };
}

async function issueResetCode(
  user: { id: number; name: string; email: string; phone: string | null; role: Role; publicId: string },
  flowMeta: Record<string, unknown>,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  // Per-account send limits are silent (generic 200) so they can't be used to
  // probe for accounts. The app enforces the same 60 s resend cooldown.
  const minuteAllowed = await safeRateLimit(
    `pwreset_send_1min:${user.id}`,
    1,
    RESET_CODE_RESEND_SECONDS,
  );
  const hourAllowed =
    minuteAllowed && (await safeRateLimit(`pwreset_send_hour:${user.id}`, 5, 3600));
  if (!minuteAllowed || !hourAllowed) {
    logAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: "PASSWORD_RESET_REQUESTED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset code request rate-limited for ${user.email}`,
      entity: "User",
      entityId: user.publicId,
      ipAddress: ip,
      userAgent,
      metadata: flowMeta,
    });
    return;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const otpHash = await hashpassword(code);

  await prisma.$transaction([
    prisma.emailVerificationOtp.deleteMany({ where: { userId: user.id } }),
    prisma.emailVerificationOtp.create({
      data: {
        userId: user.id,
        phone: user.phone ?? "",
        otpHash,
        expiresAt: new Date(Date.now() + RESET_CODE_EXPIRY_MINUTES * 60_000),
      },
    }),
  ]);

  deliverResetEmail({
    to: user.email,
    subject: "Your WUW Rentals password reset code",
    html: generatePasswordResetCodeEmailTemplate({
      userName: user.name,
      code,
      expiryMinutes: RESET_CODE_EXPIRY_MINUTES,
    }),
    audit: {
      userId: user.id,
      userName: user.name,
      role: user.role,
      publicId: user.publicId,
      what: "code",
    },
    ip,
    userAgent,
    metadata: flowMeta,
  });
}

export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string,
  allowedRoles: Role[],
  ip?: string,
  userAgent?: string,
): Promise<{ ok: true } | { ok: false; reason: "INVALID_CODE" | "RATE_LIMITED" }> {
  const normalizedEmail = email.toLowerCase().trim();
  const flowMeta = { flow: "code", allowedRoles };

  // Throttle before the account lookup so a 429 means the same thing for
  // registered and unknown addresses. These use the strict limiter: a 6-digit
  // code must never be guessable because Redis is down (a limiter error is a
  // 500 from the handler, not an open door).
  if (ip) {
    const ipAllowed = await rateLimit(`pwreset:code:verify:ip:${ip}`, 30, 3600);
    if (!ipAllowed) return { ok: false, reason: "RATE_LIMITED" };
  }
  const emailAllowed = await rateLimit(
    `pwreset:code:verify:email:${normalizedEmail}`,
    5,
    3600,
  );
  if (!emailAllowed) return { ok: false, reason: "RATE_LIMITED" };

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const eligible = !!user && allowedRoles.includes(user.role) && canResetPassword(user);
  const record = eligible
    ? await prisma.emailVerificationOtp.findUnique({ where: { userId: user!.id } })
    : null;
  const live = !!record && !record.used && record.expiresAt > new Date();

  let matches = false;
  if (live) {
    matches = await comparehash(code, record!.otpHash);
  } else {
    await spendCompareTime(code);
  }

  if (!user || !eligible || !matches) {
    logAudit({
      actorId: user?.id,
      actorName: user?.name ?? "Unknown",
      actorRole: user?.role ?? allowedRoles[0] ?? Role.CUSTOMER,
      action: "PASSWORD_RESET_FAILED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: !eligible
        ? `Password reset code submitted for unresettable account: ${normalizedEmail}`
        : !live
          ? `Password reset attempted with a missing or expired code for ${normalizedEmail}`
          : `Password reset attempted with a wrong code for ${normalizedEmail}`,
      entity: "User",
      entityId: user?.publicId ?? "unknown",
      ipAddress: ip,
      userAgent,
      metadata: { attemptedEmail: normalizedEmail, ...flowMeta },
    });
    return { ok: false, reason: "INVALID_CODE" };
  }

  const passwordHash = await hashpassword(newPassword);
  const now = new Date();

  // Deleting the code is the claim: of two simultaneous submissions only the
  // one that actually removed the row goes on to change the password.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.emailVerificationOtp.deleteMany({
      where: { id: record!.id },
    });
    if (claim.count === 0) return false;

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Proving control of the inbox also verifies the email.
        emailVerifiedAt: user.emailVerifiedAt ?? now,
      },
    });
    // An emailed web link requested earlier must not work after this reset.
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });
    return true;
  });

  if (!claimed) {
    return { ok: false, reason: "INVALID_CODE" };
  }

  logAudit({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: "PASSWORD_RESET_COMPLETED",
    category: AuditCategory.AUTH,
    severity: AuditSeverity.WARNING,
    description: `Password reset completed with an emailed code for ${user.email}`,
    entity: "User",
    entityId: user.publicId,
    ipAddress: ip,
    userAgent,
    metadata: flowMeta,
  });

  return { ok: true };
}
