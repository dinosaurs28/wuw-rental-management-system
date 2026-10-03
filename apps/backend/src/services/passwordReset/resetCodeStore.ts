import crypto from "crypto";
import { redis } from "../../lib/redisconfig.js";
import { rateLimit } from "../../utils/rateLimiter.js";

// ── Password reset codes (emailed or SMS) ───────────────────────────────────
// Reset codes live in Redis under their own key, never in EmailVerificationOtp:
// sign-up phone verification (POST /auth/email/verify-otp) and the walk-in OTP
// write that table, so a code from either of them must never pass as a
// password reset code. One live code per account across both channels: a new
// emailed or SMS code replaces the previous one.

export type ResetCodeChannel = "EMAIL" | "SMS";

export type LiveResetCode = {
  /** Random per-code id: claims and wrong-guess counters are keyed by it. */
  id: string;
  hash: string;
  channel: ResetCodeChannel;
  /** Where the code was sent (the account's email or its 10-digit phone). */
  sentTo: string;
  expiresAt: number;
};

const codeKey = (userId: number) => `pwreset:code:v2:${userId}`;
const wrongKey = (codeId: string) => `pwreset:code:v2:wrong:${codeId}`;

// Deletes the code only if it is still the one identified by ARGV[1], so a
// stale claim or wrong-guess limit never removes a newer code.
const DELETE_IF_SAME_CODE = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, value = pcall(cjson.decode, raw)
if ok and type(value) == "table" and value.id == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

export async function storeResetCode(
  userId: number,
  input: { hash: string; channel: ResetCodeChannel; sentTo: string },
  ttlSeconds: number,
): Promise<void> {
  const record: LiveResetCode = {
    id: crypto.randomBytes(12).toString("hex"),
    hash: input.hash,
    channel: input.channel,
    sentTo: input.sentTo,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  await redis.set(codeKey(userId), JSON.stringify(record), "EX", ttlSeconds);
}

/** The account's live reset code, or null (none, expired or unreadable). */
export async function getLiveResetCode(userId: number): Promise<LiveResetCode | null> {
  const raw = await redis.get(codeKey(userId));
  if (!raw) return null;
  let record: Partial<LiveResetCode>;
  try {
    record = JSON.parse(raw) as Partial<LiveResetCode>;
  } catch {
    return null;
  }
  if (
    typeof record.id !== "string" ||
    typeof record.hash !== "string" ||
    (record.channel !== "EMAIL" && record.channel !== "SMS") ||
    typeof record.sentTo !== "string" ||
    typeof record.expiresAt !== "number" ||
    record.expiresAt <= Date.now()
  ) {
    return null;
  }
  return record as LiveResetCode;
}

/**
 * Consumes the code. Of two simultaneous submissions only the one that
 * actually removed it may go on to change the password.
 */
export async function claimResetCode(userId: number, codeId: string): Promise<boolean> {
  const removed = await redis.eval(DELETE_IF_SAME_CODE, 1, codeKey(userId), codeId);
  return Number(removed) === 1;
}

/** Kills any live reset code of the account (e.g. after a link reset). */
export async function discardResetCode(userId: number): Promise<void> {
  await redis.del(codeKey(userId));
}

/**
 * Counts a wrong guess against a live code; after `maxWrongAttempts` the code
 * is discarded and a new one must be requested. Never throws.
 */
export async function registerWrongResetCodeGuess(
  userId: number,
  codeId: string,
  maxWrongAttempts: number,
  ttlSeconds: number,
): Promise<void> {
  try {
    const withinLimit = await rateLimit(wrongKey(codeId), maxWrongAttempts - 1, ttlSeconds);
    if (!withinLimit) {
      await redis.eval(DELETE_IF_SAME_CODE, 1, codeKey(userId), codeId);
    }
  } catch (error) {
    console.error("Failed to record a wrong password reset code:", error);
  }
}
