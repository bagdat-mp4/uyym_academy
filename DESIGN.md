# UYYM learning system

Implemented on `codex/neo-learning-redesign`, based on released `489fbdc`.
This is a local review build; the production site has not been changed.

## Visual rules

The homepage is expressive; the learning workspace gives priority to the next
lesson. The original blue UYYM logo remains intact. The latest color brief uses UYYM blue as the primary identity: blue hero and
contact surfaces, white-on-blue primary actions and quiet blue-tinted panels.
The layout, typography, outlines and hard shadows remain unchanged.

`client/src/neo-system.css` owns the semantic tokens. Existing `--ui-*` and
`--ws-*` names are compatibility aliases so established role forms retain their
layout and use the same colors. Components consume semantic variables.

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#F7F9FC` | `#0F1720` |
| Panel | `#FFFFFF` | `#182333` |
| Quiet panel | `#EDF2FA` | `#213146` |
| Text | `#0F1720` | `#F4F7FC` |
| Secondary text | `#4B5A70` | `#C0CDE0` |
| Outline | `#0F1720` | `#9CACC4` |
| Focus | `#203F85` | `#9DBFFF` |
| Selection | `#203F85`, white text | same |
| Supporting panels | `#EAF0FC`, blue text | `#1E3151`, light blue text |
| Primary / hover | `#203F85` / `#19346F`, white text | same |
| Hero / contact | `#203F85`, white text | `#172F63`, white text |

Status tokens are used only with actual state labels: success green, warning
brown/yellow, error red. Contrast tests cover every text/status token on all
three surfaces, control outlines, focus, blue selection, primary/hover actions, hero/contact surfaces and tinted panels.
`--neo-brand`, `--neo-brand-hover`, `--neo-on-brand`, `--neo-tint`,
`--neo-on-tint`, `--neo-feature` and `--neo-on-feature` drive these roles.
Existing `.button-yellow`, `--ui-yellow` and `--yellow` names remain compatibility
hooks mapped to blue; they no longer introduce yellow branding. Amber is kept
only for actual warning states.

- Major cards and controls: 2px outlines; minor dividers: 1px.
- Shadows: `2px 2px 0`, `4px 4px 0`, marketing `8px 8px 0`.
  The labelled browser illustration alone uses `12px 12px 0` on desktop.
- Cards: 16–24px corners; controls: 10px; compact status badges may be pills.
- Spacing: multiples of 4/8px; dashboard gaps 20/24px; public sections 88px
  desktop, 56px mobile; content maximum 1240px.
- Existing system font stack: Segoe UI Variable Text / Segoe UI / Arial.
  Cabinet Grotesk/Satoshi files are not in this repository. No unlicensed font
  was copied and no remote font or new dependency was introduced. Glyph rendering
  on actual target devices, including Ә Ғ Қ Ң Ө Ұ Ү Һ І, remains a visual gate.
- Hero 36–80px; public headings 32–46px; body 16–18px; working UI 14–16px.
- Buttons reserve their shadow offset and move 2px on hover, 4px on press.
  Motion lasts 160ms; reduced motion removes nonessential transitions.
- No looping decorative motion, glass effects or visible gradients. The static
  32px dots use an inline SVG behind the illustration, away from dense text.

## Localization and preferences

English is the first-visit default. Saved EN/KK/RU choices remain valid. Student
entry point is **Dashboard / Оқу кабинеті / Учебный кабинет**. Data authored by
the owner (course/lesson titles, descriptions, instructor biographies, schedule
text, announcements, feedback and custom FAQ) remains verbatim; the owner must
translate those separately if needed.

Light remains the default. The labelled native selector provides Light / Dark /
System, persists the preference, and resolves System through `matchMedia`.
System changes update both public pages and the workspace without overwriting
the saved preference. `main.tsx` applies the resolved mode before React renders.
The hook unregisters its system listener on mode change/unmount.

## Actual capabilities and sources

| UI | Source and action |
| --- | --- |
| Public course strip, cards and illustration | `GET /api/public`, `courses`; no invented Physics/English/Chinese courses |
| Price, length, group size | Individual public course fields; fixed aggregate format claims removed |
| Enrolment | Existing selected-course dialog and `POST /api/applications` |
| Teachers, support, FAQ | Existing public settings; instructor block omitted if no instructors |
| Identity greeting | Authenticated `status.user.name` passed as presentation data |
| Enrolled courses / access end | Device-protected `GET /api/courses` |
| Continue learning | Per-course `/content`, `progress_seconds`, `last_opened_at`, `video_ready`, `published`, `completed_at` |
| Start learning | First ready published incomplete lesson returned by the authorized content API |
| Completed lessons | Explicit `completed_at`; opening a lesson is not completion |
| Pending work | Assignments with no submission or `needs_revision` |
| Schedule | `starts_at` on lessons, group schedule text; existing Asia/Almaty formatter retained |
| Announcements / resources / feedback | Existing course content and assignment views |
| Lesson workspace | Existing protected player, curriculum, previous/next and resource actions |
| Admin / teacher | Existing management forms, tables, scoped content and access operations |
| Profile/preferences | Actual identity in sidebar; shared language/theme controls. No invented profile editor |

Counts from content are shown as **—** until all enrolled course content is
loaded successfully. Partial failures keep a retry action. No GPA, streaks,
watched-hours estimates, notifications, calendar sync or new backend capability.
An empty account links to the real course catalogue. Missing recordings have a
clear existing availability state. Marketing illustration is labelled as an
illustration, contains no fake student metrics and has no pretend controls.

## Review and acceptance boundaries

Automated checks and local HTTP smoke results are recorded in
`docs/neo-redesign-verification.md`. Local fixtures use an embedded database and
simulated Auth, never real Supabase or Drive. They are not production evidence.

Browser Use rejected observation of the existing local tab twice (including
after the owner reopened the page): "The requested URL protocol is not allowed.
Allowed protocols: http:, https:". No alternate browser, browser driver, CLI or
network route was used to bypass this restriction. Consequently baseline/new
screenshots, responsive visual inspection, keyboard runtime, real system theme
events and device glyph rendering remain BLOCKED for agent verification.

Before release: manually review 360/390/768/1440px, both themes and System,
all locales, public application dialog, login/gates, all three role workspaces,
lesson list/player, long names and error/empty states. Test with Tab/Enter/Escape
and reduced motion. Then verify PP1 with an approved enrolled STUDENT browser;
check ADMIN separately. Do not treat an admin lesson view as student acceptance.

The redesign changes no server route, database schema, authentication, device
proof, grant, heartbeat, media/file checks, provider settings or production data.
