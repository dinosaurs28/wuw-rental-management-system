import { NextFunction, Response, Request } from "express";
import { StatusCode } from "../types/statusCode.js";
import { jwtverfiy } from "../utils/token/tokenverfiy.utlis.js";
import { jwtinterface } from "../utils/token/tokensign.utlis.js";
import { Role } from "@repo/database/client";

export const AdminCheck = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.cookies;

  if (!token.accessToken) {
    return res.status(StatusCode.FORBIDDEN).json({
      message: "The Access Token Is Missing Please login Again",
    });
  }

  const isverified = (await jwtverfiy(token.accessToken)) as jwtinterface;

  if (!isverified) {
    return res.status(StatusCode.UNAUTHORIZED).json({
      message:
        "Authentication required. Your session has expired or is invalid.",
    });
  }

  if (isverified.role === Role.ADMIN) {
    req.public_Id = isverified.sub;
    return next();
  }

  return res.status(StatusCode.FORBIDDEN).json({
    message: "Access Denied: Admins Only",
  });
};
