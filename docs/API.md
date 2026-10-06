# Shared API contract

This document defines the domain boundary for the frontend, Supabase Edge Functions, and Sheets sync. Staff operations are exposed by the authenticated `call-api` Edge Function and enforced again by PostgreSQL RPCs/RLS. Public playback uses `public-recording`; Sheet worker operations use service-only RPCs and functions.

## Adapter selection

The UI depends on `LeadCallRepository` in `src/shared/repository.ts`. `SupabaseRepository` and `DemoRepository` implement it; `VITE_APP_MODE` selects the live Supabase or explicitly selected demo adapter. App startup must fail clearly if the mode is absent or invalid. Demo mode is a deliberate local choice, and production builds reject it. Never catch a live backend failure and switch to demo.

## Domain identifiers and enums

- `LeadId`, `AttemptId`, `RecordingId`, `ShareId`, and `SyncJobId` are opaque IDs; lead IDs are system-managed UUIDs.
- `ContactOutcome` is one of `interested | unreachable | callback | hung_up | not_interested | spam | wrong_number | other`.
- `AttemptCount` is 0–5. Increment is a server transaction on a new outcome only.
- Recording state is `uploading | validating | ready | rejected | failed`; only `ready` can be attached to a verified result.
- Share state is `active | revoked`; a share is immutable with respect to `recordingId`. Replacing a handoff does not invalidate its previous share.

## Operations

| Operation | Input | Result / invariants |
| --- | --- | --- |
| `listLeads` | queue, cursor | Stable lead summaries and attempt count; phone is required for call workflow. |
| `getLead` | lead ID | Lead details, answers, attempts, recordings, current handoff. |
| `claimAttempt` | lead ID, idempotency key | Creates a `draft` attempt and exclusive 15-minute claim; heartbeat extends the lease. Claim ID is the attempt ID. An expired draft can be resumed by its owner/admin or canceled. Cancel does not consume an attempt. |
| `resumeAttempt` / `cancelAttempt` | claim ID; cancel also needs idempotency key | Resume renews the lease without changing attempt count. Cancel releases claim and retains audit history; completed attempts cannot be canceled. |
| `saveOutcome` | claim ID, outcome, optional note, optional ready recording ID, optional evaluation + expected version, idempotency key | One database transaction validates claim and ceiling, checks `other` note and recording ownership/readiness, attaches audio, completes the attempt, increments once, and optionally stores evaluation/handoff. Same key replays original response; different key against completed attempt conflicts. Failure leaves draft/count unchanged. Upload must validate before this call. |
| `beginRecordingUpload` | lead/claim, filename, content type, size, required idempotency key | Reject >50 MB, unsupported type, or mismatched lead/claim; retries with the same key return the same recording and a fresh private upload target. |
| `completeRecordingUpload` | recording ID, object metadata | Validate playable audio and duration <=30 minutes; attach ready recording idempotently. |
| `completeEvaluation` | lead ID, verified/unverified, recording ID if verified, expected version, idempotency key | Compare-and-swap version; stale calls conflict. Allowed after attempt five. Verified requires ready playable recording plus non-revoked share pinned to it. Evaluation and Sheet sync version persist in one transaction. |
| `createShare` | recording ID, idempotency key | Opaque durable public token and `/r/:token`; no lead PII in public response. Store only its hash for lookup and server-encrypted token ciphertext for rebuilding the URL during Sheet retries. Encryption key stays in server secrets. |
| `resolveShare` | token | Recording code/time/duration and short-lived signed URL; reject revoked share. |
| `replaceHandoff` | lead ID, new recording ID, expected version, idempotency key | Atomically set handoff and append audit version with old/new shares, actor, timestamp, and version. Old share remains active and resolves to its original recording until explicitly revoked. |
| `revokeShare` | share ID, idempotency key | Prevent future signed access; already issued URL lives only to expiry. Handoff replacement never implicitly revokes an old share. |
| `adminValidateSheetMapping` | spreadsheet/tab/header row/mapping | Admin-only; resolve columns by stable metadata/role; disable writes if ambiguous. |
| `enqueueSheetSync` / `runSheetSync` | event/version, idempotency key | Durable retry; app state is retained on Sheet error; older version cannot overwrite newer output. |

## Sheet identity and sync leases

`SheetColumnRef.metadataId` is the stable column identity; current A1 label and header are for diagnostics only. Resolve it against grid metadata before each write. Duplicate/missing metadata, duplicate stable lead UUIDs, changed fingerprint, or ambiguous role resolution blocks writes for that mapping and alerts admin. Never key leads by row number, phone, or a platform ID. For a row without the app UUID, create one in the app, then write it to the mapped stable-ID cell using compare-before-write. If another writer populated it, or duplicate UUIDs exist, stop and reconcile. After sorting/inserting rows, resolve the row again by UUID before writing. Platform IDs are optional source metadata and never the authoritative lead key.

Workers acquire a singleton global worker lease before polling or writing, then serialize output per lead using a lease and monotonically increasing fencing token. The global worker lease expires so a crashed poller can recover; each invocation uses a unique worker ID. An expired output-write lease is quarantined as blocked because the Sheet write may already have landed. It is not blindly reclaimed: stale workers cannot report success, and newer versions wait behind the barrier until readback reconciliation confirms the Sheet matches the latest app snapshot. Since Google Sheets does not provide compare-and-swap for arbitrary cells, verify row identity and lease ownership immediately before writing. A timed-out or server-error write is also blocked for reconciliation. Other retryable errors use bounded exponential backoff while retaining the latest app state. Import cursors advance by compare-and-swap and reset when the mapping fingerprint changes.

## Pilot membership and authentication extension

The pilot remains one shared internal workspace. Member roles are `admin`, `staff`, and `viewer`; `service` is an internal actor type, never a selectable team role. Every member has `pending`, `active`, or `disabled` status. Only active members can read workspace data; only active admin/staff can mutate call state. Existing staff ownership and share-revocation rules remain in force. Public recording tokens remain independent of member access revocation.

`TeamMember` exposes `id`, `email`, `displayName`, `role`, `status`, `version`, and `createdAt`. Its `id` identifies the roster row and differs from the Auth UID in `Actor.id`; `Actor.memberId` identifies that actor's roster row. The authenticated `team-admin` endpoint uses the usual `{data: result}` envelope:

| Operation | Input | Result |
| --- | --- | --- |
| `get-session` | none | `{actor: Actor \| null}`; own identity/status only, including pending/disabled so the app can explain denied access |
| `list-members` | none | `{members: TeamMember[]}`; admin only |
| `invite-member` | normalized email, role, idempotencyKey | `MemberLink`; admin only; duplicate/retry cannot create another identity |
| `issue-member-link` | memberId, kind (`invite` or `recovery`), idempotencyKey | `MemberLink`; admin only |
| `set-member-role` | memberId, role, expectedVersion, idempotencyKey | updated `TeamMember` |
| `set-member-status` | memberId, status (`active` or `disabled`), expectedVersion, idempotencyKey | updated `TeamMember`; cannot activate an unaccepted invitation |
| `complete-onboarding` | password | authenticated invite/recovery user's password setup; pending membership activates only after server-side Auth update |

`MemberLink` contains `member`, `kind`, `actionLink`, and `expiresAt`. Its link is a transient secret shown only to the administrator; it must never appear in logs, audit payloads, fixtures, or committed files. The app consumes `/auth/confirm?token_hash=...&type=invite|recovery` through Supabase `verifyOtp`, removes token material from the browser URL, and presents password setup. Signup is disabled; no automated email delivery is required for this pilot.

Role/status changes are server-authoritative, audited, version checked, and replay-safe. A transaction prevents self-demotion/disable and loss of the last active administrator, and cancels open claims when a member loses write access without incrementing completed attempts. Authorization is rechecked at final upload completion as well as request entry. Disabling an account preserves call history and previously issued public recording links.

The TypeScript interfaces in `src/shared/types.ts` are the source for this contract. Extend them with versioned changes. Do not put Google access tokens, signed audio URLs, lead data, or credentials in Git or logs.
