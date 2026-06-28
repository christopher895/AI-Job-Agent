import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — check Railway Variables tab");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway.app") ? { rejectUnauthorized: false } : false,
});
