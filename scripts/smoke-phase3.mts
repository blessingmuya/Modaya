/**
 * Phase 3 smoke test: chat-driven ops + reference-grounded edit plan → real export.
 * Verifies validation/clamping, grounding traceability, and that the plan really
 * changes the rendered file.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
};
const dur = (f: string) =>
  Number(execFileSync(ffprobeInstaller.path, ["-v","error","-show_entries","format=duration","-of","csv=p=0",f]).toString().trim());

// Footage: 14s with two real silent gaps (3–5s and 9–11s) and speech-ish tone elsewhere.
const FOOTAGE = "/tmp/footage.mp4";
if (!fs.existsSync(FOOTAGE) || process.env.FORCE_FOOTAGE) {
  execFileSync(ffmpegInstaller.path, [
    "-hide_banner","-y",
    "-f","lavfi","-i","testsrc=size=640x360:rate=25:duration=14",
    "-f","lavfi","-i","sine=frequency=440:duration=14",
    "-filter_complex","[1:a]volume='if(between(t,3,5)+between(t,9,11),0,1)':eval=frame[a]",
    "-map","0:v","-map","[a]",
    "-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p","-c:a","aac","-shortest",
    FOOTAGE,
  ], { stdio: "ignore" });
}
const REF = "/tmp/reference.mp4";

const pg = new Client({ connectionString: process.env.DATABASE_URL! });
await pg.connect();
const { rows: [user] } = await pg.query(
  "insert into users (email,password_hash) values ($1,$2) returning id",
  [`p3-${Date.now()}@modaya.dev`, await bcrypt.hash("supersecret1", 10)],
);
const { rows: [project] } = await pg.query(
  "insert into projects (user_id,name) values ($1,'Phase 3 smoke') returning id", [user.id],
);
const token = await new SignJWT({ sub: user.id })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
const H = { cookie: `modaya_session=${token}` };
const api = (p: string, init: RequestInit = {}) =>
  fetch(`${BASE}${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const json = (o: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

// Upload footage + reference
const fd = new FormData();
fd.set("file", new File([fs.readFileSync(FOOTAGE)], "footage.mp4", { type: "video/mp4" }));
fd.set("role", "source");
await api(`/api/projects/${project.id}/upload`, { method: "POST", body: fd });
await api(`/api/projects/${project.id}/timeline`, json({ action: "reset" }));

const rfd = new FormData();
rfd.set("file", new File([fs.readFileSync(REF)], "reference.mp4", { type: "video/mp4" }));
const refRes = await api(`/api/projects/${project.id}/reference`, { method: "POST", body: rfd });
ok(refRes.ok, "reference attached and profiled");

// --- validation: unknown op types dropped, timestamps clamped ---
const bad = await api(`/api/projects/${project.id}/plan`, json({
  apply: false,
  ops: [
    { op: "delete_everything", nuke: true },
    { op: "remove_ranges", ranges: [{ start: 9000, end: 9500 }] },
    { op: "grade", saturation: 99 },
    { op: "punch_in", at: 2, durationSec: 1, zoom: 50 },
  ],
}));
const badJson = await bad.json();
ok(bad.ok, "op validation endpoint responded");
ok(badJson.dropped.length === 1, `unknown op type dropped (${badJson.dropped.length})`);
const rr = badJson.results;
ok(rr.find((r: {op:{op:string}}) => r.op.op === "remove_ranges")?.applied === false, "out-of-range remove_ranges refused, timeline untouched");
const gradeNote = rr.find((r: {op:{op:string}}) => r.op.op === "grade")?.note ?? "";
ok(/saturation=3\.000/.test(gradeNote), `saturation 99 clamped to 3 (${gradeNote})`);
const punchNote = rr.find((r: {op:{op:string}}) => r.op.op === "punch_in")?.note ?? "";
ok(/2\.00×/.test(punchNote), `zoom 50 clamped to 2.00x (${punchNote})`);

// --- chat: cut the silences (measured, no key needed) ---
const beforeT = await (await api(`/api/projects/${project.id}/timeline`)).json();
const chat = await api(`/api/projects/${project.id}/chat`, json({ message: "cut the silences" }));
const chatJson = await chat.json();
ok(chat.ok, "chat endpoint responded");
ok(chatJson.results.some((r: {op:{op:string};applied:boolean}) => r.op.op === "remove_ranges" && r.applied), "chat produced an applied remove_ranges op");
ok(chatJson.duration < beforeT.duration - 2, `silences removed: ${beforeT.duration.toFixed(2)}s → ${chatJson.duration.toFixed(2)}s`);

// --- reference plan: grounded ops ---
await api(`/api/projects/${project.id}/timeline`, json({ action: "reset" }));
const plan = await api(`/api/projects/${project.id}/plan`, json({ apply: true }));
const planJson = await plan.json();
ok(plan.ok, "reference edit plan built");
ok(planJson.results.length > 0, `plan produced ${planJson.results.length} op(s)`);
const applied = planJson.results.filter((r: {applied:boolean}) => r.applied);
ok(applied.length > 0, `${applied.length} op(s) applied to the timeline`);
ok(applied.every((r: {groundedIn?:string}) => typeof r.groundedIn === "string" && r.groundedIn.includes("measured")),
   "every applied op traces back to a measured StyleProfile field");
for (const r of applied) console.log(`      ↳ ${r.op.op}: ${r.groundedIn}`);
ok(applied.some((r: {op:{op:string}}) => r.op.op === "grade"), "plan includes a grade derived from the reference's measured colour stats");

// --- export the planned edit ---
const exp = await api(`/api/projects/${project.id}/export`, { method: "POST" });
const expJson = await exp.json();
let job: {status:string;error?:string} = { status: "queued" };
let url: string | null = null;
for (let i = 0; i < 240; i++) {
  const d = await (await api(`/api/jobs/${expJson.job.id}`)).json();
  job = d.job; url = d.downloadUrl;
  if (job.status === "done" || job.status === "error") break;
  await new Promise((r) => setTimeout(r, 1000));
}
ok(job.status === "done", `planned edit rendered (${job.status}${job.error ? `: ${job.error}` : ""})`);
if (url) {
  const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync("/tmp/p3-export.mp4", bin);
  const outDur = dur("/tmp/p3-export.mp4");
  ok(bin.subarray(4, 8).toString() === "ftyp", "planned export is a real MP4");
  ok(outDur > 0.5 && outDur < 14, `export is ${outDur.toFixed(2)}s, shorter than the 14s source`);
  ok(Math.abs(outDur - planJson.duration) < 0.7, `rendered duration matches the planned timeline (${outDur.toFixed(2)}s vs ${planJson.duration.toFixed(2)}s)`);
}

await pg.query("delete from users where id=$1", [user.id]);
await pg.end();
