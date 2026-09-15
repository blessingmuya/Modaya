import type { MediaAsset } from "@/lib/db/schema";
import { presignGet, type RequestContext } from "@/lib/storage/s3";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return "—";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Media rows with signed links straight to object storage. Nothing is proxied
 * through the app server: the browser fetches the object itself.
 */
export async function MediaList({
  assets,
  ctx,
  emptyLabel,
}: {
  assets: MediaAsset[];
  ctx: RequestContext;
  emptyLabel: string;
}) {
  if (assets.length === 0) {
    return (
      <p className="rounded-lg bg-base-900 px-4 py-3.5 text-[13px] text-faint ring-1 ring-line">
        {emptyLabel}
      </p>
    );
  }

  const rows = await Promise.all(
    assets.map(async (asset) => ({
      asset,
      streamUrl: await presignGet(ctx, {
        key: asset.bucketKey,
        expiresIn: 60 * 60 * 6,
      }),
      downloadUrl: await presignGet(ctx, {
        key: asset.bucketKey,
        filename: asset.filename,
        expiresIn: 60 * 60 * 6,
      }),
    })),
  );

  return (
    <ul className="grid gap-2.5">
      {rows.map(({ asset, streamUrl, downloadUrl }) => (
        <li
          key={asset.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-base-900 px-4 py-3.5 ring-1 ring-line"
        >
          <div className="min-w-0">
            <span className="block truncate text-[13.5px] text-ink">
              {asset.filename}
            </span>
            <span className="mono mt-0.5 block text-[11px] text-faint">
              {formatBytes(asset.sizeBytes)}
              {asset.width && asset.height
                ? ` · ${asset.width}×${asset.height}`
                : ""}
              {asset.durationSec
                ? ` · ${Number(asset.durationSec).toFixed(2)}s`
                : ""}
              {asset.fps ? ` · ${Number(asset.fps).toFixed(2)}fps` : ""} ·{" "}
              {asset.status}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {asset.kind === "video" && (
              <a
                className="btn btn-ghost btn-sm"
                href={streamUrl}
                target="_blank"
                rel="noreferrer"
              >
                Play
              </a>
            )}
            <a
              className="btn btn-ghost btn-sm"
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
            >
              Download
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
