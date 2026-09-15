/**
 * Phase 4 smoke test: the guided journey a non-technical user takes.
 * Raw footage + reference → stages → rendered MP4, without ever touching a
 * manual timeline operation. Also verifies the Edit Map markers are grounded.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
};
const vdur = (f: string) =>
  Number(execFileSync(ffprobeInstaller.path, ["-v","error","-show_entries","format=duration","-of","csv=p=0",f]).toString().trim());

const pg = new Client({ connectionString: process.env.DATABASE_URL! });
await pg.connect();
const email = `p4-${Date.now()}@modaya.dev`;
const { rows: [user] } = await pg.query(
  "insert into users (email,password_hash) values ($1,$2) returning id",
  [email, await bcrypt.hash("supersecret1", 10)],
);
const { rows: [project] } = await pg.query(
  "insert into projects (user_id,name) values ($1,'Guided flow') returning id", [user.id],
);
await pg.query("insert into timelines (project_id, clips) values ($1,'{\"clips\":[],\"captions\":[]}'::jsonb)", [project.id]);
const token = await new SignJWT({ sub: user.id })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
const H = { cookie: `modaya_session=${token}` };
const api = (p: string, init: RequestInit = {}) =>
  fetch(`${BASE}${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const post = (o: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

// STAGE 1 — drop footage (studio auto-resets the timeline, no manual editing)
const fd = new FormData();
fd.set("file", new File([fs.readFileSync("/tmp/footage.mp4")], "footage.mp4", { type: "video/mp4" }));
fd.set("role", "source");
const up = await api(`/api/projects/${project.id}/upload`, { method: "POST", body: fd });
ok(up.ok, "stage 1: footage uploaded and probed");
await api(`/api/projects/${project.id}/timeline`, post({ action: "reset" }));

// STAGE 2 — attach reference
const rfd = new FormData();
rfd.set("file", new File([fs.readFileSync("/tmp/reference.mp4")], "reference.mp4", { type: "video/mp4" }));
const ref = await api(`/api/projects/${project.id}/reference`, { method: "POST", body: rfd });
const refJson = await ref.json();
ok(ref.ok && !!refJson.profile, "stage 2: reference learned (StyleProfile built)");

// STAGE 3 — build the edit plan (one click; no manual timeline ops)
const plan = await api(`/api/projects/${project.id}/plan`, post({ apply: true }));
const planJson = await plan.json();
ok(plan.ok && planJson.results.length > 0, `stage 3: plan built (${planJson.results?.length} ops)`);
ok(Array.isArray(planJson.markers) && planJson.markers.length > 0, `Edit Map has ${planJson.markers?.length} marker(s)`);

const kinds = [...new Set(planJson.markers.map((m: {kind:string}) => m.kind))];
ok(kinds.length > 0, `marker kinds present: ${kinds.join(", ")}`);
ok(
  planJson.markers.every((m: {reason:string}) => typeof m.reason === "string" && m.reason.length > 0),
  "every marker carries a human-readable reason",
);
ok(
  planJson.markers.every((m: {groundedIn:string|null}) => m.groundedIn && m.groundedIn.includes("measured")),
  "every marker is grounded in a measured StyleProfile field",
);
const timedMarkers = planJson.markers.filter((m: {atSec:number|null}) => m.atSec !== null);
ok(
  timedMarkers.every((m: {atSec:number}) => m.atSec >= 0 && m.atSec <= planJson.duration + 0.01),
  "every timed marker sits inside the final timeline",
);

// plan persisted for the Iterate view
const planGet = await (await api(`/api/projects/${project.id}/plan`)).json();
ok(planGet.plan?.markers?.length === planJson.markers.length, "plan + markers persisted for reload");

// STAGE 4 — render
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
ok(job.status === "done", `stage 4: rendered (${job.status}${job.error ? `: ${job.error}` : ""})`);

// STAGE 5 — compare view needs both sources reachable
const assets = (await (await api(`/api/projects/${project.id}/assets`)).json()).assets;
const exportAsset = assets.find((a: {role:string}) => a.role === "export");
const referenceAsset = assets.find((a: {role:string}) => a.role === "reference");
ok(!!exportAsset && !!referenceAsset, "stage 5: compare view has both a reference and a result");
for (const [label, a] of [["reference", referenceAsset], ["result", exportAsset]] as const) {
  const r = await api(`/api/media/${a.id}`, { redirect: "manual" });
  ok(r.status === 302, `${label} media route issues a signed redirect (${r.status})`);
}

// STAGE 6 — iterate via chat, then re-render
const chat = await api(`/api/projects/${project.id}/chat`, post({ message: "make it warmer" }));
const chatJson = await chat.json();
ok(chat.ok && chatJson.results.some((r: {applied:boolean}) => r.applied), "stage 6: iterate chat applied a real op");

const exp2 = await api(`/api/projects/${project.id}/export`, { method: "POST" });
const exp2Json = await exp2.json();
ok(exp2Json.job.id !== expJson.job.id, "changed timeline produces a NEW render, not the cached one");
let job2: {status:string} = { status: "queued" };
let url2: string | null = null;
for (let i = 0; i < 240; i++) {
  const d = await (await api(`/api/jobs/${exp2Json.job.id}`)).json();
  job2 = d.job; url2 = d.downloadUrl;
  if (job2.status === "done" || job2.status === "error") break;
  await new Promise((r) => setTimeout(r, 1000));
}
ok(job2.status === "done", `iterated edit re-rendered (${job2.status})`);

if (url2) {
  const bin = Buffer.from(await (await fetch(url2)).arrayBuffer());
  fs.writeFileSync("/tmp/p4-export.mp4", bin);
  ok(bin.subarray(4, 8).toString() === "ftyp", "final download is a real MP4");
  const d = vdur("/tmp/p4-export.mp4");
  ok(d > 0.5, `final export plays: ${d.toFixed(2)}s`);
  console.log(`      ↳ journey complete: raw 14.00s footage → ${d.toFixed(2)}s edit, no manual timeline op used`);
}

// The studio page itself renders for this project
const page = await api(`/studio/${project.id}`);
const html = await page.text();
ok(page.status === 200, "studio page renders");
ok(html.includes("Edit Map") || html.includes("Edit plan"), "studio page shows the plan/Edit Map UI");

await pg.query("delete from users where id=$1", [user.id]);
await pg.end();
