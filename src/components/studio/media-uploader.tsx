"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "signing" | "uploading" | "confirming" | "done" | "error";

type Role = "source" | "reference";

/**
 * Real upload path: ask the server for a signed URL, PUT the bytes straight into
 * object storage, then ask the server to confirm against the stored object.
 * No file bytes pass through the Next.js server.
 */
export function MediaUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<Role>("source");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(file: File) {
    setPhase("signing");
    setProgress(0);
    setMessage(file.name);

    try {
      const presign = await fetch(`/api/projects/${projectId}/media/presign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          role,
        }),
      });
      const signed = (await presign.json().catch(() => ({}))) as {
        assetId?: string;
        uploadUrl?: string;
        error?: string;
      };
      if (!presign.ok || !signed.uploadUrl || !signed.assetId) {
        throw new Error(signed.error ?? "Could not get an upload URL.");
      }

      setPhase("uploading");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.uploadUrl!, true);
        xhr.setRequestHeader(
          "content-type",
          file.type || "application/octet-stream",
        );
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(
                new Error(`Storage rejected the upload (HTTP ${xhr.status}).`),
              );
        xhr.onerror = () =>
          reject(new Error("Upload failed — storage is unreachable."));
        xhr.send(file);
      });

      setPhase("confirming");
      const confirm = await fetch(`/api/media/${signed.assetId}/complete`, {
        method: "POST",
      });
      if (!confirm.ok) {
        const data = (await confirm.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Storage did not have the object.");
      }

      setPhase("done");
      setMessage(`${file.name} uploaded`);
      router.refresh();
    } catch (err) {
      setPhase("error");
      setMessage((err as Error).message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy =
    phase === "signing" || phase === "uploading" || phase === "confirming";

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-full bg-base-900 p-0.5 ring-1 ring-line">
          {(["source", "reference"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              disabled={busy}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${
                role === r
                  ? "bg-mint-400 font-medium text-base-950"
                  : "text-muted hover:text-ink"
              }`}
            >
              {r === "source" ? "My footage" : "Reference"}
            </button>
          ))}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />

        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy
            ? phaseLabel(phase)
            : `Choose ${role === "source" ? "footage" : "a reference"}`}
        </button>

        <span className="text-[12.5px] text-faint">
          Uploads go straight to object storage. 2 GB max.
        </span>
      </div>

      {busy && (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-mint-400 transition-[width] duration-150"
              style={{
                width: `${phase === "uploading" ? progress : phase === "signing" ? 3 : 99}%`,
              }}
            />
          </div>
        </div>
      )}

      {message && (
        <p
          className={`mt-3 text-[12.5px] ${
            phase === "error" ? "text-danger-400" : "text-muted"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "signing":
      return "Signing URL…";
    case "uploading":
      return "Uploading…";
    case "confirming":
      return "Verifying…";
    default:
      return "Working…";
  }
}
