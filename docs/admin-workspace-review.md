# Admin workspace refresh

## Scope

The existing UYYM Academy ADMIN workspace now uses a calmer blue-led shell and consistent light/dark tokens. It keeps the current modules, routes, authorization and mutation handlers. There is no separate admin homepage in this application; the Applications page remains the initial module. No invented revenue, activity trends or student metrics were added.

- Grouped navigation, actual module breadcrumb, account disclosure, tablet icon rail and mobile drawer.
- Reused page header, buttons, status badges and dialogs; introduced a reusable filter bar and application overview.
- Applications have four status cards, search/status/reset controls, a six-column semantic table and responsive record cards.
- Users and other existing lists retain their actions in a more compact layout. Unknown or loading application counts display an em dash rather than a false zero.
- EN/KK/RU and saved theme/language preferences are retained. The processing status is now localized consistently.

## Data and permissions

Each status card reads the existing protected `GET /api/admin/applications` with `page=1&page_size=1`, the current search and its exact status. The displayed number is the server's full filtered `total`, not the returned row count. The four independent reads run in parallel; partial failures remain unknown and have a retry control. Counts do not change when selecting a table status or moving between pages. Search, refresh and successful existing mutations invalidate the count reads. Aborted or late responses cannot repopulate counts for a previous search.

Card selection and reset only change client filters. Existing application review, identity confirmation, approval/rejection, account invitation and security workflows are unchanged. No backend, schema, payment, Drive, Supabase, Render, DNS or secret configuration was modified.

## Validation

- `npm.cmd test`: 118 passed, 0 failed, 1 skipped. The dedicated PostgreSQL test remains skipped without a test database.
- `npm.cmd run build`: TypeScript and production Vite build passed.
- Local production HTTP smoke: 19/19 passed (frontend, SPA fallback, public API, unauthorized protected endpoints and exact built asset contents).
- New regressions cover protected parallel status reads, totals exceeding page size, true zero versus unknown, partial failure, cancellation, exact status selection, semantic tones, localization, escaped applicant data, empty states and admin theme contrast.
- Browser inspection used only `http://localhost:18878` with embedded SQL and simulated Auth. No production accounts or external provider requests were used.
- Visually inspected applications at 1440/1280 desktop, 1101/1024/820 intermediate widths and 390 mobile; checked 360px overflow. EN/KK/RU, light/dark, table/card layouts, search/reset, empty results, application details, account disclosure and mobile navigation were checked.
- Checked module navigation for Users, Access, Browsers, Courses, Groups, Teachers, Learning content, Payments, Settings and Activity log. Current module headings matched navigation and no error notices appeared.
- Verified Escape/focus restoration for the details dialog and mobile drawer, drawer focus wrap, a visible 3px keyboard focus outline, and mobile user-action heights of 44px. Final local browser check recorded no new console warnings/errors. No record-changing actions were submitted.

## Review boundaries

This is a local branch for review, not a production deployment. Real owner-browser acceptance and external Supabase/Drive behavior were not re-tested. They remain separate pre-release checks; local simulated Auth is not evidence of production readiness. Existing user edits, credentials and local video files are excluded from this change.

Review screenshots are saved in the chat workspace under `artifacts/admin-workspace/` and are not bundled with the deployed frontend.
