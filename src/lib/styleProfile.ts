import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ffmpeg, probe, run } from "./ffmpeg";

/**
 * StyleProfile — two clearly separated layers.
 *
 *  measured:        pure math over sampled frames + audio. No network, no key, no guessing.
 *                   This is the ONLY source of timestamps anywhere in Modaya.
 *  model_described: a multimodal model's words about technique. Never produces timestamps.
 *
 * Every field carries its source so the UI can never conflate the two.
 */

export type Sourced<T> = { value: T; source: "measured" | "model_described" };

export const measuredSchema = z.object({
  durationSec: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  aspect: z.string(),
  /** Cut timestamps in seconds, from frame-difference scene detection. */
  cutTimes: z.array(z.number()),
  cutCount: z.number(),
  cutsPerMinute: z.number(),
  shotLengths: z.array(z.number()),
  shotLengthMean: z.number(),
  shotLengthMedian: z.number(),
  shotLengthP10: z.number(),
  shotLengthP90: z.number(),
  audio: z.object({
    hasAudio: z.boolean(),
    rmsMeanDb: z.number().nullable(),
    rmsPeakDb: z.number().nullable(),
    /** Loudness onsets (seconds) — candidate beat/emphasis points. */
    onsetTimes: z.array(z.number()),
    onsetsPerMinute: z.number(),
    silentRanges: z.array(z.object({ start: z.number(), end: z.number() })),
  }),
  grade: z.object({
    /** Mean luma 0..1 across sampled frames. */
    brightness: z.number(),
    /** Std-dev of luma, a contrast proxy. */
    contrast: z.number(),
    /** Mean chroma distance from neutral, a saturation proxy. */
    saturation: z.number(),
    /** >0 warm (red-heavy), <0 cool (blue-heavy). */
    temperature: z.number(),
    meanRgb: z.tuple([z.number(), z.number(), z.number()]),
    framesSampled: z.number(),
  }),
});
export type Measured = z.infer<typeof measuredSchema>;

/** Strict schema for the model layer: unknown fields are stripped by zod, no timestamps allowed. */
export const modelDescribedSchema = z
  .object({
    shotTypes: z.array(z.string().max(60)).max(10).default([]),
    transitionStyle: z.string().max(300).default(""),
    captionStyle: z
      .object({
        present: z.boolean().default(false),
        position: z.enum(["top", "center", "bottom", "varies", "none"]).default("none"),
        description: z.string().max(300).default(""),
      })
      .default({ present: false, position: "none", description: "" }),
    pacingDescription: z.string().max(600).default(""),
    hookStructure: z.string().max(600).default(""),
    subjectFraming: z.string().max(300).default(""),
    confidence: z.enum(["low", "medium", "high"]).default("low"),
  })
  .strip();
export type ModelDescribed = z.infer<typeof modelDescribedSchema>;

export type StyleProfile = {
  version: 2;
  assetId: string;
  createdAt: string;
  measured: Measured;
  modelDescribed: ModelDescribed | null;
  modelStatus: "ok" | "no_key" | "error" | "skipped";
  modelError?: string;
  /** Explicit per-field provenance for the UI. */
  provenance: Record<string, "measured" | "model_described">;
};

const q = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return s[i];
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ------------------------- measured layer ------------------------- */

/** Scene-cut detection via ffmpeg's frame-difference scene score. */
async function detectCuts(file: string, threshold = 0.32): Promise<number[]> {
  const { FFMPEG } = await import("./ffmpeg");
  const r = await run(FFMPEG, [
    "-hide_banner", "-nostdin",
    "-i", file,
    "-filter_complex", `select='gt(scene,${threshold})',metadata=print:file=-`,
    "-f", "null", "-",
  ]);
  // Lines look like: `frame:0  pts:26201  pts_time:2.04695`
  const times = [...r.stdout.matchAll(/pts_time:([\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0.2);
  // De-duplicate cuts closer than 150ms (same transition reported twice).
  const out: number[] = [];
  for (const t of times) if (!out.length || t - out[out.length - 1] > 0.15) out.push(r3(t));
  return out;
}

/** Audio loudness: mean/peak dB, onsets from per-window RMS jumps, silence ranges. */
async function analyseAudio(file: string, hasAudio: boolean, duration: number) {
  if (!hasAudio) {
    return {
      hasAudio: false,
      rmsMeanDb: null,
      rmsPeakDb: null,
      onsetTimes: [] as number[],
      onsetsPerMinute: 0,
      silentRanges: [] as { start: number; end: number }[],
    };
  }

  const { FFMPEG } = await import("./ffmpeg");
  const volume = await run(FFMPEG, [
    "-hide_banner", "-nostdin", "-i", file, "-af", "volumedetect", "-f", "null", "-",
  ]);
  const meanDb = Number(/mean_volume: (-?[\d.]+) dB/.exec(volume.stderr)?.[1] ?? NaN);
  const peakDb = Number(/max_volume: (-?[\d.]+) dB/.exec(volume.stderr)?.[1] ?? NaN);

  // Silence ranges (real gaps a "cut the silences" op can use).
  const sil = await run(FFMPEG, [
    "-hide_banner", "-nostdin", "-i", file,
    "-af", "silencedetect=noise=-32dB:d=0.35",
    "-f", "null", "-",
  ]);
  const silentRanges: { start: number; end: number }[] = [];
  const startRe = /silence_start: (-?[\d.]+)/g;
  const endRe = /silence_end: (-?[\d.]+)/g;
  const starts = [...sil.stderr.matchAll(startRe)].map((m) => Number(m[1]));
  const ends = [...sil.stderr.matchAll(endRe)].map((m) => Number(m[1]));
  for (let i = 0; i < starts.length; i++) {
    const s = Math.max(0, starts[i]);
    const e = ends[i] ?? duration;
    if (e - s > 0.2) silentRanges.push({ start: r3(s), end: r3(Math.min(e, duration)) });
  }

  // Onsets: per-100ms RMS from astats, flagged where loudness jumps.
  const stats = await run(FFMPEG, [
    "-hide_banner", "-nostdin", "-i", file,
    "-af", "aformat=channel_layouts=mono,asetnsamples=n=4800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f", "null", "-",
  ]);
  const levels: { t: number; db: number }[] = [];
  let curT = 0;
  for (const line of stats.stdout.split("\n")) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) curT = Number(pts[1]);
    const lvl = /RMS_level=(-?[\d.inf]+)/.exec(line);
    if (lvl) {
      const db = Number(lvl[1]);
      if (Number.isFinite(db)) levels.push({ t: curT, db });
    }
  }
  const onsetTimes: number[] = [];
  for (let i = 1; i < levels.length; i++) {
    const jump = levels[i].db - levels[i - 1].db;
    if (jump > 7 && levels[i].db > -40) {
      const t = r3(levels[i].t);
      if (!onsetTimes.length || t - onsetTimes[onsetTimes.length - 1] > 0.2) onsetTimes.push(t);
    }
  }

  return {
    hasAudio: true,
    rmsMeanDb: Number.isFinite(meanDb) ? r3(meanDb) : null,
    rmsPeakDb: Number.isFinite(peakDb) ? r3(peakDb) : null,
    onsetTimes,
    onsetsPerMinute: duration > 0 ? r3((onsetTimes.length / duration) * 60) : 0,
    silentRanges,
  };
}

/** Grade estimate: average RGB statistics over evenly sampled frames. */
async function estimateGrade(file: string, duration: number, dir: string, samples = 12) {
  const times = Array.from({ length: samples }, (_, i) => ((i + 0.5) / samples) * duration);
  const rgb: [number, number, number][] = [];
  const lumas: number[] = [];

  for (let i = 0; i < times.length; i++) {
    const out = path.join(dir, `grade-${i}.rgb`);
    try {
      // Downscale to 16x16 raw RGB — cheap, exact, no image decoding library needed.
      await ffmpeg([
        "-ss", times[i].toFixed(3),
        "-i", file,
        "-frames:v", "1",
        "-vf", "scale=16:16",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        out,
      ]);
      const buf = await fs.readFile(out);
      let r = 0, g = 0, b = 0;
      const px = buf.length / 3;
      for (let p = 0; p < buf.length; p += 3) {
        r += buf[p];
        g += buf[p + 1];
        b += buf[p + 2];
      }
      r /= px; g /= px; b /= px;
      rgb.push([r, g, b]);
      lumas.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    } catch {
      /* unreadable sample point — skip */
    } finally {
      await fs.rm(out, { force: true });
    }
  }

  const mr = mean(rgb.map((c) => c[0]));
  const mg = mean(rgb.map((c) => c[1]));
  const mb = mean(rgb.map((c) => c[2]));
  const lumaMean = mean(lumas);
  const variance = mean(lumas.map((l) => (l - lumaMean) ** 2));
  const maxC = Math.max(mr, mg, mb);
  const minC = Math.min(mr, mg, mb);
  const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;

  return {
    brightness: r3(lumaMean),
    contrast: r3(Math.sqrt(variance)),
    saturation: r3(saturation),
    temperature: r3((mr - mb) / 255),
    meanRgb: [r3(mr), r3(mg), r3(mb)] as [number, number, number],
    framesSampled: rgb.length,
  };
}

export async function measureStyle(file: string): Promise<Measured> {
  const meta = await probe(file);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "modaya-measure-"));
  try {
    const [cutTimes, audio, grade] = await Promise.all([
      detectCuts(file),
      analyseAudio(file, meta.hasAudio, meta.durationSec),
      estimateGrade(file, meta.durationSec, dir),
    ]);

    // Shot lengths are the gaps between cuts, bounded by the clip ends.
    const bounds = [0, ...cutTimes, meta.durationSec];
    const shotLengths: number[] = [];
    for (let i = 1; i < bounds.length; i++) {
      const len = bounds[i] - bounds[i - 1];
      if (len > 0.05) shotLengths.push(r3(len));
    }

    const g = Math.max(1, meta.width && meta.height ? gcd(meta.width, meta.height) : 1);
    return measuredSchema.parse({
      durationSec: r3(meta.durationSec),
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      aspect: meta.width && meta.height ? `${meta.width / g}:${meta.height / g}` : "unknown",
      cutTimes,
      cutCount: cutTimes.length,
      cutsPerMinute: meta.durationSec > 0 ? r3((cutTimes.length / meta.durationSec) * 60) : 0,
      shotLengths,
      shotLengthMean: r3(mean(shotLengths)),
      shotLengthMedian: r3(q(shotLengths, 0.5)),
      shotLengthP10: r3(q(shotLengths, 0.1)),
      shotLengthP90: r3(q(shotLengths, 0.9)),
      audio,
      grade,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/* --------------------- model-described layer --------------------- */

/** Sample up to 8 evenly spaced frames as base64 JPEGs for the vision model. */
export async function sampleFrames(file: string, duration: number, n = 8) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "modaya-frames-"));
  const frames: { atSec: number; base64: string }[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * duration;
      const out = path.join(dir, `f${i}.jpg`);
      try {
        await ffmpeg([
          "-ss", t.toFixed(3), "-i", file, "-frames:v", "1",
          "-vf", "scale=512:-2", "-q:v", "6", out,
        ]);
        frames.push({ atSec: r3(t), base64: (await fs.readFile(out)).toString("base64") });
      } catch {
        /* skip */
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return frames;
}

const SYSTEM_PROMPT = `You describe the editing technique of a short-form video from sampled frames.
Rules:
- Describe technique only. Never invent timestamps, cut counts, durations, or numeric measurements — those are measured separately and yours would be wrong.
- If something is not visible in the frames, say so rather than guessing.
- Respond with JSON only, matching exactly this shape:
{"shotTypes":string[],"transitionStyle":string,"captionStyle":{"present":boolean,"position":"top"|"center"|"bottom"|"varies"|"none","description":string},"pacingDescription":string,"hookStructure":string,"subjectFraming":string,"confidence":"low"|"medium"|"high"}`;

/**
 * Optional vision layer. Requires OPENAI_API_KEY (or a compatible endpoint).
 * Without a key the profile is still fully usable — it's just measured-only.
 */
export async function describeStyle(
  frames: { atSec: number; base64: string }[],
  transcript: string | null,
): Promise<{ status: StyleProfile["modelStatus"]; data: ModelDescribed | null; error?: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { status: "no_key", data: null };
  if (!frames.length) return { status: "skipped", data: null, error: "no frames sampled" };

  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.MODAYA_VISION_MODEL || "gpt-4o-mini";

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Here are ${frames.length} frames sampled evenly across the reference video.${
                  transcript ? `\n\nTranscript:\n${transcript.slice(0, 4000)}` : ""
                }`,
              },
              ...frames.map((f) => ({
                type: "image_url" as const,
                image_url: { url: `data:image/jpeg;base64,${f.base64}`, detail: "low" as const },
              })),
            ],
          },
        ],
      }),
    });

    if (!res.ok) return { status: "error", data: null, error: `model HTTP ${res.status}` };
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return { status: "error", data: null, error: "empty model response" };

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return { status: "error", data: null, error: "model returned non-JSON" };
    }

    // Strict validation: unknown fields dropped, anything timestamp-shaped ignored.
    const parsed = modelDescribedSchema.safeParse(parsedJson);
    if (!parsed.success)
      return { status: "error", data: null, error: `schema rejected: ${parsed.error.issues[0]?.message}` };

    return { status: "ok", data: parsed.data };
  } catch (e) {
    return { status: "error", data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export const PROVENANCE: StyleProfile["provenance"] = {
  durationSec: "measured",
  fps: "measured",
  aspect: "measured",
  cutTimes: "measured",
  cutsPerMinute: "measured",
  shotLengthMedian: "measured",
  shotLengthP10: "measured",
  shotLengthP90: "measured",
  "audio.onsetTimes": "measured",
  "audio.silentRanges": "measured",
  "audio.rmsMeanDb": "measured",
  "grade.brightness": "measured",
  "grade.contrast": "measured",
  "grade.saturation": "measured",
  "grade.temperature": "measured",
  shotTypes: "model_described",
  transitionStyle: "model_described",
  captionStyle: "model_described",
  pacingDescription: "model_described",
  hookStructure: "model_described",
  subjectFraming: "model_described",
};

export async function buildStyleProfile(
  assetId: string,
  file: string,
  opts: { transcript?: string | null; skipModel?: boolean } = {},
): Promise<StyleProfile> {
  const measured = await measureStyle(file);
  let modelDescribed: ModelDescribed | null = null;
  let modelStatus: StyleProfile["modelStatus"] = "skipped";
  let modelError: string | undefined;

  if (!opts.skipModel) {
    const frames = await sampleFrames(file, measured.durationSec, 8);
    const described = await describeStyle(frames, opts.transcript ?? null);
    modelDescribed = described.data;
    modelStatus = described.status;
    modelError = described.error;
  }

  return {
    version: 2,
    assetId,
    createdAt: new Date().toISOString(),
    measured,
    modelDescribed,
    modelStatus,
    modelError,
    provenance: PROVENANCE,
  };
}
