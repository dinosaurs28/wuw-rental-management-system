import type { NextFunction, Request, Response } from "express";
import { withoutFestivalPricing } from "../utils/pricing/festivalPrivacy.js";

/**
 * Customer-facing mounts (/api/public, /api/user): every JSON response leaves
 * out festival pricing details (utils/pricing/festivalPrivacy.ts) — cached
 * payloads included — so customers see only the final price. Staff routers
 * aren't wrapped and keep the breakdowns.
 */
export function hideFestivalPricing(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body?: unknown) => json(withoutFestivalPricing(body));
  next();
}
