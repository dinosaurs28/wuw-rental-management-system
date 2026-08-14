import { NextFunction, Response, Request } from "express";
import { StatusCode } from "../types/statusCode.js";
import { jwtverfiy } from "../utils/token/tokenverfiy.utlis.js"; // Note: .js extension for imports
import { jwtinterface } from "../utils/token/tokensign.utlis.js";
import { prisma, Role } from "@repo/database/client";

export const ManagerCheck = async (
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

  if (isverified.role === Role.MANAGER) {
    const user = await prisma.user.findUnique({
      where: { publicId: isverified.sub },
      select: { isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Your account has been deactivated. Please contact the admin.",
      });
    }

    req.public_Id = isverified.sub;
    req.branch_Id = isverified.branchId as number;

    return next();
  }

  return res.status(StatusCode.FORBIDDEN).json({
    message: "Access Denied: Branch Managers Only",
  });
};
