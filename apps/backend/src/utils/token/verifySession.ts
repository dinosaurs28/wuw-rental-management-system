import jwt from "jsonwebtoken";
import type { Request } from "express";

// The `verifySession` cookie lets an UNVERIFIED customer who just proved their
// password (or Google identity) reach the phone-OTP step. It used to hold the
// plain User publicId, so anyone who knew a publicId could act as that user on
// /auth/email/verify-otp. It is now a short-lived signed token. A separate key
// (derived from JWT_SECERT) means it can never pass as an access token, and an
// access token can never pass as it.

export const VERIFY_SESSION_COOKIE = "verifySession";
export const VERIFY_SESSION_TTL_SECONDS = 30 * 60;

const PURPOSE = "verify-session";

function signingKey(): string {
  return `${process.env.JWT_SECERT!}:${PURPOSE}`;
}

export function signVerifySession(userPublicId: string): string {
  return jwt.sign({ sub: userPublicId, purpose: PURPOSE }, signingKey(), {
    algorithm: "HS256",
    expiresIn: VERIFY_SESSION_TTL_SECONDS,
  });
}

/** The User publicId from a valid, unexpired verifySession cookie, or null. */
export function readVerifySession(req: Request): string | null {
  const raw = req.cookies?.[VERIFY_SESSION_COOKIE];
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const payload = jwt.verify(raw, signingKey(), { algorithms: ["HS256"] });
    if (
      typeof payload === "object" &&
      payload !== null &&
      payload.purpose === PURPOSE &&
      typeof payload.sub === "string" &&
      payload.sub !== ""
    ) {
      return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

// Same attributes as before (the web reads the cookie's presence to route to
// the OTP page, so it stays readable by script), plus an expiry.
export const VERIFY_SESSION_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: true,
  sameSite: "strict" as const,
  maxAge: VERIFY_SESSION_TTL_SECONDS * 1000,
};
