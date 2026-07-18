import { NextFunction, Response, Request } from "express";
import { StatusCode } from "../types/statusCode.js";
import { jwtverfiy } from "../utils/token/tokenverfiy.utlis.js";
import { jwtinterface } from "../utils/token/tokensign.utlis.js";
import { prisma, Role } from "@repo/database/client";

declare global {
  namespace Express {
    interface Request {
      public_Id: string;
      branch_Id: number;
    }
  }
}

export const EmployeeCheck = async (
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
    });
  }
  const isverfied = (await jwtverfiy(rawToken)) as jwtinterface;
  if (!isverfied) {
    return res.status(StatusCode.UNAUTHORIZED).json({
      message:
        "Authentication required. Your session has expired or is invalid. Please log in again to securely continue.",
    });
  }
  if (isverfied.role === Role.STAFF) {
    const user = await prisma.user.findUnique({
      where: { publicId: isverfied.sub },
      select: { isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Your account has been deactivated. Please contact your branch manager.",
      });
    }

    req.public_Id = isverfied.sub;
    req.branch_Id = isverfied.branchId as number;
    return next();
  }
  return res.status(StatusCode.FORBIDDEN).json({
    message: "Access Denied: Employees Only",
  });
};
