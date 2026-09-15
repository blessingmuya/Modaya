import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  s3Bucket,
  s3Credentials,
  s3Endpoint,
  s3ForcePathStyle,
  s3PublicEndpointOverride,
  s3PublicPort,
  s3Region,
} from '@/lib/env';

function baseClientConfig(endpoint: string) {
  return {
    region: s3Region(),
    endpoint,
    forcePathStyle: s3ForcePathStyle(),
    credentials: s3Credentials(),
    // Cloudflare R2 and s3rver both prefer the classic checksum behaviour.
    requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    responseChecksumValidation: 'WHEN_REQUIRED' as const,
  };
}

/** Server-side client. Talks to the internal endpoint. */
export function serverS3(): S3Client {
  return new S3Client(baseClientConfig(s3Endpoint()));
}

/**
 * The browser cannot reach an internal endpoint (and behind a port proxy it
 * cannot reach 127.0.0.1 at all), so browser-facing URLs are signed against the
 * public endpoint. The Host header is part of the SigV4 signature, so the client
 * we sign with must already point at the public host.
 */
export function browserEndpointFor(req: { host: string | null; proto: string }): string {
  const override = s3PublicEndpointOverride();
  if (override) return override;

  const host = req.host ?? '';
  // e.g. "3000-abc123.e2b.app" -> "4569-abc123.e2b.app"
  const proxied = host.match(/^\d+-([^:]+)(?::\d+)?$/);
  if (proxied && !/^(localhost|127\.0\.0\.1)$/.test(host.split(':')[0])) {
    return `${req.proto}://${s3PublicPort()}-${proxied[1]}`;
  }
  const parsed = new URL(s3Endpoint());
  return `${parsed.protocol}//${parsed.hostname}:${s3PublicPort()}`;
}

function clientForEndpoint(endpoint: string): S3Client {
  return new S3Client(baseClientConfig(endpoint));
}

export type RequestContext = { host: string | null; proto: string };

type HeaderBag = { get(name: string): string | null };

export function requestContextFrom(headers: HeaderBag): RequestContext {
  const forwardedHost = headers.get('x-forwarded-host');
  const host = forwardedHost ?? headers.get('host');
  const forwardedProto = headers.get('x-forwarded-proto');
  const proto = forwardedProto ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  return { host, proto };
}

/** Same thing, but for server components where the request is on next/headers. */
export async function requestContextFromHeaders(): Promise<RequestContext> {
  const { headers } = await import('next/headers');
  const h = await headers();
  return requestContextFrom(h);
}

export async function presignPut(
  ctx: RequestContext,
  args: { key: string; contentType: string; expiresIn?: number },
): Promise<string> {
  const client = clientForEndpoint(browserEndpointFor(ctx));
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: args.key,
      ContentType: args.contentType,
    }),
    { expiresIn: args.expiresIn ?? 60 * 30 },
  );
}

export async function presignGet(
  ctx: RequestContext,
  args: { key: string; filename?: string; expiresIn?: number },
): Promise<string> {
  const client = clientForEndpoint(browserEndpointFor(ctx));
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: s3Bucket(),
      Key: args.key,
      ResponseContentDisposition: args.filename
        ? `attachment; filename="${args.filename.replace(/"/g, '')}"`
        : undefined,
    }),
    { expiresIn: args.expiresIn ?? 60 * 60 },
  );
}

/** Inline (playable) URL — no attachment disposition. */
export async function presignStream(
  ctx: RequestContext,
  args: { key: string; expiresIn?: number },
): Promise<string> {
  return presignGet(ctx, args);
}

export async function headObject(key: string) {
  return serverS3().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }));
}

export async function deleteObject(key: string) {
  await serverS3().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key }));
}

export async function putFile(key: string, filePath: string, contentType: string) {
  const info = await stat(filePath);
  await serverS3().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: info.size,
      Body: createReadStream(filePath),
    }),
  );
  return info.size;
}

export async function getFileTo(key: string, filePath: string) {
  const res = await serverS3().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }));
  if (!res.Body) throw new Error(`object ${key} has no body`);
  await pipeline(res.Body as Readable, createWriteStream(filePath));
}

export async function ensureBucket(): Promise<void> {
  const client = serverS3();
  try {
    await client.send(new HeadBucketCommand({ Bucket: s3Bucket() }));
    return;
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: s3Bucket() }));
    } catch (err) {
      console.warn('[s3] could not create bucket', (err as Error).message);
    }
  }
}
