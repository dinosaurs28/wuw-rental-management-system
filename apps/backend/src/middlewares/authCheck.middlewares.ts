import { NextFunction, Response, Request } from "express";
import { StatusCode } from "../types/statusCode.js";
import { jwtverfiy } from "../utils/token/tokenverfiy.utlis.js";
import { jwtinterface } from "../utils/token/tokensign.utlis.js";
import { Role } from "@repo/database/client";

declare global {
  namespace Express {
    interface Request {
      public_Id: string;
    }
  }
}

export const authCheckJwt = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const cookieToken = req.cookies?.accessToken;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const rawToken = cookieToken || bearerToken;

  if (!rawToken) {
    return res.status(StatusCode.FORBIDDEN).json({
      message: "The Access Token Is Missing Please login Again",
      isAuthenticated: false,
    });
  }
  const isverfied = (await jwtverfiy(rawToken)) as jwtinterface;
  if (!isverfied) {
    return res.status(StatusCode.UNAUTHORIZED).json({
      message:
        "Authentication required. Your session has expired or is invalid. Please log in again to securely continue.",
      isAuthenticated: false,
    });
  }
  if (isverfied.role !== Role.CUSTOMER) {
    return res.status(StatusCode.FORBIDDEN).json({
      message: "You Are Not Authorized To Access This Route",
      isAuthenticated: false,
    });
  }
  if (isverfied.verified === true) {
    req.public_Id = isverfied.sub;
    return next();
  }
  return res.status(StatusCode.FORBIDDEN).json({
    message: "Please Verfiy Your Phone Number",
    isAuthenticated: false,
  });
};
