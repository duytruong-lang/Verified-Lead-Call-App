# Supabase backend

The backend keeps all call state in PostgreSQL. Staff mutations go through the authenticated `call-api` Edge Function and transactional database functions. Browser roles have read-only access to lead and attempt data; membership and role records are provisioned through trusted server-side operations. The public `public-recording` function accepts an opaque share token and returns a five-minute signed URL without lead details.

## Cloud project handoff

For the clean cloud project owned by `trieumanh0405`, follow [HANDOFF-TRIEUMANH0405.md](HANDOFF-TRIEUMANH0405.md). It covers the 11 migrations, Auth settings, custom Edge Function secrets, the five functions, first Admin bootstrap in both membership tables, and the Cloudflare Pages environment. Do not follow local reset instructions against a cloud database.

## Start a local project

Start the local Supabase stack using the project ID and ports in `supabase/config.toml`, then apply migrations:

```sh
npx supabase start
npx supabase migration up --local
npm ci
node scripts/prepare-local-functions-env.mjs
npx supabase functions serve --env-file .supabase/functions.env
```

This normal start/resume sequence applies pending migrations without recreating the local database. `npx supabase db reset --local --yes` deletes local users, leads, and audio metadata; use it only for an explicitly disposable project when you intend to remove its data. Never use it to resume a pilot or against cloud.

The ignored local functions environment contains local keys plus generated encryption keys. The app and signed Storage URLs use `PUBLIC_SUPABASE_URL`; `SUPABASE_URL` is injected by Supabase for server calls. Cloud projects need their own `PUBLIC_APP_URL`, `APP_ORIGIN`, `PUBLIC_SUPABASE_URL`, `SHARE_ENCRYPTION_KEY`, `TEAM_LINK_ENCRYPTION_KEY`, and `TEAM_LINK_TTL_SECONDS`; see the cloud handoff and `supabase/functions/secrets.example`. Keep each encryption key stable for its project. Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into deployed Edge Functions. Never put a service-role/secret key in Vite or Cloudflare Pages variables.

Membership authorization requires a matching identity in both `public.profiles` and `public.team_members`, with the same Auth UUID, normalized email, role, and active status. There is no Auth trigger that creates profiles on signup. The first cloud Admin bootstrap is documented in the handoff and is guarded to stop on a partial/mismatched identity or an existing active Admin. For local-only pilot setup, use the loopback-guarded `node scripts/bootstrap-local-admin.mjs <email>` script; it refuses non-loopback endpoints and will not elevate an existing non-admin identity. Do not use a profile-only provisioning procedure or accept a role from browser metadata.

## Local integration check

With the local project and functions running, execute:

```sh
node scripts/local-backend-check.mjs
```

The script creates synthetic users and leads, checks anonymous and profile-less access, races two staff claims, uploads generated PCM WAV bytes through signed Storage, and exercises server-side audio inspection, share replay, public playback, outcome/evaluation idempotency, history URL reconstruction, and revocation. Synthetic users and their credentials are written under ignored `.supabase/backend-test-users.json`; the script does not print passwords. Use `node scripts/cleanup-local-backend-check.mjs` to remove only the harness-tracked business fixtures and disable its tagged test users. Do not reset a database that contains pilot data.

## Operational behavior

Contact outcomes and optional evaluation commit in one database transaction. A save key is scoped to its actor and request contents; reusing the key with different input is rejected. Attempt claims lock the lead, expire after fifteen minutes, and never increment the attempt count. A completed contact increments it exactly once; the fifth is allowed and a sixth claim is rejected.

Signed upload targets are private and single-use. Completion downloads the stored bytes on the server, checks the container signature, parses the audio metadata with `music-metadata`, calculates duration and checksum, and rejects malformed files, MIME mismatches, empty/unparseable audio, files over 50 MB, and durations over 30 minutes. Client-reported readiness, byte count, and duration do not determine the result.

Share tokens are random and opaque. PostgreSQL stores a SHA-256 lookup hash and AES-GCM ciphertext; it never stores the raw token. Links stay pinned to their recording. Replacing a handoff adds an audited version and leaves old shares active. Revoking the current share marks an existing verified result unverified and queues the new state for Sheets. Previously issued signed playback URLs can remain usable until their five-minute expiry.

Sheet output uses `sheet_sync_jobs` as a durable outbox. Every state-changing transaction increments `sheet_sync_version` and inserts a unique job. Workers claim only the current version, serialize leases per lead, and receive a monotonically increasing fencing token. A result with an expired token cannot advance the applied version.
