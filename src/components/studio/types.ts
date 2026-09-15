import type { Timeline } from "@/lib/timeline";
import type { StyleProfile } from "@/lib/styleProfile";
import type { Marker } from "@/lib/markers";

export type AssetLite = {
  id: string;
  role: string;
  filename: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number | null;
};

export type JobLite = { id: string; status: string; error: string | null; createdAt: string };

export type OpResult = {
  op: { op: string; reason?: string };
  applied: boolean;
  note: string;
  groundedIn?: string | null;
};

export type StudioProps = {
  projectId: string;
  projectName: string;
  initialAssets: AssetLite[];
  initialTimeline: Timeline;
  initialJobs: JobLite[];
  initialProfile: StyleProfile | null;
  initialPlan: { results: OpResult[]; markers: Marker[] } | null;
};

export type Stage = "footage" | "reference" | "plan" | "render" | "compare" | "iterate";
