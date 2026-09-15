/**
 * Phase 1 smoke test: real upload → object storage → server-side ffmpeg → real MP4.
 * Exercises the HTTP API exactly as the browser does, with a real session cookie.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const SAMPLE = process.env.SMOKE_SAMPLE || "/tmp/sample.mp4";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
};
const probeDur = (f: string) =>
  Number(
    execFileSync(ffprobeInstaller.path, [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f,
    ]).toString().trim(),
  );

const pg = new Client({ connectionString: process.env.DATABASE_URL! });
await pg.connect();
const email = `p1-${Date.now()}@modaya.dev`;
const { rows: [user] } = await pg.query(
  "insert into users (email,password_hash) values ($1,$2) returning id",
  [email, await bcrypt.hash("supersecret1", 10)],
);
const { rows: [project] } = await pg.query(
  "insert into projects (user_id,name) values ($1,'Phase 1 smoke') returning id",
  [user.id],
);
const token = await new SignJWT({ sub: user.id })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
const H = { cookie: `modaya_session=${token}` };
const api = (p: string, init: RequestInit = {}) =>
  fetch(`${BASE}${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

// 1. Upload
const srcDur = probeDur(SAMPLE);
const fd = new FormData();
fd.set("file", new File([fs.readFileSync(SAMPLE)], "sample.mp4", { type: "video/mp4" }));
fd.set("role", "source");
const up = await api(`/api/projects/${project.id}/upload`, { method: "POST", body: fd });
const upJson = await up.json();
ok(up.ok, `upload accepted (${up.status})`);
ok(Math.abs((upJson.asset?.durationSec ?? 0) - srcDur) < 0.5, `ffprobe recorded duration ${upJson.asset?.durationSec?.toFixed?.(2)}s`);
ok(upJson.asset?.width === 640 && upJson.asset?.height === 360, "ffprobe recorded resolution");

// bytes really are in object storage
const { rows: [asset] } = await pg.query("select storage_key from media_assets where id=$1", [upJson.asset.id]);
ok(!!asset?.storage_key?.startsWith(`projects/${project.id}/source/`), "asset stored under an object-storage key");

// 2. Reset timeline to full source, then cut the middle out
await api(`/api/projects/${project.id}/timeline`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "reset" }),
});
const cutRes = await api(`/api/projects/${project.id}/timeline`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "remove_ranges", ranges: [{ start: 3, end: 8 }] }),
});
const cut = await cutRes.json();
ok(cutRes.ok, "remove_ranges accepted");
ok(cut.timeline.clips.length === 2, `cut split the timeline into 2 clips (got ${cut.timeline.clips.length})`);
ok(Math.abs(cut.duration - (srcDur - 5)) < 0.3, `timeline duration dropped by 5s (${cut.duration.toFixed(2)}s)`);

// clamping: an out-of-range cut must not extend beyond the media
const clampRes = await api(`/api/projects/${project.id}/timeline`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "remove_ranges", ranges: [{ start: 9999, end: 10005 }] }),
});
ok(clampRes.status === 400, "out-of-range cut rejected instead of corrupting the timeline");

// 3. Export
const t0 = Date.now();
const exp = await api(`/api/projects/${project.id}/export`, { method: "POST" });
const expJson = await exp.json();
ok(exp.ok && !!expJson.job?.id, "export job queued");

let job: { status: string; error?: string } = { status: "queued" };
let downloadUrl: string | null = null;
for (let i = 0; i < 180; i++) {
  const r = await api(`/api/jobs/${expJson.job.id}`);
  const d = await r.json();
  job = d.job;
  downloadUrl = d.downloadUrl;
  if (job.status === "done" || job.status === "error") break;
  await new Promise((r) => setTimeout(r, 1000));
}
const elapsed = (Date.now() - t0) / 1000;
ok(job.status === "done", `render finished (status=${job.status}${job.error ? `: ${job.error}` : ""})`);
ok(!!downloadUrl, "signed download URL issued");

// 4. Download and verify the real MP4
if (downloadUrl) {
  const bin = Buffer.from(await (await fetch(downloadUrl)).arrayBuffer());
  fs.writeFileSync("/tmp/p1-export.mp4", bin);
  const outDur = probeDur("/tmp/p1-export.mp4");
  ok(bin.length > 1000, `downloaded a real file (${(bin.length / 1e3).toFixed(0)} KB)`);
  ok(bin.subarray(4, 8).toString() === "ftyp", "file is a real MP4 container");
  ok(Math.abs(outDur - (srcDur - 5)) < 0.6, `export is ${outDur.toFixed(2)}s — actually shorter than the ${srcDur.toFixed(2)}s source`);
  ok(elapsed < srcDur, `rendered faster than real time (${elapsed.toFixed(1)}s for ${outDur.toFixed(1)}s of video)`);
}

// 5. Determinism: same spec re-exported reuses the same completed job
const again = await api(`/api/projects/${project.id}/export`, { method: "POST" });
const againJson = await again.json();
ok(againJson.job?.id === expJson.job.id, "identical spec is deduplicated to the same render (deterministic)");

await pg.query("delete from users where id=$1", [user.id]);
await pg.end();
