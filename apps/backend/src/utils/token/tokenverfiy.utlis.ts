import jwt from "jsonwebtoken";
import { config } from "dotenv";
config();
export const jwtverfiy = async (token: string) => {
  return await jwt.verify(token, process.env.JWT_SECERT!);
};
