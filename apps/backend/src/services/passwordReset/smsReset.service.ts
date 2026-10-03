import crypto from "crypto";
import { prisma, Role } from "@repo/database/client";
import { isPlaceholderEmail } from "@repo/schemas";
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
  canResetPassword,
  logAudit,
  registerWrongResetCode,
  RESET_CODE_RESEND_SECONDS,
  resetCodeStillAddressed,
  safeRateLimit,
  saveResetCode,
  spendCompareTime,
} from "./passwordReset.service.js";
import { claimResetCode, getLiveResetCode } from "./resetCodeStore.js";

// ── Password reset by SMS code (all four roles) ─────────────────────────────
// Production has no SMTP, so emailed links/codes never arrive. This path sends
// the 6-digit code through the MSG91 OTP API that phone verification uses, to
// the phone ON THE ACCOUNT — the account is found by its phone or its email.
//
// The code is stored exactly like the emailed reset code (resetCodeStore.ts:
// Redis, one live code per user, bcrypt hash, 10 minutes), so the newest code
// of either channel is the only one that works and a link reset kills it too.
// It is never stored in EmailVerificationOtp, so a sign-up phone-verification
// or walk-in OTP can't pass as a reset code.

export type ResetIdentifier =
  | { kind: "phone"; phone: string }
  | { kind: "email"; email: string };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A mobile number (any common Indian spelling) or an email address. */
export function parseResetIdentifier(raw: unknown): ResetIdentifier | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 254) return null;
  if (value.includes("@")) {
    return EMAIL_SHAPE.test(value) ? { kind: "email", email: value.toLowerCase() } : null;
  }
  const phone = normalizeIndianMobile(value);
  return phone ? { kind: "phone", phone } : null;
}

function describe(identifier: ResetIdentifier): string {
  return identifier.kind === "phone" ? maskIndianMobile(identifier.phone) : identifier.email;
}

function limiterKey(identifier: ResetIdentifier): string {
  return identifier.kind === "phone" ? `phone:${identifier.phone}` : `email:${identifier.email}`;
}

type ResettableUser = {
  id: number;
  publicId: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  emailVerifiedAt: Date | null;
};

type Resolution =
  | { user: ResettableUser; mobile: string }
  | { user: null; reason: "NO_ACCOUNT" | "AMBIGUOUS_PHONE" | "NO_PHONE"; userRef?: ResettableUser };

const USER_FIELDS = {
  id: true,
  publicId: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  emailVerifiedAt: true,
  isActive: true,
  deletedAt: true,
} as const;

// Walk-in placeholder accounts have no real email, so they can't sign in even
// with a new password: they are never reset this way. A customer must be
// verified: an unverified customer's phone was never proven (e.g. one typed
// at an abandoned sign-up OTP step), so it must not receive reset codes.
function isEligible(
  user: {
    role: Role;
    email: string;
    isActive: boolean;
    deletedAt: Date | null;
    emailVerifiedAt: Date | null;
  },
  allowedRoles: Role[],
): boolean {
  return (
    allowedRoles.includes(user.role) &&
    canResetPassword(user) &&
    !isPlaceholderEmail(user.email) &&
    (user.role !== Role.CUSTOMER || user.emailVerifiedAt !== null)
  );
}

/**
 * Finds the one account of the allowed roles that the identifier names, and the
 * mobile number the code goes to. Phones are not unique: a number shared by
 * more than one eligible account of the role resolves to none (email works).
 */
async function resolveAccount(
  identifier: ResetIdentifier,
  allowedRoles: Role[],
): Promise<Resolution> {
  if (identifier.kind === "email") {
    const user = await prisma.user.findUnique({
      where: { email: identifier.email },
      select: USER_FIELDS,
    });
    if (!user || !isEligible(user, allowedRoles)) return { user: null, reason: "NO_ACCOUNT" };
    const mobile = normalizeIndianMobile(user.phone);
    if (!mobile) return { user: null, reason: "NO_PHONE", userRef: user };
    return { user, mobile };
  }

  const candidates = await prisma.user.findMany({
    where: {
      phone: { in: indianMobileLookupVariants(identifier.phone) },
      role: { in: allowedRoles },
      isActive: true,
      deletedAt: null,
    },
    select: USER_FIELDS,
    take: 10,
  });
  const eligible = candidates.filter((user) => isEligible(user, allowedRoles));
  if (eligible.length === 0) return { user: null, reason: "NO_ACCOUNT" };
  if (eligible.length > 1) return { user: null, reason: "AMBIGUOUS_PHONE" };
  return { user: eligible[0]!, mobile: identifier.phone };
}

const UNRESOLVED_DESCRIPTION: Record<"NO_ACCOUNT" | "AMBIGUOUS_PHONE" | "NO_PHONE", string> = {
  NO_ACCOUNT: "no resettable account",
  AMBIGUOUS_PHONE: "the number belongs to more than one account",
  NO_PHONE: "the account has no valid mobile number",
};

export async function requestPasswordResetSms(
  identifier: ResetIdentifier,
  allowedRoles: Role[],
  ip?: string,
  userAgent?: string,
): Promise<{ ok: true } | { ok: false; reason: "RATE_LIMITED" }> {
  const flowMeta = { flow: "sms", allowedRoles, identifiedBy: identifier.kind };

  // The IP throttle is the only limit that answers 429: it applies whether or
  // not an account matches, so it reveals nothing.
  if (ip) {
    const ipAllowed = await safeRateLimit(`pwreset:sms:req:ip:${ip}`, 10, 3600);
    if (!ipAllowed) return { ok: false, reason: "RATE_LIMITED" };
  }

  const resolved = await resolveAccount(identifier, allowedRoles);

  if (!resolved.user) {
    const ref = resolved.userRef;
    logAudit({
      actorId: ref?.id,
      actorName: ref?.name ?? "Unknown",
      actorRole: ref?.role ?? allowedRoles[0] ?? Role.CUSTOMER,
      action: "PASSWORD_RESET_REQUESTED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset SMS not sent for ${describe(identifier)}: ${UNRESOLVED_DESCRIPTION[resolved.reason]}`,
      entity: "User",
      entityId: ref?.publicId ?? "unknown",
      ipAddress: ip,
      userAgent,
      metadata: { ...flowMeta, reason: resolved.reason },
    });
    return { ok: true };
  }

  // Limiter round-trips, bcrypt, the DB write and the MSG91 call happen only
  // for real accounts, so they run after the response: the reply time then
  // reveals nothing about whether the identifier matched.
  const { user, mobile } = resolved;
  void issueSmsResetCode(user, mobile, flowMeta, ip, userAgent).catch((error) => {
    console.error("Failed to issue a password reset SMS code:", error);
  });

  return { ok: true };
}

async function issueSmsResetCode(
  user: ResettableUser,
  mobile: string,
  flowMeta: Record<string, unknown>,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  // MSG91 not set up: send nothing and store nothing — saving an undeliverable
  // code would replace the account's live emailed code (one code per account).
  if (!isSmsConfigured()) {
    logAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: "PASSWORD_RESET_REQUESTED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset SMS not sent for ${user.email}: SMS is not configured on the server`,
      entity: "User",
      entityId: user.publicId,
      ipAddress: ip,
      userAgent,
      metadata: { ...flowMeta, reason: "SMS_NOT_CONFIGURED" },
    });
    return;
  }

  // Silent per-account limits (generic 200), so they can't be used to probe for
  // accounts. SMS costs money: a daily cap on top of the email-code limits.
  const minuteAllowed = await safeRateLimit(
    `pwreset_sms_send_1min:${user.id}`,
    1,
    RESET_CODE_RESEND_SECONDS,
  );
  const hourAllowed =
    minuteAllowed && (await safeRateLimit(`pwreset_sms_send_hour:${user.id}`, 5, 3600));
  const dayAllowed =
    hourAllowed && (await safeRateLimit(`pwreset_sms_send_day:${user.id}`, 10, 86400));
  if (!dayAllowed) {
    logAudit({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: "PASSWORD_RESET_REQUESTED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Password reset SMS request rate-limited for ${user.email}`,
      entity: "User",
      entityId: user.publicId,
      ipAddress: ip,
      userAgent,
      metadata: flowMeta,
    });
    return;
  }

  const code = crypto.randomInt(100000, 1000000);
  await saveResetCode(user.id, String(code), "SMS", mobile);

  const result = await sendOTP({
    mobile: toMsg91Mobile(mobile),
    otp: code,
    templateId: process.env.MSG91_PASSWORD_RESET_TEMPLATE_ID?.trim() || undefined,
  });

  logAudit({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: "PASSWORD_RESET_REQUESTED",
    category: AuditCategory.AUTH,
    severity: result.success ? AuditSeverity.INFO : AuditSeverity.WARNING,
    description: `Password reset SMS code ${result.success ? "sent" : "FAILED to send"} to ${maskIndianMobile(mobile)} for ${user.email}`,
    entity: "User",
    entityId: user.publicId,
    ipAddress: ip,
    userAgent,
    metadata: {
      ...flowMeta,
      ...(result.success ? {} : { providerMessage: result.message, providerError: result.error }),
    },
  });
}

export async function resetPasswordWithSmsCode(
  identifier: ResetIdentifier,
  code: string,
  newPassword: string,
  allowedRoles: Role[],
  ip?: string,
  userAgent?: string,
): Promise<
  | { ok: true; signInEmail: string }
  | { ok: false; reason: "INVALID_CODE" | "RATE_LIMITED" }
> {
  const flowMeta = { flow: "sms", allowedRoles, identifiedBy: identifier.kind };

  // Throttle before the lookup so a 429 means the same for every identifier.
  // Strict limiter: a 6-digit code must never become guessable because Redis
  // is down (a limiter error is a 500 from the handler, not an open door).
  if (ip) {
    const ipAllowed = await rateLimit(`pwreset:sms:verify:ip:${ip}`, 30, 3600);
    if (!ipAllowed) return { ok: false, reason: "RATE_LIMITED" };
  }
  const identifierAllowed = await rateLimit(
    `pwreset:sms:verify:id:${limiterKey(identifier)}`,
    5,
    3600,
  );
  if (!identifierAllowed) return { ok: false, reason: "RATE_LIMITED" };

  const resolved = await resolveAccount(identifier, allowedRoles);
  const user = resolved.user;
  const stored = user ? await getLiveResetCode(user.id) : null;
  const record = stored && user && resetCodeStillAddressed(stored, user) ? stored : null;
  const live = !!record;

  let matches = false;
  if (live) {
    matches = await comparehash(code, record!.hash);
  } else {
    await spendCompareTime(code);
  }

  if (!user || !matches) {
    if (live) await registerWrongResetCode(user!.id, record!.id);
    const unresolved = resolved.user ? null : resolved;
    const ref = user ?? unresolved?.userRef ?? null;
    logAudit({
      actorId: ref?.id,
      actorName: ref?.name ?? "Unknown",
      actorRole: ref?.role ?? allowedRoles[0] ?? Role.CUSTOMER,
      action: "PASSWORD_RESET_FAILED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: unresolved
        ? `Password reset SMS code submitted for ${describe(identifier)}: ${UNRESOLVED_DESCRIPTION[unresolved.reason]}`
        : !live
          ? `Password reset attempted with a missing or expired SMS code for ${ref?.email}`
          : `Password reset attempted with a wrong SMS code for ${ref?.email}`,
      entity: "User",
      entityId: ref?.publicId ?? "unknown",
      ipAddress: ip,
      userAgent,
      metadata: flowMeta,
    });
    return { ok: false, reason: "INVALID_CODE" };
  }

  const passwordHash = await hashpassword(newPassword);
  const now = new Date();

  // Deleting the code is the claim: of two simultaneous submissions only the
  // one that actually removed it goes on to change the password.
  const claimed = await claimResetCode(user.id, record!.id);
  if (!claimed) return { ok: false, reason: "INVALID_CODE" };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Same meaning as phone OTP verification: the account is verified.
        emailVerifiedAt: user.emailVerifiedAt ?? now,
      },
    });
    // An emailed link requested earlier must not work after this reset.
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });
  });

  logAudit({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: "PASSWORD_RESET_COMPLETED",
    category: AuditCategory.AUTH,
    severity: AuditSeverity.WARNING,
    description: `Password reset completed with an SMS code for ${user.email}`,
    entity: "User",
    entityId: user.publicId,
    ipAddress: ip,
    userAgent,
    metadata: flowMeta,
  });

  return { ok: true, signInEmail: user.email };
}
