import express,{Request,Response} from "express"
import cors from "cors"
import { StatusCode } from "./types/statusCode.js"
import dotenv from "dotenv"
import helmet from "helmet"
import authrouter from "./routes/auth.routes.js"
dotenv.config()
const app=express()

app.use(express.json())
app.use(cors())
app.use(helmet())

app.use("/api/auth",authrouter)


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