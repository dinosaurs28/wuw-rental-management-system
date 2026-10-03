/**
 * Customer blacklist (Oct 3 batch, item 13).
 *
 * A Branch Manager can blacklist any registered customer (a reason is
 * required) and remove the blacklist again; both actions are audit-logged
 * (AuditLog CUSTOMER_BLACKLISTED / CUSTOMER_BLACKLIST_REMOVED + staff activity).
 * The flag is global: it applies at every branch.
 *
 * A blacklisted customer can't create new bookings — online
 * (POST /api/public/vehicles/booking) or at the counter
 * (POST /api/employee/booking/create): 403 CUSTOMER_BLACKLISTED. The customer
 * gets a neutral message that never states the reason; staff get the reason.
 * Bookings made before the blacklist are left as they are.
 */
import { prisma } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const CUSTOMER_BLACKLISTED = "CUSTOMER_BLACKLISTED" as const;

/** What the customer reads (never the reason). */
export const CUSTOMER_BLACKLISTED_MESSAGE =
  "This account can't make new bookings right now. Please contact the branch.";

/** Blacklist reason length limits (trimmed). */
export const BLACKLIST_REASON_MIN = 3;
export const BLACKLIST_REASON_MAX = 500;

/** AuditLog.action values written by the BM Customers tab. */
export const AUDIT_CUSTOMER_BLACKLISTED = "CUSTOMER_BLACKLISTED";
export const AUDIT_CUSTOMER_BLACKLIST_REMOVED = "CUSTOMER_BLACKLIST_REMOVED";

/** Who reads the refusal: customers never see the reason. */
export type BlacklistAudience = "customer" | "staff";

export interface BlacklistFields {
  isBlacklisted: boolean;
  blacklistReason: string | null;
  blacklistedAt: Date | null;
}

export class CustomerBlacklistedError extends Error {
  readonly code = CUSTOMER_BLACKLISTED;
  readonly status = StatusCode.FORBIDDEN;

  constructor(
    public readonly audience: BlacklistAudience,
    public readonly reason: string | null,
    public readonly blacklistedAt: Date | null,
  ) {
    super(
      audience === "customer"
        ? CUSTOMER_BLACKLISTED_MESSAGE
        : `This customer is blacklisted and can't make new bookings${
            reason ? ` (reason: ${reason})` : ""
          }. A branch manager can remove the blacklist from the Customers tab.`,
    );
    this.name = "CustomerBlacklistedError";
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      message: this.message,
      ...(this.audience === "staff"
        ? {
            blacklistReason: this.reason,
            blacklistedAt: this.blacklistedAt ? this.blacklistedAt.toISOString() : null,
          }
        : {}),
    };
  }
}

/** The refusal for a customer row, or null when they may book. */
export function blacklistRefusal(
  customer: BlacklistFields | null | undefined,
  audience: BlacklistAudience,
): CustomerBlacklistedError | null {
  if (!customer?.isBlacklisted) return null;
  return new CustomerBlacklistedError(audience, customer.blacklistReason, customer.blacklistedAt);
}

/** Throws CustomerBlacklistedError when the customer (Customer.id) is blacklisted. */
export async function assertCustomerNotBlacklisted(
  customerId: number,
  audience: BlacklistAudience,
  db: Db = prisma,
): Promise<void> {
  const row = await db.customer.findUnique({
    where: { id: customerId },
    select: { isBlacklisted: true, blacklistReason: true, blacklistedAt: true },
  });
  const refusal = blacklistRefusal(row, audience);
  if (refusal) throw refusal;
}

// ── Staff customer-search cache ──────────────────────────────────────────────
// GET /api/employee/customer/search caches results for 60 s per query. v3
// entries carry the blacklist flag; a blacklist change drops every cached
// search so the Fleet badge is right on the next search.

export const CUSTOMER_SEARCH_CACHE_PREFIX = "customer_search:v3:";

export async function invalidateCustomerSearchCache(): Promise<void> {
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${CUSTOMER_SEARCH_CACHE_PREFIX}*`,
        "COUNT",
        200,
      );
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    // Non-fatal: entries expire on their own within 60 s.
    console.error("[customer-blacklist] search cache invalidation failed:", err);
  }
}

// ── Masking ──────────────────────────────────────────────────────────────────

/** "KA01XXXXXXX2345" — state + RTO code and the last 4 characters. */
export function maskDrivingLicence(value: string | null | undefined): string | null {
  const n = String(value ?? "").toUpperCase().replace(/[\s\-/]/g, "");
  if (!n) return null;
  if (n.length <= 8) return `${n.slice(0, 2)}${"X".repeat(Math.max(0, n.length - 2))}`;
  return `${n.slice(0, 4)}${"X".repeat(n.length - 8)}${n.slice(-4)}`;
}
