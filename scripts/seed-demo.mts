/** Seeds a demo account so the live preview is clickable immediately. */
import { Client } from "pg";
import bcrypt from "bcryptjs";

const pg = new Client({ connectionString: process.env.DATABASE_URL! });
await pg.connect();
const email = "demo@modaya.dev";
await pg.query("delete from users where email=$1", [email]);
const { rows: [u] } = await pg.query(
  "insert into users (email,password_hash) values ($1,$2) returning id",
  [email, await bcrypt.hash("demo12345", 10)],
);
const { rows: [p] } = await pg.query(
  "insert into projects (user_id,name) values ($1,'My first edit') returning id", [u.id],
);
await pg.query("insert into timelines (project_id, clips) values ($1,'{\"clips\":[],\"captions\":[]}'::jsonb)", [p.id]);
console.log(`demo@modaya.dev / demo12345  → project ${p.id}`);
await pg.end();
