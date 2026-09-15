import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ffmpeg, probe } from "./ffmpeg";
import { clipDuration, type Caption, type CaptionStyle, type Clip, type Timeline } from "./timeline";

export type RenderSpec = {
  clips: Clip[];
  captions: Caption[];
  captionStyle?: CaptionStyle;
  /** assetId -> storage key, so the hash covers the actual source bytes referenced. */
  sources: Record<string, string>;
};

export function specHash(spec: RenderSpec) {
  // Stable stringify: deterministic key ordering.
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return crypto.createHash("sha256").update(JSON.stringify(stable(spec))).digest("hex");
}

function gradeFilter(c: Clip): string[] {
  const f: string[] = [];
  const g = c.grade;
  if (g) {
    const eq: string[] = [];
    if (g.exposure !== undefined) eq.push(`brightness=${g.exposure.toFixed(4)}`);
    if (g.contrast !== undefined) eq.push(`contrast=${g.contrast.toFixed(4)}`);
    if (g.saturation !== undefined) eq.push(`saturation=${g.saturation.toFixed(4)}`);
    if (eq.length) f.push(`eq=${eq.join(":")}`);
    if (g.temperature !== undefined && Math.abs(g.temperature) > 1e-3) {
      // Warm (+) lifts red / drops blue; cool (-) the reverse.
      const t = Math.max(-1, Math.min(1, g.temperature));
      f.push(
        `colorchannelmixer=rr=${(1 + 0.15 * t).toFixed(4)}:bb=${(1 - 0.15 * t).toFixed(4)}`,
      );
    }
  }
  if (c.punchIn && c.punchIn > 1.001) {
    const z = Math.min(2, c.punchIn);
    f.push(`crop=iw/${z.toFixed(4)}:ih/${z.toFixed(4)}:(iw-iw/${z.toFixed(4)})/2:(ih-ih/${z.toFixed(4)})/2`);
  }
  return f;
}

function escapeDrawText(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%");
}

function captionFilters(captions: Caption[], style: CaptionStyle | undefined, height: number) {
  if (!captions.length) return [];
  const st: CaptionStyle = {
    position: style?.position ?? "bottom",
    fontSizePct: style?.fontSizePct ?? 6,
    uppercase: style?.uppercase ?? false,
  };
  const size = Math.max(12, Math.round((st.fontSizePct / 100) * (height || 1080)));
  const y =
    st.position === "top" ? `${Math.round(size * 0.8)}` : st.position === "center" ? "(h-th)/2" : `h-th-${Math.round(size)}`;
  return captions.map((c) => {
    const text = escapeDrawText(st.uppercase ? c.text.toUpperCase() : c.text);
    return [
      `drawtext=text='${text}'`,
      `fontcolor=white`,
      `fontsize=${size}`,
      `box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.35)}`,
      `x=(w-tw)/2`,
      `y=${y}`,
      `enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'`,
    ].join(":");
  });
}

/**
 * Render a timeline to a real MP4 with server-side ffmpeg.
 * Deterministic: identical spec + identical sources => identical output.
 */
export async function renderTimeline(
  spec: RenderSpec,
  localSources: Record<string, string>,
  onLog?: (line: string) => void,
): Promise<{ outPath: string; tmpDir: string; durationSec: number }> {
  const clips = spec.clips.filter((c) => clipDuration(c) > 0.02);
  if (!clips.length) throw new Error("Timeline has no clips with a positive duration.");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "modaya-render-"));
  const firstSrc = localSources[clips[0].assetId];
  if (!firstSrc) throw new Error(`Missing local file for asset ${clips[0].assetId}`);
  const meta = await probe(firstSrc);
  const width = meta.width || 1280;
  const height = meta.height || 720;
  const fps = meta.fps && meta.fps > 0 ? Math.min(meta.fps, 60) : 30;

  onLog?.(`source ${width}x${height}@${fps} — ${clips.length} clip(s)`);

  // Step 1: render each clip as a normalised intermediate segment (accurate seek).
  const segPaths: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const src = localSources[c.assetId];
    if (!src) throw new Error(`Missing local file for asset ${c.assetId}`);
    const out = path.join(tmpDir, `seg-${String(i).padStart(4, "0")}.mp4`);
    const vf = [
      ...gradeFilter(c),
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      `fps=${fps}`,
      `setsar=1`,
    ].join(",");

    const args = [
      "-ss", c.start.toFixed(3),
      "-to", c.end.toFixed(3),
      "-i", src,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-video_track_timescale", "90000",
    ];
    if (meta.hasAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
    else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-shortest", "-c:a", "aac", "-b:a", "128k");
    args.push("-movflags", "+faststart", out);

    await ffmpeg(args);
    segPaths.push(out);
    onLog?.(`rendered segment ${i + 1}/${clips.length} (${clipDuration(c).toFixed(2)}s)`);
  }

  // Step 2: concat the segments.
  const concatPath = path.join(tmpDir, "concat.txt");
  await fs.writeFile(concatPath, segPaths.map((p) => `file '${p}'`).join("\n"), "utf8");
  const joined = path.join(tmpDir, "joined.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-movflags", "+faststart", joined]);
  onLog?.("concatenated segments");

  // Step 3: burn captions (timeline-time), if any.
  let outPath = joined;
  const capFilters = captionFilters(spec.captions ?? [], spec.captionStyle, height);
  if (capFilters.length) {
    outPath = path.join(tmpDir, "out.mp4");
    await ffmpeg([
      "-i", joined,
      "-vf", capFilters.join(","),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outPath,
    ]);
    onLog?.(`burned ${capFilters.length} caption(s)`);
  }

  const outMeta = await probe(outPath);
  return { outPath, tmpDir, durationSec: outMeta.durationSec };
}

export function timelineToSpec(t: Timeline, sources: Record<string, string>): RenderSpec {
  return {
    clips: t.clips,
    captions: t.captions ?? [],
    captionStyle: t.captionStyle,
    sources,
  };
}
