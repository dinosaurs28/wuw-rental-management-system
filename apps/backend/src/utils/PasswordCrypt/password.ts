import bcrypt from "bcrypt"


export const hashpassword=async (password:string)=>{
    return await bcrypt.hash(password,10)
}