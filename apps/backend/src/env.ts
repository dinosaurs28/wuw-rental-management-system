import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Look for .env in the backend root
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

console.log("[Env] Environment variables loaded");
