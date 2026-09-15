import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { ensureBucket } from '@/lib/storage/s3';
import { s3Bucket, s3Endpoint } from '@/lib/env';

/**
 * Real connectivity checks against the configured Postgres and object storage.
 * The dashboard shows the result so "it is configured" and "it is reachable"
 * are never conflated.
 */
export async function getStorageHealth(): Promise<{
  database: { ok: boolean; detail: string };
  bucket: { ok: boolean; bucket: string; detail: string };
}> {
  let databaseOk = false;
  let databaseDetail = '';
  try {
    await getDb().execute(sql`select 1`);
    databaseOk = true;
    databaseDetail = 'select 1 → ok';
  } catch (err) {
    databaseDetail = (err as Error).message;
  }

  const bucket = s3Bucket();
  let bucketOk = false;
  let bucketDetail = '';
  try {
    await ensureBucket();
    bucketOk = true;
    bucketDetail = `${s3Endpoint()} · bucket ${bucket}`;
  } catch (err) {
    bucketDetail = (err as Error).message;
  }

  return { database: { ok: databaseOk, detail: databaseDetail }, bucket: { ok: bucketOk, bucket, detail: bucketDetail } };
}
