/**
 * Phase 2 smoke test: StyleProfile from a reference video.
 * Uses a synthetic reference with KNOWN cuts so the measured layer can be verified
 * against ground truth, not just "it returned something".
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
};
const FF = ffmpegInstaller.path;

// Build a reference with 5 hard cuts at ~2s intervals: colour changes every 2s.
const REF = "/tmp/reference.mp4";
if (!fs.existsSync(REF) || process.env.FORCE_REF) {
  const parts: string[] = [];
  const colors = ["red", "blue", "green", "yellow", "white", "black"];
  colors.forEach((c, i) => {
    const p = `/tmp/ref-part-${i}.mp4`;
    execFileSync(FF, [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", `color=c=${c}:s=640x360:r=25:d=2`,
      "-f", "lavfi", "-i", `sine=frequency=${300 + i * 120}:duration=2`,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", p,
    ], { stdio: "ignore" });
    parts.push(p);
  });
  fs.writeFileSync("/tmp/ref-list.txt", parts.map((p) => `file '${p}'`).join("\n"));
  execFileSync(FF, ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", "/tmp/ref-list.txt", "-c", "copy", REF], { stdio: "ignore" });
}

const pg = new Client({ connectionString: process.env.DATABASE_URL! });
await pg.connect();
const { rows: [user] } = await pg.query(
  "insert into users (email,password_hash) values ($1,$2) returning id",
  [`p2-${Date.now()}@modaya.dev`, await bcrypt.hash("supersecret1", 10)],
);
const { rows: [project] } = await pg.query(
  "insert into projects (user_id,name) values ($1,'Phase 2 smoke') returning id",
  [user.id],
);
const token = await new SignJWT({ sub: user.id })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
const H = { cookie: `modaya_session=${token}` };

const fd = new FormData();
fd.set("file", new File([fs.readFileSync(REF)], "reference.mp4", { type: "video/mp4" }));
const res = await fetch(`${BASE}/api/projects/${project.id}/reference`, {
  method: "POST", headers: H, body: fd,
});
const body = await res.json();
ok(res.ok, `reference analysed (${res.status})`);

const p = body.profile;
const m = p?.measured;
ok(!!m, "profile has a measured layer");
ok(Math.abs(m.durationSec - 12) < 0.5, `measured duration ${m?.durationSec}s`);

// Ground truth: 5 colour changes at 2,4,6,8,10s.
const truth = [2, 4, 6, 8, 10];
ok(m.cutCount >= 4 && m.cutCount <= 6, `detected ${m.cutCount} cuts (ground truth: 5)`);
const matched = truth.filter((t) => m.cutTimes.some((c: number) => Math.abs(c - t) < 0.3));
ok(matched.length >= 4, `${matched.length}/5 cut timestamps land within 0.3s of ground truth`);
ok(Math.abs(m.shotLengthMedian - 2) < 0.4, `median shot length ${m.shotLengthMedian}s (ground truth 2s)`);
ok(m.cutsPerMinute > 20 && m.cutsPerMinute < 32, `cuts/min ${m.cutsPerMinute}`);

// Grade layer
ok(m.grade.framesSampled >= 8, `grade sampled ${m.grade.framesSampled} frames`);
ok(m.grade.brightness > 0 && m.grade.brightness < 1, `brightness ${m.grade.brightness} in range`);
ok(typeof m.grade.temperature === "number", "temperature estimated");

// Audio layer
ok(m.audio.hasAudio === true, "audio track detected");
ok(typeof m.audio.rmsMeanDb === "number", `mean RMS ${m.audio.rmsMeanDb} dB`);

// Layer separation
ok(p.provenance.cutTimes === "measured", "cutTimes labelled measured");
ok(p.provenance.pacingDescription === "model_described", "pacingDescription labelled model_described");
ok(["ok", "no_key", "error", "skipped"].includes(p.modelStatus), `model layer status: ${p.modelStatus}`);
ok(
  p.modelStatus !== "ok" || p.modelDescribed !== null,
  "model layer present iff it succeeded",
);
const modelJson = JSON.stringify(p.modelDescribed ?? {});
ok(!/\bat\s?Sec|timestamp|cutTimes/i.test(modelJson), "model layer contains no timestamp fields");

// Persisted
const { rows: stored } = await pg.query("select profile from style_profiles where project_id=$1", [project.id]);
ok(stored.length === 1, "StyleProfile persisted in Postgres");
ok(stored[0].profile.measured.cutCount === m.cutCount, "persisted profile matches the response");

// Re-fetch via GET
const get = await fetch(`${BASE}/api/projects/${project.id}/reference`, { headers: H });
const g = await get.json();
ok(g.profile?.measured?.cutCount === m.cutCount, "GET returns the stored profile");

await pg.query("delete from users where id=$1", [user.id]);
await pg.end();
