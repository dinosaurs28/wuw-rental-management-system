import { Request, Response } from "express";
import { jwtsign } from "../../utils/token/tokensign.utlis.js";
import { StatusCode } from "../../types/statusCode.js";
import { emailAuthSchemaSignin } from "@repo/schemas";
import { prisma, Role } from "@repo/database/client";
import { comparehash } from "../../utils/PasswordCrypt/password.js";
import { auditService, AuditCategory, AuditSeverity } from "../../services/audit/audit.service.js";

export const Login = async (req: Request, res: Response) => {
  const body = req.body;
  const Validation = emailAuthSchemaSignin.safeParse(body);

  if (!Validation.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid Inputs",
      error: Validation.error,
    });
  }

  const { password } = Validation.data;
  const email = Validation.data.email.toLowerCase().trim();

  try {
    const user = await prisma.user.findFirst({
      where: {
        email: email,
      },
    });

    if (!user) {
      auditService.log({
        actorName: "Unknown",
        actorRole: Role.MANAGER,
        action: "LOGIN_FAILED",
        category: AuditCategory.AUTH,
        severity: AuditSeverity.WARNING,
        description: `Manager login failed — user not found`,
        entity: "User",
        entityId: "unknown",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { attemptedEmail: email },
      });
      return res.status(StatusCode.NOT_FOUND).json({
        message: "User Not Found",
      });
    }

    if (user.role !== Role.MANAGER) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Access Denied: Branch Managers Only",
      });
    }

    if (!user.isActive) {
      auditService.log({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        actorBranchId: user.branchId ?? undefined,
        action: "LOGIN_FAILED",
        category: AuditCategory.AUTH,
        severity: AuditSeverity.WARNING,
        description: `Manager login failed — account deactivated for ${user.email}`,
        entity: "User",
        entityId: user.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { attemptedEmail: email },
      });
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Your account has been deactivated. Please contact the admin.",
      });
    }

    const isPasswordValid = await comparehash(
      password,
      user.passwordHash as string,
    );
    if (!isPasswordValid) {
      auditService.log({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        actorBranchId: user.branchId ?? undefined,
        action: "LOGIN_FAILED",
        category: AuditCategory.AUTH,
        severity: AuditSeverity.WARNING,
        description: `Manager login failed — invalid password for ${user.email}`,
        entity: "User",
        entityId: user.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { attemptedEmail: email },
      });
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Invalid Credentials",
      });
    }

    const token = await jwtsign({
      sub: user.publicId,
      role: user.role,
      verified: !!user.emailVerifiedAt,
      provider: user.authProvider,
      branchId: user.branchId as number,
    });

    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });

    auditService.log({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      actorBranchId: user.branchId ?? undefined,
      action: "LOGIN_SUCCESS",
      category: AuditCategory.AUTH,
      description: `Manager ${user.name} logged in successfully`,
      entity: "User",
      entityId: user.publicId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return res.status(StatusCode.OK).json({
      message: "Manager Login Successful",
      user: {
        id: user.publicId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Manager Login Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
