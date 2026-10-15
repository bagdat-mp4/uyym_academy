# PP1: production investigation — 2026-10-15

## Confirmed, read-only observations before publication

- Render service: `uyym-academy`, Free, `srv-db76g5d9fdbs73f718t0`.
- Live deployment: `dep-db7l1eui0phs7397pn7g`, commit `9cc031d`.
- Repository `origin/main` is also `9cc031d`; `5c40111` is not published.
- The available UYYM browser tab shows the sign-in form, not an authenticated
  ADMIN or STUDENT session. The owner subsequently reported no current access.
- Render Request logs are disabled/unavailable on the current service. Available
  application logs show startup, not the failing student's SQL/request details.
  Their absence does not establish the cause of the incident.
- Subsequent user-supplied production screenshots show GET content returning
  HTTP 500 and JSON `code: "42P18"`. The response Date corresponds to 14:29:50
  on 2026-10-15 in Asia/Qyzylorda (UTC+5). The user reports reproducing it while
  signed in as STUDENT; the agent has not acquired that browser's session.

No production data, enrollment, browser approval, roles, credentials, Render
settings, plan or DNS were changed. Supabase was not accessed directly.

## Production evidence still required

| Check | Status |
| --- | --- |
| Affected student's PP1 enrollment status | BLOCKED: no authenticated ADMIN session |
| Enrollment `starts_at` and `expires_at` | BLOCKED |
| Exact enrollment `group_id` | BLOCKED |
| STUDENT-reported GET `/api/courses/:id/content` HTTP status and error code | CONFIRMED from supplied screenshots: 500 / 42P18 |
| Failing code matches the locally reproduced SQL defect | CONFIRMED; exact enrollment fields have not been read |
| Deployment of correction | Authorized by the owner's conditional instruction after confirmation of 42P18; see Render/PR history for release status |
| PP1 retest under the actual STUDENT account | BLOCKED, not replaced by an ADMIN check |

The reproduced local defect is: a valid student enrollment
without a group caused an unused SQL parameter before the progress JOIN, producing
HTTP 500 / `42P18`. Production now has matching request-level error evidence,
not just matching UI wording. Exact enrollment status/dates/group_id remain
unread; they must not be reported as verified. No enrollment has been modified
to make a test pass.

## Prepared correction

Branch `codex/pp1-content-hotfix` starts at production/main `9cc031d` and contains
only the backend and regression-test changes from `5c40111`:

- `server/content.ts`: bind the group array only when the group filter uses it;
  preserve course-wide/group/published/active-enrollment boundaries.
- `server/index.ts`: mask internal exception codes for unexpected HTTP 500 errors.
- `tests/management.test.ts`: ungrouped content, personal progress/submission
  isolation, proof, foreign course, paused enrollment and safe error responses.

The unrelated interface changes remain saved in branch
`codex/student-content-navigation` at `5c40111` and are not part of this hotfix.
Existing user changes remain unstaged and untouched.

Validation of this exact hotfix branch: `npm.cmd test` — 77 PASS, 1 SKIPPED,
0 FAIL; `npm.cmd run build` — PASS, including TypeScript. The skipped test requires
a dedicated PostgreSQL test database; production was not used as a test database.

## Resume without bypassing access controls

1. Owner signs into UYYM in an existing approved ADMIN browser. Read the PP1
   enrollment status, dates and group selection; do not save/edit the enrollment.
2. Student reproduces PP1 in their own approved browser with DevTools → Network.
   Record only time, HTTP status and `code` for GET `/api/courses/<id>/content`.
   Do not export HAR, cookies, headers, proof values, passwords or login codes.
3. If the failing request is HTTP 500 / `42P18` and the active enrollment has no
   group, the prepared correction matches the diagnosed scenario. Publish the
   backend hotfix through the existing GitHub → Render Free process; keep secrets
   and configuration unchanged. If evidence differs, investigate separately.
4. After Render reports the new commit Live, the same STUDENT browser reloads PP1.
   Require HTTP 200 for that student's content request and visible permitted
   lessons. An ADMIN success or a public health response is not sufficient.

At preparation of `2d6b2db`, no push, merge or deployment had been performed.
After the supplied error evidence, proceed through the existing GitHub/Render
process without changing service settings, paid features or credentials.
The actual student's post-deployment content request is still required to close
the incident; a successful ADMIN request or public health check is insufficient.
