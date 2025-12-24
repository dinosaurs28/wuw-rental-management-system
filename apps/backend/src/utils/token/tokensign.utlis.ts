import jwt from "jsonwebtoken"

export interface jwtinterface{
    sub:string,
    role:"ADMIN" | "MANAGER" | "STAFF" | "CUSTOMER",
    verified:boolean,
    provider:string,
    branchId?:number
}

export const jwtsign=async({sub,role,verified,provider,branchId}:jwtinterface)=>{
    const token=await jwt.sign({
        sub:sub,
        role:role,
        verified:verified,
        provider:provider,
        branchId:branchId
    },process.env.JWT_SECERT!)
    return token
}