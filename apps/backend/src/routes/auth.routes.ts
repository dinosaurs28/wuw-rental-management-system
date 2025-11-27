import {Router} from "express"
import { emailAuthController } from "../controller/auth.controller.js"

const router:Router=Router()

//Auth router for Normal Login And Google Auth


router.post("/email",emailAuthController)
// router.post("/google",)

export default router