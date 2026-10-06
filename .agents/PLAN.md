# Active execution state

## Summary

The GitHub handoff to `trieumanh0405` is merged and accepted. The app uses the official 1990 Agency logo and Montserrat, and the idle-recorder sentence has been removed. The recipient’s Supabase cloud setup is documented; no cloud deployment or live Sheet operation has taken place. The private backup/restore passed Sol’s gate, scoped local cleanup is complete, and Sol’s final independent retirement check passed.

## Phases

1. **Implementation complete:** UI branding, recorder copy, Vietnamese recipient handoff guide, Auth/Edge setup, guarded first-Admin SQL, smoke-test SQL, and license attribution are in `main`.
2. **Sol review complete:** Sol accepted the integrated tree at `4bb2454`, tree-equivalent to merged `main` `8b9a538818e97f708b1e240a6612c1e1d72999e7`. Sol’s SQL behavior review passed on isolated PostgreSQL with repository migrations and scratch Auth/Storage shims.
3. **GitHub application release complete:** PR #7 merged the application handoff at SHA `8b9a538818e97f708b1e240a6612c1e1d72999e7`; main CI run `37423215470` succeeded. A fresh remote clone passed `npm ci` and `npm run build`. A followup docs PR will produce a newer main head.
4. **Backup/restore complete:** The 27-file self-contained private archive passed Sol’s formal backup/restore gate; two cold-restore clones passed counts, Auth/Admin, hash, key, and Storage checks. Hash and permission checks passed.
5. **Cleanup and final review complete:** Operations re-inventoried Colima and found only this project plus the two restore clones. Those containers/volumes/network and the `default` VM/data were removed without a global prune. No Colima profiles/VM or Docker runtime remain; the project ports stopped. Source/Git/archive were preserved. The cleanup snapshot recorded 6,164,748 KiB (about 5.88 GiB) recovered. Sol’s independent retirement check passed.

## Verification

- Local application acceptance, branding/browser checks, and prior Supabase local checks are recorded in [PILOT-LOCAL-QC.md](../docs/PILOT-LOCAL-QC.md).
- GitHub main CI and a clean remote clone build passed.
- Isolated SQL tests passed for first-Admin bootstrap, safe/idempotent replay and error guards, plus synthetic seed concurrency, state preservation, and ID/tag collision rejection. These tests used scratch Auth/Storage shims and are not cloud verification.
- Cloudflare Pages, Supabase cloud, a real Google Sheet/Cron, and physical two-way call audio remain unverified.
- Backup/restore and cleanup are complete; Sol’s final independent retirement QC passed.

## Risks

- The original synchronized Git checkout has historical blocking reads. Use `.supabase/integration` for Git and preserve its history/index.
- `.supabase` contains the integrated checkout, private configuration, worktrees, and the backup destination. Never delete it wholesale.
- The default Colima VM/data are already removed. Rebuild local services only if needed from preserved source and private archive.

## What is needed later

The recipient must accept the GitHub invitation, create their own Supabase/Cloudflare resources and secrets, and configure any authorized Sheet pilot. Those steps are outside the completed GitHub handoff and remain unverified.
