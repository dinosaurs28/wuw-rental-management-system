import {Router} from "express"
import { emailAuthController, emailAuthControllerSignin } from "../../controller/auth.controller.js"
import { emailverify, generateemailotp } from "../../controller/email-verify.controller.js"

const router:Router=Router()

//Auth router for Normal Login And Google Auth


router.post("/email/signup",emailAuthController)
router.post("/email/signin",emailAuthControllerSignin)
router.route("/email/verify-email").get(generateemailotp).post(emailverify)
// router.post("/google",)

export default router