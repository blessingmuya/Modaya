# Modaya

Drop your footage and a reference clip. Modaya **measures** the reference (cuts, shot lengths,
audio onsets, grade), plans a validated list of edit operations, and renders a real MP4 with
**server-side ffmpeg**.

Built to the v2 phased spec. Phases 0–4 are complete and covered by executable smoke tests that
verify behaviour against ground truth, not just HTTP 200s.

---

## What it actually does (honest scope)

"Style matching" here means two clearly separated things, and the UI never conflates them:

| Layer | How it's produced | What it's used for |
| --- | --- | --- |
| **measured** | Pure math over the video's pixels and audio: ffmpeg scene-score frame differencing, `silencedetect`, per-window RMS onsets, 16×16 RGB frame sampling. No network, no API key. | **Every timestamp Modaya uses.** Cut placement, silence removal, punch-in points, colour grade. |
| **model-described** | A multimodal model's read of 8 sampled frames: shot types, transition style, caption style, pacing and hook structure, in words. Optional — needs `OPENAI_API_KEY`. | Descriptive context and caption styling only. **Never a source of timestamps or numbers.** |

The system prompt forbids the model from emitting timestamps, the response is strictly
schema-validated, and unknown fields are dropped. If no key is configured, the product still works
end to end — it's just measured-only, and the UI says so.

Modaya does not understand your reference the way a human editor does. It measures its rhythm and
colour, and maps those measurements onto your footage.

---

## Architecture

```
Browser ──> Next.js 15 (App Router, RSC + route handlers)
              │
              ├── Postgres          accounts, projects, timeline, jobs, style profiles, plans
              ├── S3/R2             all media bytes (source, reference, exports)
              └── render_jobs table job queue (SELECT … FOR UPDATE SKIP LOCKED)
                      │
                      └──> ffmpeg worker ──> MP4 ──> object storage ──> signed download URL
```

**Non-negotiables held from the v1 postmortem:**

- No in-memory or IndexedDB persistence. `src/db/index.ts` throws at import if `DATABASE_URL`
  is unset — there is no fallback path.
- No browser render path. Export is always server-side ffmpeg. The browser only ever *previews*.
- No cosmetic controls. Every button in the Studio invokes a real operation.
- The LLM never touches the timeline. It emits operations from a fixed vocabulary, all of which are
  parsed, clamped and validated server-side before reaching the queue.

### Determinism

The ffmpeg worker consumes the timeline (ordered clips referencing source time ranges) and nothing
else. The render spec is stable-stringified and SHA-256 hashed; an identical spec is deduplicated to
the existing completed render rather than re-encoded.

### The operation vocabulary

`remove_ranges` · `keep_ranges` · `trim_to` · `add_captions` · `punch_in` · `grade`

Everything else is discarded. Timestamps are clamped to the real media duration, zoom is clamped to
1.0–2.0×, saturation to 0–3, and an operation that would empty the timeline is refused outright.

---

## Running locally

```bash
npm install
cp .env.example .env.local     # then fill it in, or use the sandbox defaults below
npm run dev:infra              # dev only: real Postgres + real S3-compatible endpoint
npm run dev
```

`dev:infra` exists because some sandboxes have no Docker. It boots an actual PostgreSQL server
(`embedded-postgres`) and an actual S3-API server, then applies migrations. The application code is
identical in dev and production — it only ever speaks Postgres and the S3 API.

Against real infrastructure, skip `dev:infra` and point the env at Neon/Supabase and R2:

```bash
DATABASE_URL=postgres://…?sslmode=require
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_BUCKET=modaya
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
AUTH_SECRET=$(openssl rand -base64 32)
OPENAI_API_KEY=…          # optional; enables the model-described layer + LLM chat planning
npm run db:migrate
```

### Deployment note

The render worker runs in-process and shells out to ffmpeg, so deploy to a container host
(Fly.io, Railway, Render) rather than Vercel's serverless functions. The job table is already
concurrency-safe, so scaling to a separate worker process is a matter of running `tick()` in its
own container.

---

## Tests

Each phase has an executable smoke test that runs against the live server and real Postgres.

```bash
npm run dev:infra &
npm run dev &
npx tsx --env-file=.env.local scripts/smoke-phase0.mts   # auth + persistence + shell
npx tsx --env-file=.env.local scripts/smoke-phase1.mts   # upload → cut → real MP4 export
npx tsx --env-file=.env.local scripts/smoke-phase2.mts   # StyleProfile vs. ground truth
npx tsx --env-file=.env.local scripts/smoke-phase3.mts   # op validation + grounded plan
npx tsx --env-file=.env.local scripts/smoke-phase4.mts   # full guided journey
```

They assert real properties, e.g.:

- Phase 1 exports a 7.04s MP4 from a 12s source, faster than real time, and re-exporting the same
  spec is deduplicated.
- Phase 2 builds a reference with **known** cuts at 2/4/6/8/10s and requires 5/5 detected
  timestamps within 0.3s, plus a median shot length within 0.4s of the 2s ground truth.
- Phase 3 feeds in a bogus op type, an out-of-range cut, `saturation: 99` and `zoom: 50`, and
  requires them to be dropped, refused and clamped respectively.
- Phase 4 goes raw footage + reference → downloaded MP4 without a single manual timeline operation,
  and asserts every Edit Map marker is grounded in a `measured.*` field.

---

## Phase status

- **Phase 0 — Foundation.** Auth (email/password, JWT sessions), Postgres schema, R2/S3 signed
  upload + download, landing page and dashboard from real components on the dark/mint token set.
- **Phase 1 — Render pipeline.** Upload → object storage → job queue → ffmpeg worker → real
  downloadable MP4. Deterministic, deduplicated, faster than real time.
- **Phase 2 — StyleProfile.** Measured layer (cuts, shot lengths, RMS/onsets, silences, grade) plus
  an optional strictly-validated model-described layer, rendered as an inspectable panel with
  per-field provenance.
- **Phase 3 — AI edit ops.** Chat and reference planning both emit only validated operations.
  Cut placement and grading come from the measured layer; every applied op reports its
  `groundedIn` StyleProfile field.
- **Phase 4 — Studio UX.** Guided stages, Reference-vs-Result compare with synced playback, and a
  clickable Edit Map where each marker shows the grounded reason behind it.

Phases 5 (clipping, captions at scale, multi-format) and 6 (rate limits, billing, observability)
are not started, by design.
