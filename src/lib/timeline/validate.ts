import { z } from 'zod';
import type { TimelineSpec } from './spec';

/**
 * Server-side validation for timeline specs. Kept separate from spec.ts so the
 * browser bundle only carries the geometry helpers, not zod.
 */
export const clipSchema = z.object({
  id: z.string().min(1).max(64),
  assetId: z.string().uuid(),
  inSec: z.number().finite().min(0),
  outSec: z.number().finite().min(0),
});

export const timelineSpecSchema = z
  .object({
    version: z.literal(1),
    clips: z.array(clipSchema).min(1).max(400),
  })
  .refine((spec) => spec.clips.every((clip) => clip.outSec > clip.inSec), {
    message: 'Every clip must have outSec greater than inSec',
  });

export type ValidatedTimelineSpec = z.infer<typeof timelineSpecSchema>;

export function invalidSpecReason(spec: unknown): string | null {
  const result = timelineSpecSchema.safeParse(spec);
  if (result.success) return null;
  return result.error.issues
    .map((issue) => `${issue.path.join('.') || 'spec'}: ${issue.message}`)
    .join('; ');
}

export function parseSpec(spec: unknown): TimelineSpec | null {
  const result = timelineSpecSchema.safeParse(spec);
  return result.success ? (result.data as TimelineSpec) : null;
}
