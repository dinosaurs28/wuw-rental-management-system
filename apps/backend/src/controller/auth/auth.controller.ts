import { Request, Response } from "express";
import { emailAuthSchema, emailAuthSchemaSignin } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import {
  comparehash,
  hashpassword,
} from "../../utils/PasswordCrypt/password.js";
import { createID } from "../../utils/nanoID.js";
import { AuthProvider, prisma, Role } from "@repo/database/client";
import { jwtsign } from "../../utils/token/tokensign.utlis.js";
import { auditService, AuditCategory, AuditSeverity } from "../../services/audit/audit.service.js";

export const emailAuthController = async (req: Request, res: Response) => {
  try {
    const parseddata = emailAuthSchema.safeParse(req.body);
    if (!parseddata.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation Error",
        errors: parseddata.error.flatten(),
      });
    }
    const email = parseddata.data.email.toLowerCase().trim();
    const isemailpresent = await prisma.user.findUnique({
      where: {
        email: email,
      },
    });
    if (isemailpresent) {
      return res.status(StatusCode.CONFLICT).json({
        message: "This email address is already registered.",
      });
    }
    const hashedvalue = await hashpassword(parseddata.data.password);
    const response = await prisma.user.create({
      data: {
        publicId: createID(),
        name: parseddata.data.name,
        email: email,
        passwordHash: hashedvalue,
        role: Role.CUSTOMER,
        emailVerifiedAt: new Date(), // Until the Otp system is Ready
      },
    });
    await prisma.userProvider.create({
      data: {
        userId: response.id,
        publicId: createID(),
        provider: AuthProvider.PASSWORD,
        createdAt: new Date(),
        updatedAt: new Date(),
        providerUserId: response.email,
      },
    });
    if (!response) {
      return res.status(StatusCode.UNPROCESSABLE_ENTITY).json({
        message: "Unable to Create The user At the Movement",
      });
    }
    return res.status(StatusCode.CREATED).json({
      message: "User created successfully.",
    });
  } catch (e: any) {
    console.log("The Error In the Email Auth Controller", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "The Internal Error While processing the Email Auth Route",
    });
  }
};

export const emailAuthControllerSignin = async (
  req: Request,
  res: Response,
) => {
  try {
    const parseddata = emailAuthSchemaSignin.safeParse(req.body);
    if (!parseddata.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation Error",
        errors: parseddata.error.flatten(),
      });
    }
    const { email, password } = parseddata.data;
    const emailower = email.toLocaleLowerCase().trim();
    const response = await prisma.user.findUnique({
      where: {
        email: emailower,
      },
    });
    if (!response || !response.passwordHash) {
      auditService.log({
        actorName: "Unknown",
        actorRole: Role.CUSTOMER,
        action: "LOGIN_FAILED",
        category: AuditCategory.AUTH,
        severity: AuditSeverity.WARNING,
        description: `Customer login failed — email not registered`,
        entity: "User",
        entityId: "unknown",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { attemptedEmail: emailower },
      });
      return res.status(StatusCode.NOT_FOUND).json({
        message: "This email address is not registered.",
      });
    }
    const hashcomparpass = await comparehash(password, response?.passwordHash);
    if (!hashcomparpass) {
      auditService.log({
        actorId: response.id,
        actorName: response.name,
        actorRole: response.role,
        action: "LOGIN_FAILED",
        category: AuditCategory.AUTH,
        severity: AuditSeverity.WARNING,
        description: `Customer login failed — invalid password for ${response.email}`,
        entity: "User",
        entityId: response.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { attemptedEmail: emailower },
      });
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Invalid credentials.",
      });
    }
    if (!response.emailVerifiedAt) {
      return res
        .status(StatusCode.CREATED)
        .cookie("verifySession", response.publicId, {
          httpOnly: false,
          secure: true,
          sameSite: "strict",
        })
        .json({
          message: "Redirecting to Otp Page",
          data: {
            name: response.name,
            email: response.email,
            role: response.role,
            publicId: response.publicId,
          },
        });
    }
    if (response.role === Role.CUSTOMER) {
      const token = await jwtsign({
        sub: response.publicId,
        role: response.role,
        verified: true,
        provider: response.authProvider,
      });
      auditService.log({
        actorId: response.id,
        actorName: response.name,
        actorRole: response.role,
        action: "LOGIN_SUCCESS",
        category: AuditCategory.AUTH,
        description: `Customer ${response.name} logged in successfully`,
        entity: "User",
        entityId: response.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return res
        .status(StatusCode.OK)
        .cookie("accessToken", token, {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
        })
        .json({
          message: "Success",
          data: {
            name: response.name,
            email: response.email,
            role: response.role,
            publicId: response.publicId,
            accessToken: token,
          },
        });
    }

    return res.status(StatusCode.UNAUTHORIZED).json({
      message: "Only Customer Login is Allowed",
    });
  } catch (e: any) {
    console.log("The Error In the Email Auth Controller", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "The Internal Error While processing the Email Auth Route",
    });
  }
};

export const ProfileInfo = async (req: Request, res: Response) => {
  try {
    const query = req.query.google;
    const public_Id = req.public_Id;
    if (query) {
      const response = await prisma.user.findUnique({
        where: {
          publicId: public_Id,
        },
      });
      if (!response) {
        return res.status(StatusCode.NOT_FOUND).json({
          message: "User Not Found",
        });
      }
      return res.status(StatusCode.OK).json({
        message: "Success",
        data: {
          isAuthenticated: true,
          name: response.name,
          email: response.email,
          role: response.role,
          publicId: response.publicId,
        },
      });
    }
    return res.json({
      message: "Success",
      data: {
        isAuthenticated: true,
      },
    });
  } catch (e: any) {
    console.log("The Error In the Profile Info Controller", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "The Internal Error While processing the Profile Info Route",
    });
  }
};
