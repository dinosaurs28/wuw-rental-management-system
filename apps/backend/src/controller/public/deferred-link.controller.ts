import { Request, Response } from "express";
import {
  DEFERRED_LINK_TTL_SECONDS,
  deferredLinkClaimSchema,
  deferredLinkRecordSchema,
  parseVehicleLinkPath,
} from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { getClientIp } from "../../utils/clientIp.js";
import {
  claimDeferredLink,
  clientNetworkKey,
  deferredLinkRateLimitOk,
  detectPlatformFromUserAgent,
  recordDeferredLink,
} from "../../services/deep-link/deferred-link.service.js";

// navigator.sendBeacon posts a string as text/plain (no CORS preflight), so a
// JSON string body is accepted too.
function readBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

const PLATFORM_REQUIRED_MESSAGE = 'Send platform "android" or "ios".';

/**
 * POST /api/public/deferred-links  { path, platform? }
 * Public (no auth). Saves the vehicle the visitor opened for this network +
 * platform for one hour, replacing any earlier one.
 */
export const RecordDeferredLink = async (req: Request, res: Response) => {
  try {
    const parsed = deferredLinkRecordSchema.safeParse(readBody(req.body));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const onPlatform = issue?.path[0] === "platform";
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: onPlatform ? "DEFERRED_LINK_PLATFORM_INVALID" : "DEFERRED_LINK_INVALID_PATH",
        message: issue?.message ?? "Invalid request.",
      });
    }

    const link = parseVehicleLinkPath(parsed.data.path);
    if (!link) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "DEFERRED_LINK_INVALID_PATH",
        message: "Only vehicle links (/vehicle/<id> or /app/vehicle/<id>) can be saved.",
      });
    }

    const platform = parsed.data.platform ?? detectPlatformFromUserAgent(req.get("user-agent"));
    if (!platform) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "DEFERRED_LINK_PLATFORM_INVALID",
        message: PLATFORM_REQUIRED_MESSAGE,
      });
    }

    const network = clientNetworkKey(getClientIp(req));
    if (!network) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "DEFERRED_LINK_UNAVAILABLE",
        message: "This link can't be saved from your network.",
      });
    }

    if (!(await deferredLinkRateLimitOk("record", network))) {
      return res.status(StatusCode.TOO_MANY_REQUESTS).json({
        success: false,
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again in a few minutes.",
      });
    }

    const saved = await recordDeferredLink(network, platform, link);
    return res.status(StatusCode.CREATED).json({
      success: true,
      data: {
        path: saved.path,
        vehicleId: saved.vehicleId,
        kind: saved.kind,
        platform,
        expiresAt: saved.expiresAt,
        expiresInSeconds: DEFERRED_LINK_TTL_SECONDS,
      },
    });
  } catch (error) {
    console.error("RecordDeferredLink Error:", (error as Error).message);
    return res.status(StatusCode.SERVICE_UNAVAILABLE).json({
      success: false,
      code: "DEFERRED_LINK_UNAVAILABLE",
      message: "Couldn't save the link right now.",
    });
  }
};

/**
 * POST /api/public/deferred-links/claim  { platform? }
 * Public (no auth). The app calls it once on first launch: returns the link
 * recorded for this network + platform and deletes it; data is null when there
 * is none.
 */
export const ClaimDeferredLink = async (req: Request, res: Response) => {
  try {
    const parsed = deferredLinkClaimSchema.safeParse(readBody(req.body));
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "DEFERRED_LINK_PLATFORM_INVALID",
        message: parsed.error.issues[0]?.message ?? PLATFORM_REQUIRED_MESSAGE,
      });
    }

    const platform = parsed.data.platform ?? detectPlatformFromUserAgent(req.get("user-agent"));
    if (!platform) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "DEFERRED_LINK_PLATFORM_INVALID",
        message: PLATFORM_REQUIRED_MESSAGE,
      });
    }

    const network = clientNetworkKey(getClientIp(req));
    if (!network) {
      return res.status(StatusCode.OK).json({ success: true, data: null });
    }

    if (!(await deferredLinkRateLimitOk("claim", network))) {
      return res.status(StatusCode.TOO_MANY_REQUESTS).json({
        success: false,
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again in a few minutes.",
      });
    }

    const entry = await claimDeferredLink(network, platform);
    return res.status(StatusCode.OK).json({ success: true, data: entry });
  } catch (error) {
    console.error("ClaimDeferredLink Error:", (error as Error).message);
    return res.status(StatusCode.SERVICE_UNAVAILABLE).json({
      success: false,
      code: "DEFERRED_LINK_UNAVAILABLE",
      message: "Couldn't check for a shared link right now.",
    });
  }
};
