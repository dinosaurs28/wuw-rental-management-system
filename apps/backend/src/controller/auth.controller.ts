import { Request,Response } from "express"
import { emailAuthSchema } from "@repo/schemas"
import { StatusCode } from "../types/statusCode.js"
import { hashpassword } from "../utils/PasswordCrypt/password.js"
import { createID } from "../utils/nanoID.js"
import { prisma,Role } from "@repo/database/client"

export const emailAuthController=async (req:Request,res:Response)=>{
        try{
            const parseddata=emailAuthSchema.safeParse(req.body)
            if(!parseddata.success ){
                return res.status(StatusCode.BAD_REQUEST).json({
                    message:"Validation Error",
                    errors:parseddata.error.flatten()
                })
            }
            const isemailpresent=await prisma.user.findUnique({
                where:{
                    email:parseddata.data.email
                }
            })
            if(isemailpresent){
                return res.status(StatusCode.CONFLICT).json({
                    message:"This email address is already registered."
                })
            }
            const hashedvalue=await hashpassword(parseddata.data.password)
            const response=await prisma.user.create({
                data:{
                    publicId:createID(),
                    name:parseddata.data.name,
                    email:parseddata.data.email,
                    passwordHash:hashedvalue,
                    role:Role.CUSTOMER
                }
            })
            if(!response){
                return res.status(StatusCode.UNPROCESSABLE_ENTITY).json({
                    message:"Unable to Create The user At the Movement"
                })
            }
            return res.status(StatusCode.CREATED).json({
                message:"User created successfully."
            })
        }catch(e:any){
            console.log("The Error In the Email Auth Controller",e)
            return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
                message:"The Internal Error While processing the Email Auth Route"
            })
        }
}