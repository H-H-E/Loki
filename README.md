# Loki Lyrics

Preserve the song. Rewrite the story.

A React/TypeScript manuscript editor rebuilt for [H-H-E/Loki](https://github.com/H-H-E/Loki). Stable lyric identities, explicit revision contracts and invented demo lyrics make editing and exports usable without provider credentials. Vercel serves the frontend and private API; Neon Postgres stores accounts, sessions and manuscripts through Better Auth.

## Run and verify

Use Node.js 22, as specified in `.nvmrc` and the Vercel project settings.

```sh
npm ci
cp .env.example .env.local
npm run dev:full
```

`dev:full` runs the editor at `http://localhost:4173` with its same-origin API proxy. `npm run dev` runs the editor alone. Manual source import, diagnostics, history, rehearsal and exports work without external credentials. Private saving needs Neon and an account; live catalogue and generation also need their server-side provider credentials. Missing configuration produces an actionable error.

```sh
npm run check
npm run test:sites
```

`check` runs TypeScript checks, the automated test suite and a production build. The build preserves the provided hosting template and emits browser assets to `dist/client`. CI runs these checks without database or model credentials; mocked boundary tests are not live service certification.

## Configure Neon and authentication

1. Create a Neon project or connect Neon to the Vercel project through the [Vercel Marketplace](https://vercel.com/marketplace/neon). Use a database near the Vercel Functions region and copy its **pooled** Postgres connection string with SSL enabled into server-only `DATABASE_URL`. Set `DATABASE_URL_UNPOOLED` to the direct connection string for migrations; the Neon integration provides both. Do not disable certificate verification.
2. Set a unique `BETTER_AUTH_SECRET` of at least 32 random characters. Keep it stable across deployments. Set `BETTER_AUTH_URL` to the exact application origin, for example `https://loki.example.com`. Local development uses `http://localhost:4173`.
3. Put the values in `.env.local` for local setup or supply them through a secure shell environment, then initialize the intended database before enabling cloud use:

```sh
npm run db:migrate
```

The migration loads `.env.local`, preserving values already supplied by the environment. It uses `DATABASE_URL_UNPOOLED` when present and requires it when `DATABASE_URL` has Neon's `-pooler` hostname. The direct connection keeps migration locks tied to one database session. It first installs Better Auth's account/session tables, then applies the checksummed application migration in a transaction under a migration lock. Run it against the intended database when deploying schema changes. `npm run build` does not migrate a production database, and deployment functions never create tables during requests.

4. Sign up with email and password in **Private cloud library**. Choose **Save this project** to enroll a local manuscript for debounced cloud saving. Other local manuscripts stay local until explicitly uploaded.

Better Auth stores account and session records in Neon and authenticates the browser with same-origin cookies. The frontend receives no database connection string, auth secret or public database API credential. Authentication endpoints live under `/api/auth/*`; owner-scoped manuscript operations run through `/api/projects`. Every database read and write checks the session's user ID on the server. The server derives ownership from that session rather than trusting browser-provided owner IDs.

Neon runtime access should use a database role restricted to Loki's required tables and functions. Migration privileges are needed during setup; use a distinct role for migration and switch `DATABASE_URL` back to the restricted runtime role when provisioning production access. Never put database or auth credentials into a `VITE_` variable.

Email/password accounts are supported. Email verification delivery, password-reset email and email-link sign-in are not configured by this application.

## Revisions and recovery

Cloud saves use a transaction, row lock and expected revision to reject stale writes. Server-side validation checks protected text and requires a source checkpoint for structural changes. Revision records retain prior manuscripts. A conflict pauses sync and preserves the browser draft; loading another revision first makes a local recovery copy.

If a writer unlocks a line and edits it before the debounce completes, sync saves the unlock with unchanged text first, then saves the text revision. Session switching clears the sync enrollment state. Local drafts and portable recovery JSON remain usable without an account. Existing manuscripts in a previous remote backend are not automatically copied; export recovery JSON and import it before saving to Neon.

## Configure catalogue and generation

All variables below are server-only. Leave unused provider credentials empty when running the local editor.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon pooled Postgres URL with SSL enabled; required for cloud and authenticated live APIs |
| `DATABASE_URL_UNPOOLED` | Direct Neon Postgres URL for migration locks; required for migrations when runtime uses a pooled URL |
| `BETTER_AUTH_SECRET` | Stable random secret of at least 32 characters |
| `BETTER_AUTH_URL` | Exact public HTTPS origin in Production; loopback HTTP allowed for local development |
| `EVERYSONG_API_KEY` | EverySong `/api/v2` catalogue and full lyric import |
| `LLM_BASE_URL` | OpenAI-compatible endpoint, for example `https://api.openai.com/v1` |
| `LLM_API_KEY` | Model-provider credential |
| `LLM_MODEL` | Explicit provider model identifier |

The browser sends cookie-authenticated requests only to the same-origin API. The source adapter allowlists provider operations, keeps recording/lyrics/streaming IDs distinct and treats absent metadata as unknown. Paste/import remains available when the provider is unavailable or lacks a recording. EverySong's documented text API does not supply verified lyric onsets or melody alignment.

Transactional quotas limit catalogue traffic to 30/minute and 250/day per user and a shared EverySong credential budget of 60/minute and 1,000/day. AI requests are limited to 8/minute and 40/day per user. These application defaults are independent of the provider's current account limits. Expired request-bucket rows can be removed periodically by privileged database maintenance. No lyric text or API secrets belong in analytics or request logs.

## Deploy on Vercel

1. Import this repository into Vercel with the repository root as the **Root Directory** and **Node.js 22.x** as the runtime.
2. The committed `vercel.json` selects Vite, `npm ci`, `npm run build` and `dist/client`. Root `api/` Node functions serve auth, project persistence, catalogue and generation. The auth rewrite precedes the SPA fallback; `/api` requests are excluded from that fallback.
3. Add the required server-only variables in Vercel's intended Production environment. Run the migration against that database, then deploy through the Git integration or Vercel CLI.
4. Configure Preview separately. Prefer a separate Neon branch/database and auth secret for previews. Omit `BETTER_AUTH_URL` in Preview to use the exact platform-provided `VERCEL_URL`; the server trusts only the current deployment and branch URL supplied by Vercel. For Production set the canonical HTTPS origin explicitly. Avoid sharing production accounts and manuscript data with unreviewed preview builds.

The repository does not provision a database or install secrets automatically. It is configured for deployment once those values and migrations are in place. Pricing depends on the selected Vercel and Neon plans and usage.

Before public use, verify real sign-up/sign-in/sign-out, own-user save/load, another-user read rejection, a two-client stale-save conflict, EverySong search/import and one model generation on the deployed URL. Local checks validate code and packaging; the live database connection, session cookies, provider responses and account-specific limits need verification with the configured services.

## Product contract and coverage

| Brief requirement | Implementation / evidence boundary |
| --- | --- |
| One Source / Spin / Polish manuscript | Shared project and stable line identities; responsive paired lyrics |
| Chorus-first writing and alternatives | Scoped requests and revisioned patches; explicit provider configuration |
| Protected / approved states | Independent editor flags; protected edits rejected by engine and cloud transaction |
| Repeated hooks | Explicit linked scope and surfaced lock conflicts |
| Undo, line history, snapshots | Browser persistence and recoverable snapshots; cloud revision archive |
| Premise, dialect, tone and explicitness | Structured controls; mixed-direction lyric content |
| Musical fit inspector | Local text heuristics with uncertainty; no unsupported singability percentage |
| Source fallback and identity | Manual lyrics; separate recording, lyrics and streaming identifiers |
| Private cloud library | Better Auth email/password sessions, Neon owner-scoped API and optimistic transactions; needs live setup validation |
| Rehearsal | Manual navigation, user timing/LRC and authorized local audio; timing provenance remains explicit |
| Export | Clean parody text, Markdown, browser print/PDF, supplied timing and recovery JSON |
| AI history and jobs | Scoped schema-checked results and private database job/revision schema |
| Acoustic alignment | Optional later phase; no acoustic alignment or singing synthesis is claimed |

Text-based stress, syllable and rhyme checks are aids to the writer. Singing remains the musical acceptance test. Uploaded audio stays on the user's device. This application does not fetch stems, synthesize an artist's voice, automatically publish songs or provide source-lyric rights.

## Structure

- `src/lib/engine.ts`: editor transformations, protected content and revision guards.
- `src/lib/store.ts`: browser persistence, recovery drafts, undo and snapshots.
- `src/lib/cloud.ts`: cookie-authenticated private saving and conflict handling.
- `src/lib/api.ts`: typed same-origin client calls.
- `src/components/`: manuscript, source, inspector, library, rehearsal and export surfaces.
- `api/`: Vercel Node function entry points.
- `server/lib/`: authentication, Neon persistence and credential-bound provider adapters.
- `db/migrations/001_loki.sql`: private manuscript tables, transactional revision guards and durable quotas.
- `scripts/`: migration, local server and build preparation.
- `scripts/migrate.mjs`: serialized Better Auth and checksummed app migration runner.
- `tests/`: editor invariants, source/API boundaries, exports, timing, authentication and cloud recovery.
