/**
 * Dev infrastructure for sandboxes without Docker:
 *  - a real Postgres server (embedded-postgres, actual postgres binary)
 *  - a real S3-compatible object store (s3rver) spoken to over the S3 API
 *
 * Production points DATABASE_URL at Neon/Supabase and S3_ENDPOINT at R2 instead.
 * Application code never knows the difference — it only ever uses Postgres + the S3 API.
 */
import EmbeddedPostgres from "embedded-postgres";
import S3rver from "s3rver";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.MODAYA_DEV_DATA || path.join(process.cwd(), ".devdata");
const PG_DIR = path.join(ROOT, "pg");
const S3_DIR = path.join(ROOT, "s3");
const PG_PORT = Number(process.env.DEV_PG_PORT || 54329);
const S3_PORT = Number(process.env.DEV_S3_PORT || 54330);

fs.mkdirSync(S3_DIR, { recursive: true });

async function main() {
  const fresh = !fs.existsSync(path.join(PG_DIR, "PG_VERSION"));
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: "modaya",
    password: "modaya",
    port: PG_PORT,
    persistent: true,
  });
  if (fresh) {
    console.log("[dev-infra] initialising postgres cluster…");
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase("modaya");
  } catch {
    /* already exists */
  }
  console.log(`[dev-infra] postgres ready on ${PG_PORT}`);

  const s3 = new S3rver({
    port: S3_PORT,
    address: "127.0.0.1",
    silent: true,
    directory: S3_DIR,
    configureBuckets: [{ name: process.env.S3_BUCKET || "modaya", configs: [] }],
  });
  await s3.run();
  console.log(`[dev-infra] s3 endpoint ready on ${S3_PORT}`);

  // Apply schema migrations.
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: `postgres://modaya:modaya@127.0.0.1:${PG_PORT}/modaya`,
  });
  await client.connect();
  await client.query(fs.readFileSync(path.join(process.cwd(), "src/db/migrate.sql"), "utf8"));
  await client.end();
  console.log("[dev-infra] schema applied");

  const shutdown = async () => {
    await pg.stop().catch(() => {});
    await s3.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
