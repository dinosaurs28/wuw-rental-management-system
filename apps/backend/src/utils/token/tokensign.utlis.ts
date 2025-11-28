import jwt from "jsonwebtoken"

interface jwtinterface{
    sub:string,
    role:"ADMIN" | "MANAGER" | "STAFF" | "CUSTOMER",
    verified:boolean,
    provider:string
}

export const jwtsign=async({sub,role,verified,provider}:jwtinterface)=>{
    const token=await jwt.sign({
        sub:sub,
        role:role,
        verified:verified,
        provider:provider
    },process.env.JWT_SECERT!)
    return token
}