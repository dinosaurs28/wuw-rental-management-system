import { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { AuthProvider, prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { jwtsign } from "../../utils/token/tokensign.utlis.js";
import { createID } from "../../utils/nanoID.js";
import {
  auditService,
  AuditCategory,
} from "../../services/audit/audit.service.js";

// Google issues platform-specific clientIDs (web, iOS, Android). Tokens from
// any of them must verify against an audience matching the issuing client.
// We accept all configured ones via env so a single endpoint serves all
// mobile platforms.
const acceptedAudiences = [
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_WEB_CLIENT_ID,
].filter(Boolean) as string[];

const client = new OAuth2Client();

/**
 * POST /api/auth/google/mobile
 * Body: { idToken: string }
 * Verifies the Google idToken, finds-or-creates the matching CUSTOMER, and
 * returns a JWT in the response body (no cookie). Mobile clients store the
 * token in their secure store and send it as a Bearer header.
 */
export const googleMobileSignIn = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken || typeof idToken !== "string") {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "idToken is required",
      });
    }
    if (acceptedAudiences.length === 0) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
        message: "Google OAuth is not configured on the server",
      });
    }

    // Verify the token. google-auth-library checks signature, expiry, issuer,
    // and audience against the provided list.
    const ticket = await client.verifyIdToken({
      idToken,
      audience: acceptedAudiences,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Invalid Google token",
      });
    }

    const email = payload.email;
    const googleUserId = payload.sub;
    const name = payload.name ?? payload.email.split("@")[0]!;

    // Find or create the user (mirrors passport strategy in
    // utils/passport/google.ts so a user can sign in interchangeably from
    // web or mobile).
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          publicId: createID(),
          name,
          email,
          authProvider: AuthProvider.GOOGLE,
          role: Role.CUSTOMER,
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.userProvider.create({
        data: {
          publicId: createID(),
          userId: user.id,
          provider: AuthProvider.GOOGLE,
          providerUserId: googleUserId,
        },
      });
    } else {
      await prisma.userProvider.upsert({
        where: {
          provider_providerUserId: {
            provider: AuthProvider.GOOGLE,
            providerUserId: googleUserId,
          },
        },
        update: {},
        create: {
          publicId: createID(),
          userId: user.id,
          provider: AuthProvider.GOOGLE,
          providerUserId: googleUserId,
        },
      });
    }

    if (user.role !== Role.CUSTOMER) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Only customer login is allowed via mobile",
      });
    }

    const token = await jwtsign({
      sub: user.publicId,
      role: user.role,
      provider: "GOOGLE",
      verified: true,
    });

    auditService.log({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: "LOGIN_SUCCESS",
      category: AuditCategory.AUTH,
      description: `Customer ${user.name} signed in via Google (mobile)`,
      entity: "User",
      entityId: user.publicId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(StatusCode.OK).json({
      message: "Success",
      data: {
        name: user.name,
        email: user.email,
        role: user.role,
        publicId: user.publicId,
        accessToken: token,
      },
    });
  } catch (e: any) {
    console.log("Google mobile sign-in error:", e);
    return res.status(StatusCode.UNAUTHORIZED).json({
      message: "Invalid or expired Google token",
    });
  }
};
