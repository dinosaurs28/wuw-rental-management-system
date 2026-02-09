import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });
import express, { Request, Response } from "express";
import cors from "cors";
import { StatusCode } from "./types/statusCode.js";
import helmet from "helmet";
import authrouter from "./routes/auth/auth.routes.js";
import vehiclerouter from "./routes/public/vehicle.routes.js";
import cookieParser from "cookie-parser";
import passport, { initializePassport } from "./utils/passport/google.js";
import paymentrouter from "./routes/payment/payment.routes.js";
import userrouter from "./routes/user/user.routes.js";
import employeerouter from "./routes/employee/employee.routes.js";
import branchManagerRouter from "./routes/branchManger/branchManager.routes.js";
import adminRouter from "./routes/admin/admin.routes.js";
import "./jobs/image.worker.js";
import "./jobs/cleanup.worker.js";
import "./jobs/bookingExpiry.worker.js";

// Initialize passport AFTER env vars are loaded
initializePassport();

const app = express();

app.use(cors({
    origin: ["http://localhost:5173", "https://wowrentals-staging.office-09d.workers.dev"],
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(helmet({
    "crossOriginResourcePolicy": false
}));
app.use(passport.initialize());
app.use("/api/auth", authrouter);
app.use("/api/public", vehiclerouter);
app.use("/api/payment", paymentrouter);
app.use("/api/user", userrouter);
app.use("/api/employee", employeerouter);
app.use("/api/branchManager", branchManagerRouter);
app.use("/api/admin", adminRouter);

app.get("/health", (req: Request, res: Response) => {
    return res.status(StatusCode.OK).json({
        uptime: process.uptime(),
        message: "Server is running",
        date: new Date()
    });
});

app.listen(process.env._PORT, () => {
    console.log(`The Server is Running on ${process.env._PORT}`);
});