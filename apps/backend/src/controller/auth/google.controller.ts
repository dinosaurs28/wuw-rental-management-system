import { StatusCode } from "../../types/statusCode.js";
import { jwtsign } from "../../utils/token/tokensign.utlis.js";

import { Request,Response } from "express"

declare global {
  namespace Express {
    interface User {
      publicId: string;
      email: string;
      name: string;
      role: "CUSTOMER" | "ADMIN" | "STAFF"| "MANAGER";
      emailVerifiedAt:Date | null
    }
  }
}

export const googleSignIn=async (req:Request,res:Response)=>{
    try{
        const user=req.user
        if(!user){
      return res.status(StatusCode.UNAUTHORIZED).json({
                message:"No user Id Found"
            })
    }

    // If user is not verified, redirect to OTP page
    if (!user.emailVerifiedAt) {
      return res.status(StatusCode.OK)
        .cookie("verifySession", user.publicId, {
          httpOnly: false,
          secure: true, // Should be true in production
          sameSite: "strict",
        })
        .redirect(`${process.env.FRONTEND_REDIRECT_URL}/verify-otp`);
    }

    const token = await jwtsign({
      sub: user.publicId,
      role: user.role,
      provider: "GOOGLE",
      verified: true
    });

    res.cookie("accessToken", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    res.redirect(process.env.FRONTEND_REDIRECT_URL!);

  } catch (e: any) {
    console.log("Internal Error While Processing the Google Sign In", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Error While Processing The Google Sign In"
    });
  }
}
