import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");
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
import invoiceRouter from "./routes/invoice/invoice.routes.js";
import configRouter from "./routes/public/config.routes.js";
import { initImageWorker } from "./jobs/image.worker.js";
import { initCleanupWorker } from "./jobs/cleanup.worker.js";
import { initFileCleanupWorker } from "./jobs/fileCleanup.worker.js";
import { initBookingExpiryWorker } from "./jobs/bookingExpiry.worker.js";
import { initInvoiceWorker } from "./jobs/invoice.worker.js";

// Initialize passport AFTER env vars are loaded
initializePassport();

// Initialize all workers AFTER env vars are loaded
initImageWorker();
initCleanupWorker();
initFileCleanupWorker();
initBookingExpiryWorker();
initInvoiceWorker();

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://WUWrentals-staging.office-09d.workers.dev",
    ],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);
app.use(passport.initialize());
app.use("/api/auth", authrouter);
app.use("/api/public", vehiclerouter);
app.use("/api/payment", paymentrouter);
app.use("/api/user", userrouter);
app.use("/api/employee", employeerouter);
app.use("/api/branchManager", branchManagerRouter);
app.use("/api/admin", adminRouter);
app.use("/api/invoices", invoiceRouter);
app.use("/api/config", configRouter);

app.get("/health", (req: Request, res: Response) => {
  return res.status(StatusCode.OK).json({
    uptime: process.uptime(),
    message: "Server is running",
    date: new Date(),
  });
});

app.listen(process.env._PORT, () => {
  console.log(`The Server is Running on ${process.env._PORT}`);
});
