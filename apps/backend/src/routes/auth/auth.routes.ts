    import {Router} from "express"
    import { emailAuthController, emailAuthControllerSignin } from "../../controller/auth.controller.js"
    import { emailverify, generateemailotp } from "../../controller/email-verify.controller.js"
    import passport from "../../utils/passport/google"
    import { googleSignIn } from "../../controller/google.controller.js"

    const router:Router=Router()

    //Auth router for Normal Login And Google Auth


    router.post("/email/signup",emailAuthController)
    router.post("/email/signin",emailAuthControllerSignin)
    router.route("/email/verify-email").get(generateemailotp).post(emailverify)
    router.get("/google",passport.authenticate("google", { scope: ["profile", "email"],session:false }))
    router.get("/google/callback",passport.authenticate("google", { session: false,
    failureRedirect: `${process.env.FRONTEND_REDIRECT_URL}/login?error=auth_failed`,}),googleSignIn)

    export default router