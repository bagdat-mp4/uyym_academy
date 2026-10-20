# Neo learning redesign verification — 20 October 2026

Scope: local frontend redesign from released main `489fbdc`, branch
`codex/neo-learning-redesign`. No push, merge or production release performed.
Design specification and actual API/widget mapping: [DESIGN.md](../DESIGN.md).

## Passed

- `npm.cmd test`: **107 passed, 1 skipped, 0 failed** (108 tests). The original
  dedicated PostgreSQL test is skipped without a separate test database.
- `npm.cmd run build`: **PASS**, including `tsc --noEmit` and Vite production build.
  There is no lint script configured in the existing package manifest.
- Local HTTP smoke: **17/17 PASS**: built homepage and HTML SPA fallback,
  health, public catalogue with three seeded courses, unauthenticated Auth status,
  refusal of protected course/admin APIs, and byte-identical built JS/CSS assets.
  Executed against loopback Fastify + embedded SQL + simulated Auth.
- Existing API/security suites pass: role/group scope, unauthorized access,
  browser/device proof, challenge replay, grants, private files and student content.
  These automated tests are not a real production/student browser acceptance test.
- Added/updated regressions: role-aware Dashboard entry; explicit marketing
  illustration and author-text escaping; no invented catalogue before API data;
  translated theme selector; saved System resolution; start-only-ready/published
  lessons; current-enrolment filtering; missing counts represented as unknown;
  empty account links to the real catalogue; semantic color contrast in both modes.
- Public entry still defers role workspaces and protected player code.
- Semantic contrast tests cover 4.5:1 text, status, selected surfaces and 3:1 controls
  and focus. These are token tests, not a rendered WCAG audit.
- `git diff --check`: PASS. No backend/schema/lockfile change. Protected user file
  hashes unchanged: package.json, prepare-video.ts, init.mp4, credential rotation
  notes and TOTP re-encryption script. No environment file was read or edited.

Initial JS: 330.27 kB / 102.33 kB gzip, vs previous release's
324.93 kB / 101.25 kB gzip. This redesign adds no dependency and makes no speed
claim. Player startup, proof, heartbeat and private-part delivery are unchanged.

## Blocked / not run

Browser Use twice rejected acquisition of the local tab, including after the
owner manually reopened localhost. Review reason:

> The requested URL protocol is not allowed. Allowed protocols: http:, https:.

The agent did not use another browser/driver/CLI route to bypass the restriction.
No new screenshots or baseline screenshots could be captured. **Desktop, tablet
and mobile visual review is BLOCKED**, including 360/390px overflow, rendered
contrast, native menu/dialog keyboard operation, actual OS System theme changes,
reduced-motion runtime and Kazakh glyph rendering. Responsive CSS and SSR tests
are implemented but do not constitute a visual PASS.

**Real approved STUDENT PP1 playback, first-frame timing, owner TOTP login and
ADMIN management on production are BLOCKED** in this local verification. No
Supabase/Drive access, credentials, permissions or production data were changed.
Physical Safari/iPhone and Android checks also remain outstanding.

## Preview and next review

Open [local preview](http://localhost:18878/). It serves the actual new production
build with isolated seeded fixture data; this is not the real production DB.
The local-only role accounts and setup are defined in `tests/ui-fixture.ts`.
Production credentials are intentionally not accepted by this fixture.

Review homepage → catalogue → selected-course application without sending a
real application; login and each role; Dashboard → course → lesson; unavailable
recording; retry/empty states; EN/KK/RU and Light/Dark/System persistence. Inspect
360/390/768/1440px, long labels, Tab/Enter/Escape, visible focus and reduced motion.
Only after those visual gates and an independently approved STUDENT acceptance
should this branch be considered for deployment through the existing PR/Render
process. Prior release authorization does not publish this new redesign.

## Blue brand follow-up — 20 October 2026

The owner's subsequent color brief supersedes the yellow palette. Shared brand,
hover, on-brand, feature, tint, link and selected-state tokens now drive UYYM blue
(`#203F85`); yellow is not a large surface or primary action. Layout, type,
responsive rules, authentication and data flows are unchanged. The hero and
footer contact section use white-on-blue; supporting cards use blue tints.
Lazy workspace button rules consume the same semantic tokens, so loading a role
chunk does not bring back yellow buttons. Amber remains only for warning states.

Full tests: **107 PASS, 1 SKIP, 0 FAIL**; TypeScript/build PASS. Contrast/theme
regressions: **6/6 PASS**, including primary and hover actions, feature sections,
tinted panels, selection, secondary actions and focus in both themes. Local
HTTP smoke: **17/17 PASS**. No production deployment was performed. Browser
visual/approved-session acceptance remains BLOCKED as described above; no new
browser access attempt or workaround was made for this color-only follow-up.

## Logo accents and continuous page flow — latest follow-up, 20 October 2026

This subsequent brief restores controlled gold accents while retaining blue as
the primary brand. It supersedes the blue-only styling notes immediately above.
The existing logo provides the exact blue **#1B3B8B** and gold **#FFC72C**.
`neo-system.css` centralizes brand/accent/hover/soft roles. `landing-flow.css`
adds whitespace, floating subject navigation, soft FAQ cards and two shallow
decorative edges; page-level border dividers are removed. Gold stays on small
objects and the final CTA, not full-width section backgrounds. The navy footer
and the preceding privacy note no longer introduce a dividing line or white gap.

Confirmed defects corrected: the first course symbol had effectively blue ink
on blue (1:1), and a legacy important helper-text color defeated the semantic
palette (2.97:1 on white). New contrast checks cover the actual symbol rule,
the helper-text override, gold actions/hover/soft surfaces, footer metadata and
gold focus on blue/navy. Public and workspace language selection use the same
dark-on-gold pair. A legacy zero-width nav underline is explicitly reset so
keyboard focus can display it as well as hover.

- Full suite: **110 PASS, 1 SKIP, 0 FAIL** (111 tests). The dedicated PostgreSQL
  test remains skipped; no separate test DB was provided.
- TypeScript and Vite production build: **PASS**. No lint script exists.
- New subject navigation SSR checks: three locales, real encoded fragment
  targets, exact author text escaped, no invented current enrolment, no empty bar.
- Local HTTP smoke: **17/17 PASS** after restarting the isolated fixture with
  its network permission. Earlier attempts were blocked by sandbox `EACCES`;
  those attempts were not counted as app failures or visual evidence.
- Current entry JS: **330.99 kB / 102.56 kB gzip**. No dependency was added and
  no speed improvement is claimed.
- Backend, schema, authorization, enrolment/proof/grant/Drive logic, provider
  settings and real data are unchanged. No secret/environment file was read.
- Protected pre-existing file hashes are unchanged. `init.mp4` was not written,
  regenerated, staged or committed; OneDrive recovery remains a separate task.

**BLOCKED:** full-page screenshots and top-to-bottom visual/keyboard review at
1440px, 1024px and 390px, both themes and all locales. The existing Browser Use
rejection quoted above remains unresolved; no new attempt or alternate browser,
driver or screenshot route was used. CSS/SSR/contrast tests do not prove rendered
layout, absence of overflow, native focus, glyph rendering or motion behavior.
No screenshot artifact is claimed or included.

The local preview at http://localhost:18878/ serves this updated built UI with
isolated fixture data. Review it manually before publishing. This follow-up has
not been pushed or deployed; real STUDENT PP1 and owner acceptance remain outside
the verified local scope.
