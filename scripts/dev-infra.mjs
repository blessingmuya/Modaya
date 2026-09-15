#!/usr/bin/env node
/**
 * Local development infrastructure.
 *
 * Runs a REAL PostgreSQL server (the official binaries, shipped via npm) and a
 * REAL S3-compatible server (s3rver). Nothing here changes how the app talks to
 * storage: local dev and production both use the Postgres wire protocol and the
 * S3 API. There is no local-fs or in-memory code path in the application.
 *
 * Data lives in ./var (gitignored) and survives restarts.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import S3rver from 's3rver';

const ROOT = process.cwd();
const VAR = join(ROOT, 'var');
const PG_DATA = join(VAR, 'pgdata');
const S3_DATA = join(VAR, 's3');

const PG_PORT = Number(process.env.PG_PORT ?? 55432);
const S3_PORT = Number(process.env.S3_PORT ?? 4569);
const BUCKET = process.env.S3_BUCKET ?? 'modaya-media';

const CORS_CONFIG = `<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

mkdirSync(VAR, { recursive: true });
mkdirSync(S3_DATA, { recursive: true });

// ---------------------------------------------------------------- Postgres ---
const pg = new EmbeddedPostgres({
  databaseDir: PG_DATA,
  user: 'modaya',
  password: 'modaya',
  port: PG_PORT,
  persistent: true,
});

const firstRun = !existsSync(join(PG_DATA, 'PG_VERSION'));

try {
  if (firstRun) {
    console.log('[infra] initialising Postgres cluster in var/pgdata');
    await pg.initialise();
  }
  await pg.start();
  console.log(`[infra] postgres listening on 127.0.0.1:${PG_PORT}`);
  if (firstRun) {
    await pg.createDatabase('modaya');
    console.log('[infra] created database "modaya"');
  }
} catch (err) {
  if (/already exists/i.test(String(err?.message))) {
    console.log('[infra] postgres already running');
  } else {
    console.error('[infra] postgres failed to start:', err?.message ?? err);
    process.exit(1);
  }
}

// ---------------------------------------------------------- Object storage ---
const s3 = new S3rver({
  port: S3_PORT,
  address: '0.0.0.0',
  silent: false,
  directory: S3_DATA,
  // The app always speaks path-style S3 (https://host/bucket/key). Behind a port
  // proxy the Host header is the proxy's, not localhost, so vhost bucket
  // detection would otherwise rewrite the path and 404 every request.
  vhostBuckets: false,
  configureBuckets: [{ name: BUCKET, configs: [CORS_CONFIG] }],
});

await s3.run();
console.log(`[infra] s3-compatible storage listening on 0.0.0.0:${S3_PORT} (bucket: ${BUCKET})`);
console.log('[infra] ready');

async function shutdown(signal) {
  console.log(`\n[infra] ${signal} received, stopping`);
  try {
    await s3.close();
  } catch {}
  try {
    await pg.stop();
  } catch {}
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep the process alive.
setInterval(() => {}, 1 << 30);
