import { Request } from "express";

declare global {
    namespace Express {
        interface Request {
            customer_public_id?: string;
        }
    }
}
