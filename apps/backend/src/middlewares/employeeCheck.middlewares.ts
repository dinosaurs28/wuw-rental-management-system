import { NextFunction,Response,Request } from "express";
import { StatusCode } from "../types/statusCode";
import { jwtverfiy } from "../utils/token/tokenverfiy.utlis";
import { jwtinterface } from "../utils/token/tokensign.utlis";
import { Role } from "@repo/database/client";

declare global{
    namespace Express{
        interface Request{
            public_Id:string,
            branch_Id:number,
        }
    }
}

export const EmployeeCheck=async (req:Request,res:Response,next:NextFunction)=>{
    const token=req.cookies
    if(!token.accessToken){
        return res.status(StatusCode.FORBIDDEN).json({
            message:"The Access Token Is Missing Please login Again"
        })
    }
    const isverfied=await jwtverfiy(token.accessToken) as jwtinterface
    if(!isverfied){
        return res.status(StatusCode.UNAUTHORIZED).json({
            message:"Authentication required. Your session has expired or is invalid. Please log in again to securely continue."
        })
    }
    if(isverfied.role===Role.STAFF){
        req.public_Id=isverfied.sub
        req.branch_Id=isverfied.branchId as number
        return next()
    }
    return res.status(StatusCode.FORBIDDEN).json({
        message:"Access Denied: Employees Only"
    })
}