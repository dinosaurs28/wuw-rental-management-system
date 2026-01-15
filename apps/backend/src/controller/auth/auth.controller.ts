import { Request,Response } from "express"
import { emailAuthSchema, emailAuthSchemaSignin } from "@repo/schemas"
import { StatusCode } from "../../types/statusCode.js"
import { comparehash, hashpassword } from "../../utils/PasswordCrypt/password.js"
import { createID } from "../../utils/nanoID.js"
import { AuthProvider, prisma,Role } from "@repo/database/client"
import { jwtsign } from "../../utils/token/tokensign.utlis.js"

export const emailAuthController=async (req:Request,res:Response)=>{
        try{
            const parseddata=emailAuthSchema.safeParse(req.body)
            if(!parseddata.success ){
                return res.status(StatusCode.BAD_REQUEST).json({
                    message:"Validation Error",
                    errors:parseddata.error.flatten()
                })
            }
            const email = parseddata.data.email.toLowerCase().trim();
            const isemailpresent=await prisma.user.findUnique({
                where:{
                    email:email
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
                    email:email,
                    passwordHash:hashedvalue,
                    role:Role.CUSTOMER
                }
            })
            await prisma.userProvider.create({
                data:{
                    userId:response.id,
                    publicId:createID(),
                    provider:AuthProvider.PASSWORD,
                    createdAt:new Date(),
                    updatedAt:new Date(),
                    providerUserId:response.email
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

export const emailAuthControllerSignin=async (req:Request,res:Response)=>{
    try{
        const parseddata=emailAuthSchemaSignin.safeParse(req.body)
        if(!parseddata.success){
               return res.status(StatusCode.BAD_REQUEST).json({
                    message:"Validation Error",
                    errors:parseddata.error.flatten()
                }) 
        }
        const {email,password}=parseddata.data;
        const emailower=email.toLocaleLowerCase().trim()
        const response=await prisma.user.findUnique({
            where:{
                email:emailower
            }
        })
        if(!response || !response.passwordHash){
           return res.status(StatusCode.NOT_FOUND).json({
                message:"This email address is not registered."
            })
        }
        const hashcomparpass=await comparehash(password,response?.passwordHash)
        if(!hashcomparpass){
            return res.status(StatusCode.UNAUTHORIZED).json({
                message:"Invalid credentials."
            })
        }
        if(!response.emailVerifiedAt){
            return res.status(StatusCode.CREATED).cookie("verifySession",response.publicId,{
                httpOnly: false,
                secure: true,
                sameSite: "strict",
            }).json({
                message:"Redirecting to Otp Page"
            })
        }
        const token=await jwtsign({sub:response.publicId,role:response.role,verified:true,provider:response.authProvider})
        return res.status(StatusCode.OK).cookie("accessToken",token,{
            httpOnly: true,
            secure: true,
            sameSite: "strict",
        }).json({
            message:"Success",
        })
    }catch(e:any){
         console.log("The Error In the Email Auth Controller",e)
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message:"The Internal Error While processing the Email Auth Route"
            })
    }
}