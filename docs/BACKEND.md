# Local Supabase backend

The backend keeps all call state in PostgreSQL. Staff mutations go through the authenticated `call-api` Edge Function and transactional database functions. Browser roles have read-only access to lead and attempt data; profiles and roles can only be provisioned with the service key. The public `public-recording` function accepts an opaque share token and returns a five-minute signed URL without lead details.

## Start and seed a local project

Start the local Supabase stack using the project ID and ports in `supabase/config.toml`, then apply migrations:

```sh
npx supabase start
npx supabase db reset --local --yes
npm ci
node scripts/prepare-local-functions-env.mjs
npx supabase functions serve --env-file .supabase/functions.env
```

The environment file is ignored by Git and contains only local keys plus a generated encryption key. The app and signed Storage URLs use `PUBLIC_SUPABASE_URL`; `SUPABASE_URL` is used for server calls. Set `PUBLIC_APP_URL` to the deployed app origin and `SHARE_ENCRYPTION_KEY` to a durable secret before deployment. Keep the encryption key stable: it is needed to reconstruct existing share URLs after reload and for Sheet retries. Do not put the service role key in Vite variables.

Create test users through the Supabase Auth admin API, then insert each role into `public.profiles` with the service key. The auth signup endpoint is disabled. New profile rows default to `staff`; never accept a role from browser metadata. Promote the first administrator through a trusted local SQL session or service-only provisioning script.

## Local integration check

With the local project and functions running, execute:

```sh
node scripts/local-backend-check.mjs
```

The script creates synthetic users and leads, checks anonymous and profile-less access, races two staff claims, uploads generated PCM WAV bytes through signed Storage, and exercises server-side audio inspection, share replay, public playback, outcome/evaluation idempotency, history URL reconstruction, and revocation. Synthetic users and their credentials are written under ignored `.supabase/backend-test-users.json`; the script does not print passwords. Reset the disposable local project to remove those fixtures.

## Operational behavior

Contact outcomes and optional evaluation commit in one database transaction. A save key is scoped to its actor and request contents; reusing the key with different input is rejected. Attempt claims lock the lead, expire after fifteen minutes, and never increment the attempt count. A completed contact increments it exactly once; the fifth is allowed and a sixth claim is rejected.

Signed upload targets are private and single-use. Completion downloads the stored bytes on the server, checks the container signature, parses the audio metadata with `music-metadata`, calculates duration and checksum, and rejects malformed files, MIME mismatches, empty/unparseable audio, files over 50 MB, and durations over 30 minutes. Client-reported readiness, byte count, and duration do not determine the result.

Share tokens are random and opaque. PostgreSQL stores a SHA-256 lookup hash and AES-GCM ciphertext; it never stores the raw token. Links stay pinned to their recording. Replacing a handoff adds an audited version and leaves old shares active. Revoking the current share marks an existing verified result unverified and queues the new state for Sheets. Previously issued signed playback URLs can remain usable until their five-minute expiry.

Sheet output uses `sheet_sync_jobs` as a durable outbox. Every state-changing transaction increments `sheet_sync_version` and inserts a unique job. Workers claim only the current version, serialize leases per lead, and receive a monotonically increasing fencing token. A result with an expired token cannot advance the applied version.
