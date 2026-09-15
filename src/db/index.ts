import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Modaya requires a real Postgres database — there is no in-memory fallback.",
  );
}

const globalForDb = globalThis as unknown as { __modayaPool?: Pool };

export const pool =
  globalForDb.__modayaPool ??
  new Pool({
    connectionString: url,
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: 8,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__modayaPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
