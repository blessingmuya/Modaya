/** Phase 0 smoke test: real Postgres persistence + real HTTP auth-gated routes. */
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const url = process.env.DATABASE_URL!;
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
};

const c = new Client({ connectionString: url });
await c.connect();

const email = `smoke-${Date.now()}@modaya.dev`;
const { rows: [user] } = await c.query(
  "insert into users (email, password_hash) values ($1,$2) returning id",
  [email, await bcrypt.hash("supersecret1", 10)],
);
ok(!!user?.id, "user row persisted in Postgres");

const { rows: [proj] } = await c.query(
  "insert into projects (user_id, name) values ($1,$2) returning id",
  [user.id, "Smoke project"],
);
await c.query("insert into timelines (project_id, clips) values ($1,'[]'::jsonb)", [proj.id]);
const { rows: back } = await c.query("select name from projects where id=$1", [proj.id]);
ok(back[0]?.name === "Smoke project", "project row readable back from Postgres");

const landing = await fetch(`${BASE}/`);
const html = await landing.text();
ok(landing.status === 200 && html.includes("Modaya"), "landing page renders (200)");
ok(html.includes("#0B0C11") || html.includes("bg-base") || html.includes("text-mint"), "landing uses the design-system tokens");

const anon = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
ok([307, 302, 303].includes(anon.status), `unauthenticated /dashboard redirects (${anon.status})`);

const token = await new SignJWT({ sub: user.id })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(secret);
const auth = await fetch(`${BASE}/dashboard`, { headers: { cookie: `modaya_session=${token}` } });
const dash = await auth.text();
ok(auth.status === 200, "authenticated /dashboard renders");
ok(dash.includes(email), "dashboard shows the signed-in user");
ok(dash.includes("Smoke project"), "dashboard lists the persisted project");
ok(dash.includes("New project"), "dashboard exposes the New project action");

await c.query("delete from users where id=$1", [user.id]);
const { rows: gone } = await c.query("select 1 from projects where id=$1", [proj.id]);
ok(gone.length === 0, "cascade delete cleans up project rows");
await c.end();
