# Local interface review — 2026-10-14

Captured in the Codex in-app browser at 1280 × 900 and 390 × 844 CSS px.
Scroll position differs between screenshots; desktop headers are sticky.
All names, phone numbers and learning records shown here are disposable LOCAL
FIXTURE data. Remote Auth is simulated and SQL uses embedded PGlite.
No Supabase project, real owner account or Google Drive was accessed.

| Screen | Desktop light | Desktop dark | Mobile light | Mobile dark |
| --- | --- | --- | --- | --- |
| Homepage | [Image](homepage-desktop-light.jpg) | [Image](homepage-desktop-dark.jpg) | [Image](homepage-mobile-light.jpg) | [Image](homepage-mobile-dark.jpg) |
| Application | [Image](application-desktop-light.jpg) | [Image](application-desktop-dark.jpg) | [Image](application-mobile-light.jpg) | [Image](application-mobile-dark.jpg) |
| ADMIN | [Image](admin-desktop-light.jpg) | [Image](admin-desktop-dark.jpg) | [Image](admin-mobile-light.jpg) | [Image](admin-mobile-dark.jpg) |
| TEACHER | [Image](teacher-desktop-light.jpg) | [Image](teacher-desktop-dark.jpg) | [Image](teacher-mobile-light.jpg) | [Image](teacher-mobile-dark.jpg) |
| STUDENT | [Image](student-desktop-light.jpg) | [Image](student-desktop-dark.jpg) | [Image](student-mobile-light.jpg) | [Image](student-mobile-dark.jpg) |
| Player UI | [Image](player-desktop-light.jpg) | [Image](player-desktop-dark.jpg) | [Image](player-mobile-light.jpg) | [Image](player-mobile-dark.jpg) |

Additional views: [login](login-desktop-light.jpg),
[account mobile menu](account-mobile-menu-light.jpg),
[course cards](courses-desktop-light.jpg).

Verified: role layouts, application fields/dialog, account home-only header,
mobile section selector, English/Kazakh/Russian selection, preference persistence
after reload, player translations, light/dark surfaces and no document-level
horizontal overflow at 390 px. Application was opened without submitting it.
Player was inspected without starting playback.

`npx tsc --noEmit` and `npm run build` passed. `npm test`: 71 tests,
70 passed, 1 dedicated PostgreSQL test skipped, 0 failures. The contrast test
checks semantic foreground/background and input-boundary colors in both themes;
it is not a complete WCAG audit.

EN default, saved language/theme selection and affiliation FAQ filtering already
exist in the base commit fe52040 and were regression checked here. Content from
the owner (course/lesson titles and descriptions, schedules, assignment text,
materials, announcements, teacher biographies and custom FAQ copy) remains
verbatim and needs separate translations. Native media controls/file dialogs
follow the browser/OS language.

Not verified: physical Android/iPhone, Safari, screen readers, production owner
login, real private video playback or long-video revocation. No production deploy.
See [resource and license review](../ui-design-resources.md).
