import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");

const c = new Client({
  connectionString: url,
  ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});
await c.connect();
await c.query(fs.readFileSync(path.join(process.cwd(), "src/db/migrate.sql"), "utf8"));
await c.end();
console.log("migrations applied");
