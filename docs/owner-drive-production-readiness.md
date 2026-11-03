# Owner Drive production readiness for PR #12

Status on 2026-11-03: **blocked for production**. The owner reported a successful real local staging upload, automatic publication, student visibility, and MP4 playback. This used synthetic Auth and an in-memory PGlite database. The following gates require separate evidence and an explicit production approval. Keep PR #12 Draft until then.

## Data and migration gates

- [ ] Establish approved, sufficiently privileged read-only PostgreSQL backup access without sharing credentials in chat or resetting the live database password. The runtime `uyym_backend` role must not be assumed sufficient for a full dump.
- [ ] Create an encrypted, consistent production PostgreSQL backup outside Git covering application schema/data, relevant Supabase-managed database schemas, roles/grants, and the `supabase_migrations` ledger. Document any managed objects that logical dump tools exclude. Back up Supabase Storage objects and required encryption keys separately when applicable. Record scope, time, compatible tool version, archive size, and SHA-256 without logging secrets.
- [ ] Restore the backup into an isolated compatible PostgreSQL instance. Verify schema, role/grant dependencies, migration history, row counts, constraints, and critical application tables. A `pg_restore --list` check alone does not satisfy this gate.
- [ ] Apply migration 009 only to a separate nonproduction database first. Verify all six new tables, FORCE RLS, server role grants, absent public-role access, and the resulting migration ledger. Verify the production ledger and that all six tables are absent before any later production migration approval.
- [ ] Run the currently skipped multi-connection PostgreSQL integration test against a separate real PostgreSQL database (`TEST_DATABASE_URL`); the in-memory fixture cannot prove the concurrent-seat race behavior.

## Browser and media acceptance

- [ ] In the existing isolated staging session, verify seeking the real MP4 and playback after the seek. Record the result separately from initial playback.
- [ ] Verify that a synthetic student without the Calculus I enrollment cannot see or play the lesson. Confirm the normal denied-browser and playback-grant checks remain active.
- [ ] Review the real uploaded file's owner, exact parent, size, and private Reader permission in the staging Drive UI. Preserve existing files; no automatic cleanup or adoption of previous uploads.

## Production deployment and rollback

- [ ] Review the exact tested commit and Draft PR diff, complete code/security review, and approve one production release plan explicitly. Do not merge, deploy, configure Render, or apply migration 009 as part of preparation.
- [ ] Prepare protected Render variables for the production owner OAuth client, production service-account credential, owner identity, and encryption key. Keep them server-only; preserve existing Auth/TOTP keys. Verify the production OAuth callback and Drive folder policy without changing the staging client.
- [ ] After approval and verified backup, apply migration 009 through the confirmed migration mechanism, record its version, and repeat the privilege/RLS preflight. Enable only the designated test teacher after deployment and owner consent.
- [ ] Deploy the exact approved commit, check health/login/TOTP, owner consent, private MP4 upload, publication, student playback/seek, access denial, logs, and the legacy media path. Stop on any failed gate.
- [ ] Record the prior Live commit and Render configuration before cutover. Roll back application code/configuration if needed; preserve additive tables, encrypted credentials, and uploaded Drive files. Investigate incomplete uploads rather than deleting files or reversing migration 009 automatically.

No production change is authorized by this checklist.
