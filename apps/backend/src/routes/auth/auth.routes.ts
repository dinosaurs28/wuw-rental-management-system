    import {Router} from "express"
    import { emailAuthController, emailAuthControllerSignin, ProfileInfo } from "../../controller/auth/auth.controller.js"
    import { generateOTP, verifyOTP } from "../../controller/auth/email-verify.controller.js"
    import passport from "../../utils/passport/google"
    import { googleSignIn } from "../../controller/auth/google.controller.js"
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js"
import { StatusCode } from "../../types/statusCode.js"
   

    const router:Router=Router()

    //Auth router for Normal Login And Google Auth


    router.post("/email/signup",emailAuthController)
    router.post("/email/signin",emailAuthControllerSignin)
    router.route("/email/verify-otp").post(generateOTP)
    router.post("/email/verify-otp/code",verifyOTP)
    router.get("/google",passport.authenticate("google", { scope: ["profile", "email"],session:false }))
    router.get("/google/callback",passport.authenticate("google", { session: false,
    failureRedirect: `${process.env.FRONTEND_REDIRECT_URL}/login?error=auth_failed`,}),googleSignIn)
    router.get("/me",authCheckJwt,ProfileInfo)
    router.get("/logout",authCheckJwt,(req,res)=>{
        return res.clearCookie("accessToken").json({message:"Logout Success",
            isAuthenticated: false
        }).status(StatusCode.OK)
    })

    export default router