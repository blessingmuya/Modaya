import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

/**
 * Object storage. Cloudflare R2 / any S3-compatible endpoint.
 * There is no local-filesystem fallback path: media always lives in object storage.
 * (In dev we point S3_ENDPOINT at a local S3-compatible server — still the S3 API.)
 */
const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION || "auto";
export const BUCKET = process.env.S3_BUCKET || "modaya";

export const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

export function mediaKey(projectId: string, role: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `projects/${projectId}/${role}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safe}`;
}

export async function signedUpload(key: string, contentType: string, expiresIn = 900) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function signedDownload(key: string, expiresIn = 3600, filename?: string) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
        : {}),
    }),
    { expiresIn },
  );
}

export async function headObject(key: string) {
  return s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = res.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
