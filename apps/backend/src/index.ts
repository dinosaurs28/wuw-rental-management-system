import express,{Request,Response} from "express"
import cors from "cors"
import { StatusCode } from "./types/statusCode.js"
import dotenv from "dotenv"
import helmet from "helmet"
import authrouter from "./routes/auth/auth.routes.js"
import vehiclerouter from "./routes/public/vehicle.routes"
import cookieParser from "cookie-parser"
import passport from "./utils/passport/google"
dotenv.config()
const app=express()

app.use(express.json())
app.use(cors())
app.use(helmet())
app.use(cookieParser())
app.use(passport.initialize());
app.use("/api/auth",authrouter)
app.use("/api/public",vehiclerouter)


app.get("/health",(req:Request,res:Response)=>{
    return res.status(StatusCode.OK).json({
        uptime:process.uptime(),
        message:"Server is running",
        date:new Date()
    })
})

app.listen(process.env._PORT,()=>{
    console.log(`The Server is Running on ${process.env._PORT}`)
})