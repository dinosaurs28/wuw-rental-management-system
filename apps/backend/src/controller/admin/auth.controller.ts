import { Request, Response } from "express";
import { jwtsign } from "../../utils/token/tokensign.utlis.js";
import { StatusCode } from "../../types/statusCode.js";
import { emailAuthSchemaSignin } from "@repo/schemas";
import { prisma, Role } from "@repo/database/client";
import { comparehash } from "../../utils/PasswordCrypt/password.js";

export const Login = async (req: Request, res: Response) => {
  const body = req.body;
  const Validation = emailAuthSchemaSignin.safeParse(body);

  if (!Validation.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid Inputs",
      error: Validation.error,
    });
  }

  const { email, password } = Validation.data;

  try {
    const user = await prisma.user.findFirst({
      where: {
        email: email,
      },
    });

    if (!user) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "User Not Found",
      });
    }

    if (user.role !== Role.ADMIN) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Access Denied: Admins Only",
      });
    }

    const isPasswordValid = await comparehash(
      password,
      user.passwordHash as string,
    );
    if (!isPasswordValid) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Invalid Credentials",
      });
    }

    const token = await jwtsign({
      sub: user.publicId,
      role: user.role,
      verified: !!user.emailVerifiedAt,
      provider: user.authProvider,
      // branchId is likely null for admin, but if needed:
      branchId: user.branchId as number,
    });

    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });

    return res.status(StatusCode.OK).json({
      message: "Admin Login Successful",
      user: {
        id: user.publicId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Admin Login Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
