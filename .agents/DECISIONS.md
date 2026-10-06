# Decisions and rationale

These decisions describe the approved and implemented MVP. They do not authorize a new deployment or real-data integration.

1. **Local-first now.** User selected local preparation; Supabase cloud creation later hit the free project quota. Cloud and real Sheet pilot remain deferred, requiring capacity and explicit target/permissions.
2. **Physical phone + PC microphone.** Staff manually call their company SIM on speaker, click record/upload in the webapp. No automatic SIM interception/recording. Physical two-way audio quality is an outstanding pilot criterion.
3. **Database is the business record.** Google Sheet remains the input/output surface; save succeeds before asynchronous output. Sheet errors must not lose a completed call.
4. **Supabase private Storage, not Drive.** Stable app share links in Sheet resolve to five-minute signed playback. Public views expose no lead profile. Every link pins one recording; replacement/revoke are explicit and audited.
5. **Maximum five saved outcomes.** Retry/re-upload does not count. Final evaluation is still possible after attempt five. Verified requires valid ready recording plus active share.
6. **Explicit demo/live modes.** Synthetic browser-only demo is opt-in and rejected in production. Live errors never silently fall back to demo data.
7. **Identity before convenience.** App-generated UUIDs and metadata distinguish duplicate phones/headers and moved rows. Uncertain mapping/identity halts Sheet writes; formulas/unmapped cells survive.
8. **Quarantine uncertain external writes.** Google Sheets has no arbitrary-cell CAS. Expired leases/timeouts/ambiguous server failures require readback reconciliation; old jobs cannot overwrite newer output. Safe-read/429 retries are bounded.
9. **Simple MVP scope.** One source tab, staff choose leads, older first, no CRM/assignment/SLA/Zalo/AI/customer approval portal. These original ideas are not unfinished MVP features.
10. **Evidence is environment-specific.** Demo/fake Google tests, actual local Supabase tests, and physical/cloud pilot are distinct. Local acceptance is not production approval.
11. **Model ownership.** `gpt-6-luna` implementation/operations and `gpt-6.1-sol` independent QC/final acceptance for the GitHub handoff; maximum four active agents including root. Shared contracts/manifest/lockfiles/migrations have one owner.
12. **GitHub gates.** Branch/PR workflow; no direct main pushes. Do not bypass CI when GitHub cannot allocate a runner. Local acceptance remains valid for its recorded code SHA, while documentation publication may be pending.

See `docs/PLAN.md` for the full approved scope, `docs/API.md` for contract details and `.agents/HANDOFF.md` for current state rather than interpreting this as a new implementation plan.

## 2026-10-06 — UI/access pilot approved; local deployment first

The user explicitly approved implementation of Hallmark/1990 UI polish, real email/password sign-in, manually shared invite/recovery links, and server-enforced Admin/Staff/Viewer access for the existing single workspace. Member removal means access disable, preserving history and public recording links. Montserrat across the UI is the approved temporary typography exception until licensed brand font assets are available.

This extends decisions 9 and 11 without adding multi-tenancy, CRM or assignment. The user subsequently selected Supabase local first and cloud later. A requested new free cloud project was not created because Supabase rejected the account's active-project quota; do not pause, delete or upgrade unrelated projects. No real Sheet was modified. The next acceptance is local Auth/DB/Storage/Edge/UI only, with physical-call and cloud acceptance still separate.

## 2026-10-06 — GitHub handoff and local retirement approved

The user approved handing off the complete project on GitHub `main` to `trieumanh0405`, after Sol review and CI. The recipient will create their own Supabase project and fresh secrets; do not transfer the original local database or credentials to that account or repository. No cloud deployment is authorized in this task.

The user selected a private backup before local removal. Preserve source/Git and the durable integration checkout. After a verified isolated restore and successful main publication, remove only this project’s local runtime; delete the Colima default VM/data only if a fresh inventory proves no unrelated workloads. Keep the recovery archive outside Git.

Use the official website SVG logo and Montserrat typography. Website CSS confirms Montserrat, superseding the earlier temporary-font exception; preserve the existing readable application scale and button contrast. Remove the requested idle-recorder sentence. GPT-6 Luna subagents execute, and GPT-6.1 Sol performs final acceptance instead of Astra for this phase.
