# Quick group enrollment (ADMIN)

## Owner workflow

1. Create student accounts in **Users** as before. Their first sign-in is not required before assignment.
2. Open **Groups** and create a group. Saving an active group opens **Add students to a group** automatically. An existing group has the same action beside **Edit**.
3. Search by name or phone, tick students, or choose **Select on this page**. Selection persists across search and pagination. The dialog shows the course, free places and selected students.
4. For new course enrollments, the access dates are already selected and shown as a summary (Almaty UTC+5). Group dates supply the range, or six weeks when no end is set. **Open now** is the default. Optional **Change dates** reveals the editor; **Use automatic dates** restores the default range. No date or time entry is required for the normal add flow.
5. Press **Add to group** once. The server validates and saves the whole selection atomically.

The **Access** page also offers this flow: choose a group, then select students. **Individual access** retains the single-student form, with new enrollment dates defaulting to now plus six weeks and an optional date editor. Editing an existing enrollment preserves its stored dates.

## Rules preserved

- Only ADMIN can use the bulk routes. Every request retains session, role and browser proof checks; writes also retain CSRF protection, idempotency and transactional authorization.
- A student with current active/pending course-wide access can be attached to the group. Their existing status, dates, payment state and history are preserved; common dates apply only to new course enrollments. New enrollments start unpaid, independently of access status.
- Existing group members cannot be added twice. Another group's members are not transferred. Inactive accounts, pending Auth operations, and paused, revoked or expired access require individual review.
- Adding students does not approve their browser, change passwords or reset sessions. Learning access still requires their approved browser, password change and all normal course checks.
- Capacity is checked on the server under the existing management lock and database capacity triggers. A full group is not expanded automatically. One invalid or stale selection rolls back the complete batch.
- The 100-student bound applies to one request, not to the academy's number of accounts. The UI pages 20 candidates at a time.
- An uncertain network result retains the exact request and operation ID for an explicit retry. After closing such a dialog, refresh the group before starting a different operation.
- Existing ungrouped enrollment attachment invalidates playback grants for that course only, using the existing enrollment update behavior. Other courses and browser bindings are preserved.
- Enrollment audit entries use the existing audit log. No new migration is needed.

## Verification for this change

- TypeScript and production build: PASS.
- Complete local suite after automatic-date follow-up: 144 tests, 143 passed, 1 PostgreSQL test skipped; no dedicated PostgreSQL test database was used.
- Local production-build HTTP smoke: 19/19 passed (HTML, assets, SPA fallback, public API and unauthorized private-route denial).
- Local browser with synthetic accounts and embedded SQL: creating a group opens selection; existing group and Access picker paths work; keyboard Space selection and Escape focus return work; search retains selection and shows an empty state; both a new enrollment and existing course-wide access attach successfully; already added members are disabled. Existing PP1 access dates remained unchanged.
- EN/KK/RU, light/dark, desktop 1440/1600 CSS px and narrow mobile 360/433 CSS px inspected. No horizontal overflow at 360 px. These are local fixture checks, not real Supabase, Google Drive or production acceptance.
- Automatic-date follow-up browser checks: individual enrollment saves with no date input; optional manual change and automatic reset work; existing PP1 edit retains its saved dates; group range is preselected; a group without dates receives now plus six weeks; mixed new/existing batch saves. The date editor remains mounted but disabled and hidden when only existing ungrouped enrollments are selected, so irrelevant required inputs cannot block submission. EN/KK/RU and light/dark views inspected, including 360 px with no horizontal overflow and no console errors.

Before release, review the scoped commit and deploy the matching frontend and backend together. Production enrollment acceptance remains BLOCKED until the owner uses an approved ADMIN browser after deployment. No real student accounts or screenshot roster data were imported by this change; no production settings or data were changed.
