    import {Router} from "express"
    import { emailAuthController, emailAuthControllerSignin } from "../../controller/auth/auth.controller.js"
    import { generateOTP, verifyOTP } from "../../controller/auth/email-verify.controller.js"
    import passport from "../../utils/passport/google"
    import { googleSignIn } from "../../controller/auth/google.controller.js"
   

    const router:Router=Router()

    //Auth router for Normal Login And Google Auth


    router.post("/email/signup",emailAuthController)
    router.post("/email/signin",emailAuthControllerSignin)
    router.route("/email/verify-email").post(generateOTP).post(verifyOTP)
    router.get("/google",passport.authenticate("google", { scope: ["profile", "email"],session:false }))
    router.get("/google/callback",passport.authenticate("google", { session: false,
    failureRedirect: `${process.env.FRONTEND_REDIRECT_URL}/login?error=auth_failed`,}),googleSignIn)

    export default router