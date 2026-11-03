# Owner Drive release checkpoint

Inspection date: 2026-10-31. This is preparation, not a release approval.

## Verified remote state

- Render service: uyym-academy, srv-db76g5d9fdbs73f718t0, Singapore, Free.
- Live: a41fa5022bb3c7ffd0d3f8731c8202332fb4ff5a,
  deployment dep-dbitqeu417fc73aa6utg (read from authenticated dashboard).
- Remote main fetched at the same SHA; PR #12 targets main and is Draft.
- Build: npm ci --include=dev && npm run build. Start: npm start.
- Health path: /api/health. Last live event says Auto-Deploy.
- Existing Render variable names were inspected with values masked.
  The five DRIVE_OWNER_* / DRIVE_OAUTH_* variables are absent.
  GOOGLE_APPLICATION_CREDENTIALS_BASE64 exists; the alternative path variable
  was not present in the displayed environment. Secret values were not read.
- No production environment, database or deployment change was made.

## Hard release gates

Supabase browser access was denied by a saved permission or managed policy.
Do not work around that denial with another browser, CLI, SQL client or API.
Live role/schema, migration history, plan and backup are NOT independently verified.
The owner's earlier manual SQL findings are input, not a passed automated check.
Do not request approval to proceed with migration until these gates are resolved.

Once the owner runs the read-only owner-drive-preflight.sql in Supabase SQL Editor,
it checks privileges for the named uyym_backend role rather than the SQL Editor's
current_user and returns one JSON catalog report. No connection URL is needed.
Verify the operator migration history separately. Verify all six tables are absent
before applying 009; if only some exist, investigate instead of rerunning SQL.
Never run backend-role.sql on an existing production role merely to add this feature.

## Backup and recovery requirements

Confirm the project's actual backup plan and latest recoverable snapshot. If no
usable snapshot exists, an authorized operator must create a consistent custom
format pg_dump with a compatible PostgreSQL client and a sufficiently privileged
backup role. A runtime-role dump of private tables alone is not a complete Supabase
backup: authentication, grants, migration history and required dependencies matter.

Use protected storage outside Git, with restrictive filesystem ACLs and encrypted
storage. Supply credentials through protected client configuration; never pass a
password-bearing URL as a command argument. Record only archive size, SHA-256,
PostgreSQL version and backup time. A successful pg_restore --list is necessary but
not sufficient: restore into an isolated compatible test database and verify schema,
row counts, constraints and login dependencies. Do not restore over production.
Drive media and protected encryption keys need separate backups.

No backup was created or claimed verified during this inspection.

## Consolidated approval and deployment order

After backup and live-role verification, present one approval covering:
the exact PR head, migration 009, protected Render additions, code deployment,
and the explicitly identified private teacher/student test group.

1. Apply 009 through the project's confirmed migration system and record its version.
2. Run catalog preflight again: six FORCE RLS tables, runtime grants, sequence grants,
   and no public-role access. Leave teacher upload permissions disabled.
3. Add DRIVE_OWNER_USER_ID, DRIVE_OWNER_EMAIL, DRIVE_OAUTH_CLIENT_ID,
   DRIVE_OAUTH_CLIENT_SECRET, DRIVE_OAUTH_ENCRYPTION_KEY in protected Render settings.
   Generate a separate random 32-byte hex key there/through approved secret storage
   and back it up securely; no key has been generated during preparation.
   Confirm APP_ORIGIN is exactly https://uyym.app and the ACL allowlist includes the
   owner and service account. Preserve existing auth keys and DATABASE_URL.
4. Account for configuration saves triggering Render deployment; use save-without-
   deploy if available. Merge only the approved head and verify the resulting Live SHA.
5. Owner completes Google consent personally. Verify owner identity and restricted
   root/course/week ACLs before enabling only the designated test teacher.
6. Upload a small known H.264/AAC MP4; test interruption/resume, cancellation,
   draft invisibility, publication, seek, browser proof and access revocation.
   Check actual owner, quota and reader access, plus one legacy recording.

If a stage fails, stop. After user approval, code can roll back to the recorded
previous Live deployment. Preserve additive tables, encrypted credentials and media.
Do not drop tables, restore over production, rotate keys or delete files as an
automatic rollback. A completed remote upload with a failed DB commit can require
sync/reconciliation; investigate private orphan files rather than bulk deleting them.

## Capacity and acceptance

Each upload is capped at 20 GiB; each request carries at most 1 MiB of video in
base64 JSON. Full videos are never written to Render disk. Memory is bounded per
request, not across arbitrarily many concurrent requests. Measure multi-teacher
load before expansion. MP4 extension and ftyp are not codec verification.

Uploads to Drive and playback to students both consume outbound Render traffic.
Free compute does not make this traffic unlimited. Measure billable usage and the
workspace's included allowance before enabling large recordings.
See https://render.com/docs/outbound-bandwidth and https://render.com/docs/free.

OAuth remains unverified against the live Cloud console. External Testing tokens
with drive.file expire after seven days; move the intended production OAuth app to
Production and complete Google's applicable branding/domain checks without adding
broader scopes. Owner consent remains an interactive handoff.

Real MP4 ownership/quota, production student playback, long-video performance and
Safari/iPhone acceptance remain BLOCKED until the above gates are complete.
