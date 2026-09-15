/**
 * Environment configuration.
 *
 * Modaya is designed so that there is exactly one storage path and one database
 * path in every environment. Local development runs a *real* Postgres server and
 * a *real* S3-compatible server (see scripts/dev-infra.mjs) — the application
 * code never falls back to local-fs or in-memory persistence.
 */

function req(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function opt(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const DEV_DATABASE_URL = 'postgresql://modaya:modaya@127.0.0.1:55432/modaya';

export function databaseUrl(): string {
  return opt('DATABASE_URL', DEV_DATABASE_URL);
}

/*
 * There is deliberately no session signing key here. A session token is 32 bytes
 * of CSPRNG output and only its SHA-256 hash is stored, so possession of the
 * token *is* the credential — there is nothing to sign and no secret to rotate.
 * (A previous `sessionSecret()` threw in production claiming to be required; it
 * was never called. Verified: production mode signs up and authenticates with
 * the variable unset.)
 */

export function appUrl(): string {
  return opt('APP_URL', 'http://localhost:3000');
}

/** Endpoint the *server* uses to talk to object storage (may be an internal address). */
export function s3Endpoint(): string {
  return opt('S3_ENDPOINT', 'http://127.0.0.1:4569');
}

/** Endpoint the *browser* uses. Derived per-request when not pinned. */
export function s3PublicEndpointOverride(): string {
  return opt('S3_PUBLIC_ENDPOINT');
}

export function s3Region(): string {
  return opt('S3_REGION', 'auto');
}

export function s3Bucket(): string {
  return opt('S3_BUCKET', 'modaya-media');
}

export function s3Credentials(): { accessKeyId: string; secretAccessKey: string } {
  return {
    accessKeyId: req('S3_ACCESS_KEY_ID', 'S3RVER'),
    secretAccessKey: req('S3_SECRET_ACCESS_KEY', 'S3RVER'),
  };
}

export function s3ForcePathStyle(): boolean {
  return opt('S3_FORCE_PATH_STYLE', 'true') !== 'false';
}

/**
 * Port that browsers should use for object storage when we are running behind a
 * host-based port proxy (Arena preview, Codespaces, etc).
 */
export function s3PublicPort(): string {
  return opt('S3_PORT', '4569');
}

/**
 * Multimodal model access for the Phase 2/3 layers. Everything that touches an
 * LLM is optional and explicitly reported as absent in the UI when unconfigured.
 */
export function visionProvider(): 'openai' | 'anthropic' | 'none' {
  const explicit = opt('MODAYA_VISION_PROVIDER');
  if (explicit === 'openai' || explicit === 'anthropic') return explicit;
  if (explicit === 'none') return 'none';
  if (opt('OPENAI_API_KEY')) return 'openai';
  if (opt('ANTHROPIC_API_KEY')) return 'anthropic';
  return 'none';
}

export function openAiConfig(): { apiKey: string; baseUrl: string; model: string } {
  return {
    apiKey: opt('OPENAI_API_KEY'),
    baseUrl: opt('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    model: opt('MODAYA_VISION_MODEL', 'gpt-4o-mini'),
  };
}

export function anthropicConfig(): { apiKey: string; baseUrl: string; model: string } {
  return {
    apiKey: opt('ANTHROPIC_API_KEY'),
    baseUrl: opt('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
    model: opt('MODAYA_VISION_MODEL', 'claude-3-5-sonnet-latest'),
  };
}

export function workerPollMs(): number {
  return Number(opt('WORKER_POLL_MS', '1500'));
}

export function mediaRootDir(): string {
  return opt('MODAYA_WORK_DIR', `${process.cwd()}/var/work`);
}
