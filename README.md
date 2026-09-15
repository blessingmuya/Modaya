# Modaya

Edit video by describing the result, not the timeline.

Modaya takes your footage, optionally learns from a reference video, and renders a real MP4 on the
server with ffmpeg. It is built so that the boring parts are real from commit one: Postgres for
data, S3-compatible object storage for media, and a server-side render pipeline — no
browser-capture exports, no IndexedDB persistence, no cosmetic controls.

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| App | Next.js 15 (App Router) + TypeScript | Server components for data, route handlers for writes |
| Database | Postgres via Drizzle ORM | Neon-compatible; local dev runs real Postgres binaries |
| Object storage | S3-compatible (Cloudflare R2) | Signed-URL upload/download; the app never proxies media |
| Auth | Email + password, server-side sessions | Session tokens are stored hashed; cookie is httpOnly |
| Rendering | ffmpeg worker process | Deterministic op list → deterministic MP4 |
| Queue | `jobs` table + `SELECT … FOR UPDATE SKIP LOCKED` | A real worker, no Redis required |

## Local development

```bash
npm install
npm run dev:all      # infra + migrations + worker + Next.js on 0.0.0.0:3000
```

`npm run dev:all` starts:

1. **Postgres 18** on `127.0.0.1:55432` — the official binaries, shipped via npm
   (`embedded-postgres`). Data persists in `var/pgdata` (gitignored).
2. **S3-compatible storage** on `0.0.0.0:4569` (`s3rver`), objects in `var/s3`.
3. Migrations from `./drizzle`, then the ffmpeg job worker, then Next.js.

Local development uses exactly the same code paths as production: the Postgres wire protocol and
the S3 API. There is no local-filesystem or in-memory fallback anywhere in the app.

Individual pieces:

```bash
npm run infra        # just Postgres + object storage
npm run db:migrate   # apply ./drizzle/*.sql
npm run dev          # just Next.js
npm run worker       # just the ffmpeg job worker
npm run db:generate  # generate a migration from src/lib/db/schema.ts
```

### Running behind a port proxy

When the app is served from a host other than `localhost` (Arena preview, Codespaces, a tunnel),
the browser cannot reach `127.0.0.1`. Modaya signs browser-facing object-storage URLs against a
**derived public endpoint**: from a request whose host is `3000-<suffix>` it signs for
`<S3_PORT>-<suffix>`. Pin it explicitly with `S3_PUBLIC_ENDPOINT` when your setup differs.

## Production

Three pieces, deployed separately:

1. **App** — Vercel (or Fly/Railway). Set `DATABASE_URL` (Neon pooled), `SESSION_SECRET`,
   `APP_URL`, and the `S3_*` variables pointing at your R2 bucket.
2. **Worker** — `npm run worker` on a host that has ffmpeg (Fly/Railway container). ffmpeg is
   resolved from `@ffmpeg-installer/ffmpeg`, so a plain Node image is enough. Serverless hosts are
   not suitable: renders are long-running processes.
3. **Database** — Neon Postgres. Run `npm run db:migrate` as a deploy step.

Environment variables are documented in `.env.example`. Generate `SESSION_SECRET` with
`openssl rand -hex 32`.

### Cloudflare R2 bucket CORS

Direct-to-bucket uploads need a CORS rule on the bucket:

```json
[
  {
    "AllowedOrigins": ["https://your-app-domain"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## Architecture notes

**Reality rules this codebase follows**

- Every control in the UI calls a real operation. If a feature is not wired up, the control is not
  rendered.
- Exports are computed server-side by ffmpeg and stored as objects. The browser is a client, never
  a renderer.
- The renderer is deterministic: a timeline spec plus a set of operations always produces the same
  output bytes. `tests/render.test.mjs` asserts this.
- Style matching is stated in terms of what it measures. See "Style profile" below.

**Style profile: measured vs model-described**

A `StyleProfile` has two layers that are never merged:

- `measured` — deterministic, free, offline. Cut detection from frame-to-frame differences, shot
  lengths, RMS/onset envelope from decoded PCM, and grade statistics (channel means, contrast,
  saturation). Every timestamp in the system comes from this layer.
- `model_described` — optional, needs an API key. Up to 8 sampled frames plus the transcript go to
  a multimodal model, which returns structured JSON describing shot types, transition style,
  caption style/position and hook structure in words. Validated strictly; unknown fields dropped;
  timestamps are stripped rather than trusted.

If no model key is configured, the UI says the layer is unavailable instead of inventing content.

## Project status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Foundation: auth, Postgres, object storage, landing page, dashboard | done |
| 1 | Real render + export pipeline (upload → ffmpeg → MP4 download) | in progress |
| 2 | Reference style engine (measured + model-described) | not started |
| 3 | AI edit ops (chat-driven editing) | not started |
| 4 | Studio UX | not started |
| 5 | Growth features (clipping, captions at scale, multi-format) | not started |
| 6 | Production hardening | not started |

## Tests

```bash
npm test
```

Tests that touch the database or object storage expect `npm run infra` to be running.
