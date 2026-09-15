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

**Render pipeline (Phase 1)**

Upload → object storage → probe job → timeline spec → render job → object storage →
signed download URL. Specifically:

- Uploads go browser → bucket with a presigned PUT. On completion the app HEADs the object to
  confirm it exists, then queues a `probe_media` job. ffprobe never runs on the request path.
- A timeline is an ordered list of `{assetId, inSec, outSec}` clips. Every edit is a pure
  function over that list (`src/lib/timeline/ops.ts`), so cut/trim/concat are testable without
  ffmpeg and always produce the same spec for the same edit.
- `planRender` resolves a spec against source metadata into a fully determined plan; from there
  the ffmpeg argument vector is a pure function of the plan. Fixed encoder settings, no source
  metadata, bitexact flags. `tests/render.test.ts` asserts two runs produce byte-identical files.
- Renders run in a separate worker process that claims rows from `jobs` with
  `SELECT … FOR UPDATE SKIP LOCKED`, reports real encoder progress from ffmpeg's `-progress`
  stream, retries transient failures up to 3 attempts, and requeues jobs whose worker died.
- Exports land in object storage and are handed to the browser as signed URLs.

**Style profile: measured vs model-described**

A `StyleProfile` has two layers that are never merged. The panel in the studio renders them
side by side, each labelled with its source.

- **measured** — deterministic, free, offline, no key required.
  - Sampling: 64×36 RGB frames at 8 fps and 16 kHz mono PCM, piped straight out of ffmpeg.
  - Cut detection: mean absolute frame-to-frame difference, thresholded at
    `max(6, median + 4 · 1.4826·MAD)`. Median/MAD rather than mean/stdev on purpose: the real cuts
    inflate a mean/stdev threshold above themselves, so a clip with two hard cuts and no other
    motion would report zero cuts. Cuts must also be local maxima with a 0.25 s refractory period.
  - The profile states its own precision (`±0.125 s`, the sampling interval) instead of implying
    frame accuracy.
  - Shot lengths, RMS/onset envelope, silence ranges, and colour statistics (channel means, luma
    contrast as σ, HSV saturation, R−B warmth) are all computed from those samples.
  - Loudness is reported two ways: mean over active windows, and mean including silence. Averaging
    dB across digital silence drags the number down to a meaningless value, so both are shown.
- **model_described** — optional, needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Up to 8 frames
  (the midpoints of the longest shots — measurement drives the sampling) plus an embedded subtitle
  transcript if the file has one. The response is validated against a strict schema: unknown fields
  are dropped, missing fields take declared defaults, and the schema has no timestamp fields at all,
  so timing can only ever come from the measured layer. Time-shaped prose is kept but flagged in the
  panel's caveats.

If no key is configured the UI states that the layer is unavailable rather than inventing content.
`MEASURED_SCHEMA_VERSION` versions the measured blob: a profile recorded by an older build renders
its missing fields as “—” with a re-analyze prompt, never as a plausible-looking number.

## Design tokens

The visual direction is a light canvas with one saturated accent. Every colour lives in the `@theme`
block of `src/app/globals.css`; components reference semantic classes (`bg-surface`, `text-muted`,
`border-line`) rather than hex values, so the whole app follows from that one file. Mint stays the
accent — the surfaces, hairlines and text tiers were re-tuned for light backgrounds rather than the
accent being replaced.

Light backgrounds make contrast a real constraint rather than a detail. `tests/contrast.test.ts`
parses the token block and asserts WCAG AA (4.5:1) for each text/background pair the UI renders. It
found genuine problems on the first pass: a tertiary text tier at 2.6:1, and several accent-on-tint
pairs just under the line. A light canvas cannot fit four text tiers at AA while keeping them
visually distinct — the first attempt landed two tiers 1.007x apart, which is one tier, not two — so
the ladder is three measured tiers.

## Project status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Foundation: auth, Postgres, object storage, landing page, dashboard | done |
| 1 | Real render + export pipeline (upload → ffmpeg → MP4 download) | done |
| 2 | Reference style engine (measured + model-described) | done |
| 3 | AI edit ops (chat-driven editing) | in progress — ops layer done, model call + UI pending |
| 4 | Studio UX | not started |
| 5 | Growth features (clipping, captions at scale, multi-format) | not started |
| 6 | Production hardening | not started |

## Tests

```bash
npm test
```

The render tests execute the real ffmpeg filter graph and compare **pre-encode** frames. Encoded
output is the wrong instrument for asking whether an effect stayed inside its window: x264 rate
control looks ahead across the whole stream, so a changed segment perturbs its neighbours by ~0.5%
SSIM even when the pixels are identical.

Tests that touch the database or object storage expect `npm run infra` to be running.
