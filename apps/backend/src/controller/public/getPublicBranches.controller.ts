import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig";

export const getPublicBranches=async(req:Request,res:Response)=>{
    try {
        const cachedBranches=await redis.get("branches")
        if(cachedBranches){
            return res.status(StatusCode.OK).json({
                message:"Branches fetched successfully",
                data:JSON.parse(cachedBranches)
            })
        }
        const branches=await prisma.branch.findMany({
            select:{
                publicId:true,
                name:true,
            }
        })
        if(branches.length===0){
            return res.status(StatusCode.NOT_FOUND).json({
                message:"No branches found"
            })
        }
        await redis.set("branches",JSON.stringify(branches))
        return res.status(StatusCode.OK).json({
            message:"Branches fetched successfully",
            data:branches
        })
    } catch (error:any) {
        console.log(error)
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message:"Internal server error"
        })
    }
}