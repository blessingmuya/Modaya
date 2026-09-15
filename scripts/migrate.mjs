#!/usr/bin/env node
/**
 * Applies every .sql file in ./drizzle in filename order, recording each in a
 * _migrations table so re-running is a no-op. Deliberately small and explicit:
 * you can read exactly what has been applied to the database.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://modaya:modaya@127.0.0.1:55432/modaya';

const dir = join(process.cwd(), 'drizzle');
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  : [];

if (files.length === 0) {
  console.log('[migrate] no migration files found in ./drizzle');
}

const client = new pg.Client({ connectionString: DATABASE_URL });
try {
  await client.connect();
} catch (err) {
  console.error(`[migrate] cannot reach Postgres at ${DATABASE_URL}`);
  console.error(`[migrate] ${err.message}`);
  console.error('[migrate] start local infrastructure first: npm run infra');
  process.exit(1);
}

await client.query(`
  create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`);

const { rows } = await client.query('select name from _migrations');
const applied = new Set(rows.map((r) => r.name));

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(dir, file), 'utf8');
  process.stdout.write(`[migrate] applying ${file} … `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into _migrations(name) values($1)', [file]);
    await client.query('commit');
    console.log('ok');
    count += 1;
  } catch (err) {
    await client.query('rollback');
    console.log('FAILED');
    console.error(err.message);
    await client.end();
    process.exit(1);
  }
}

console.log(
  count === 0 ? '[migrate] database is up to date' : `[migrate] applied ${count} migration(s)`,
);
await client.end();
