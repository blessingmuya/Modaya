/**
 * Object keys are deterministic and namespaced per project so that a whole
 * project's media can be enumerated/expired with a single prefix.
 */
export function sourceKey(projectId: string, assetId: string, filename: string): string {
  return `projects/${projectId}/source/${assetId}/${sanitize(filename)}`;
}

export function exportKey(projectId: string, exportId: string, ext = 'mp4'): string {
  return `projects/${projectId}/exports/${exportId}/out.${ext}`;
}

export function scratchKey(projectId: string, name: string): string {
  return `projects/${projectId}/scratch/${sanitize(name)}`;
}

export function sanitize(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
}
