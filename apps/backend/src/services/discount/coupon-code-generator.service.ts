import { prisma } from "@repo/database/client";
import { randomBytes } from "crypto";

export type CouponPattern = "BRANCH_PREFIX" | "EMPLOYEE_LINKED" | "PROMOTIONAL";

export interface GenerateCodeOptions {
  pattern: CouponPattern;
  branchCode?: string;   // e.g. "MUM" — used in BRANCH_PREFIX
  employeeId?: string;   // e.g. "EMP001" — used in EMPLOYEE_LINKED
  length?: number;       // random suffix length, default 6
}

class CouponCodeGeneratorService {
  private readonly CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // excludes ambiguous chars O,0,1,I

  private generateRandomSuffix(length: number): string {
    const bytes = randomBytes(length * 2);
    let result = "";
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      const byte = bytes[i];
      if (byte === undefined) continue;
      const idx = byte % this.CHARSET.length;
      const char = this.CHARSET[idx];
      if (char === undefined) continue;
      result += char;
    }
    return result;
  }

  private buildCandidate(opts: GenerateCodeOptions): string {
    const suffixLen = opts.length ?? 6;
    const suffix = this.generateRandomSuffix(suffixLen);

    switch (opts.pattern) {
      case "BRANCH_PREFIX": {
        const prefix = (opts.branchCode ?? "BR").toUpperCase().slice(0, 4);
        return `${prefix}-${suffix}`;
      }
      case "EMPLOYEE_LINKED": {
        const emp = (opts.employeeId ?? "EMP").toUpperCase().slice(0, 6);
        return `${emp}-${suffix}`;
      }
      case "PROMOTIONAL":
      default:
        return `PROMO-${suffix}`;
    }
  }

  /**
   * Generate a unique coupon code that does not already exist in DiscountRule.
   * Retries up to 10 times on collision (astronomically unlikely in practice).
   */
  async generateCode(opts: GenerateCodeOptions): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = this.buildCandidate(opts);
      const existing = await prisma.discountRule.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    // Fallback: add timestamp to guarantee uniqueness
    const ts = Date.now().toString(36).toUpperCase();
    return `${this.buildCandidate(opts)}-${ts}`;
  }
}

export const couponCodeGeneratorService = new CouponCodeGeneratorService();
