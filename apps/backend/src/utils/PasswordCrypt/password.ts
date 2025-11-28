import bcrypt from "bcrypt"


export const hashpassword=async (password:string)=>{
    return await bcrypt.hash(password,10)
}

export const comparehash=async(password:string,hashpassword:string)=>{
    return await bcrypt.compare(password,hashpassword)
}