import { isIP } from "net";
import type { Request } from "express";

// The API runs behind Cloudflare -> nginx (same host) -> Node. With
// `trust proxy` set to loopback (index.ts), req.ip resolves to the address
// nginx saw, which is a Cloudflare edge IP shared by many visitors. Cloudflare
// puts the real visitor address in CF-Connecting-IP, so prefer it for per-IP
// rate-limit keys and audit rows. Only trust this while the origin accepts
// traffic from Cloudflare alone; per-email / per-user limits still apply when
// a direct caller spoofs the header.
export function getClientIp(req: Request): string | undefined {
  const header = req.headers["cf-connecting-ip"];
  const raw = Array.isArray(header) ? header[0] : header;
  const candidate = raw?.split(",")[0]?.trim();
  if (candidate && isIP(candidate)) {
    return candidate;
  }
  return req.ip;
}
