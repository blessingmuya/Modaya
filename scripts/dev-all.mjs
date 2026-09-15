#!/usr/bin/env node
/**
 * One command for a complete local stack:
 *   1. local infra (real Postgres + real S3-compatible storage) if not already up
 *   2. database migrations
 *   3. the ffmpeg job worker
 *   4. the Next.js app on 0.0.0.0:3000
 *
 * Everything is bound to 0.0.0.0 so it works behind a port proxy.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';

const ROOT = process.cwd();
const PG_PORT = Number(process.env.PG_PORT ?? 55432);
const S3_PORT = Number(process.env.S3_PORT ?? 4569);

const children = [];
let shuttingDown = false;

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(700);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

async function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function run(name, command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
    ...opts,
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev] ${name} exited (code=${code} signal=${signal})`);
    shutdown(code ?? 1);
  });
  children.push({ name, child });
  return child;
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 400));
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1. Infrastructure ----------------------------------------------------------
const infraUp = (await portOpen(PG_PORT)) && (await portOpen(S3_PORT));
if (infraUp) {
  console.log('[dev] postgres + object storage already running');
} else {
  console.log('[dev] starting postgres + object storage');
  run('infra', 'node', ['scripts/dev-infra.mjs']);
  const ready = (await waitForPort(PG_PORT)) && (await waitForPort(S3_PORT));
  if (!ready) {
    console.error('[dev] infrastructure did not come up in time');
    process.exit(1);
  }
}

// 2. Migrations --------------------------------------------------------------
await new Promise((resolve) => {
  const child = spawn('node', ['scripts/migrate.mjs'], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code !== 0) {
      console.error('[dev] migrations failed');
      process.exit(1);
    }
    resolve();
  });
});

// 3. Worker ------------------------------------------------------------------
// Watch mode: editing the pipeline reloads the worker, so a dev session cannot
// silently keep running yesterday's renderer. The worker finishes an in-flight
// job before exiting on SIGTERM, so a reload does not kill an active render.
if (existsSync(join(ROOT, 'src/worker/index.ts'))) {
  run('worker', 'npx', ['tsx', 'watch', '--clear-screen=false', 'src/worker/index.ts']);
} else {
  console.log('[dev] no worker entry yet, skipping');
}

// 4. App ---------------------------------------------------------------------
run('next', 'npx', ['next', 'dev', '-H', '0.0.0.0', '-p', '3000']);

setInterval(() => {}, 1 << 30);
