# ADMIN logout and protected-player controls

This change is prepared locally on top of the admin-workspace refresh. It has not been pushed or deployed.

## Decisions and official references

The current engine is one native HTML video element with MediaSource/ManagedMediaSource. It obtains a playback grant, sends a signed heartbeat and fetches bounded media parts through the existing backend. The new UI uses that same element and transport.

| Option reviewed | Compatibility and risk | License |
| --- | --- | --- |
| [Media Chrome](https://github.com/muxinc/media-chrome) | Closest controls-only option; [React wrappers](https://www.media-chrome.org/docs/en/react/get-started), timeline, volume, rate, responsive controls and focus-scoped shortcuts. It still requires lifecycle/fullscreen integration and validation. | [MIT](https://github.com/muxinc/media-chrome/blob/main/LICENSE) |
| [Video.js](https://github.com/videojs/video.js) | Current official [React documentation](https://videojs.org/docs/guides/installation/react) includes composable controls and adapters. More controller/store integration than this UI request needs. Its [iPhone native fullscreen fallback](https://videojs.org/docs/framework/react/guides/fullscreen) would need special handling to preserve the HTML watermark. | [Apache 2.0](https://github.com/videojs/video.js/blob/main/LICENSE) |
| [Shaka Player](https://github.com/shaka-project/shaka-player) | DASH/HLS/EME engine with [customizable UI](https://shaka-project.github.io/shaka-player/docs/api/tutorial-ui-customization.html). Replacing or adapting the existing grant/part transport for a controls redesign would add unnecessary risk. | [Apache 2.0](https://github.com/shaka-project/shaka-player/blob/main/LICENSE) |

Selected a small React controls layer; no player framework or dependency was installed. This is a compatibility decision, not a performance claim.

## Implementation

- `WorkspaceChrome.tsx`: ADMIN has one logout action, inside the existing account disclosure, calling the existing handler. Sidebar identity and home link remain. Teacher/student logout behavior is unchanged. Only the ADMIN navigation's bottom clearance is compacted.
- `VideoControls.tsx`, `player-controls-model.ts`, `player-controls.css`: integrated play/pause, buffered timeline, native seek/volume ranges, mute, real playback rates, conditional captions, wrapper fullscreen, replay, buffering, scoped shortcuts and inactivity behavior. J/L seek 10 seconds; left/right seek 5 seconds. Controls stay visible during settings, focus and pointer interaction.
- `ProtectedPlayer.tsx`: reuses all existing grant, heartbeat, signed media fetch, integrity checks, bounded buffering and STUDENT-only progress. The user-requested initial play attempts playback once media is ready; a rejected browser play request leaves an accessible Play action. The old native/external speed/fullscreen/start controls are removed. The video retains PiP, remote-playback and download restrictions.
- `VideoStatusOverlay.tsx`, `player-error.ts`, `protected-player.css`: localized idle/loading/error states without provider details; no automatic retry loop. Session/access/unavailable errors have appropriate recovery guidance. Error/loading in fullscreen retains an exit action. Initial Play and Retry move focus to the persistent stage. The existing DRM/screen-recording limitation notice remains available in a disclosure below the video.
- `english.json`, `main.tsx`: existing localization and stylesheet entry points; no new localization system.

Regression files: `tests/admin-logout.test.ts`, `tests/player-interface.test.ts`, `tests/video-controls.test.ts`. Local review harness changes: `tests/player-benchmark.tsx`, `tests/player-benchmark-server.ts`, `tests/player-preview.tsx`. Other changes are limited to the frontend files named above and this review document.

## Validation completed

- Full tests: **128 passed, 0 failed, 1 skipped**. The dedicated PostgreSQL test remains skipped without its test database.
- TypeScript and production build: **PASS**.
- Local production HTTP smoke: **19/19 PASS**, including protected unauthenticated refusals and exact built assets.
- Existing API tests continue to enforce device proof, browser binding, enrollment/group boundaries, grant expiry/revocation, fresh Drive checks per part and rechecking after external waits. These use isolated SQL and simulated providers.
- New regressions cover exactly one ADMIN logout in all locales, retained identity/home and busy guard, non-ADMIN behavior, semantic native controls, finite seeking, shortcut offsets, fractional duration formatting, safe localized errors, one initial Play and an exit during fullscreen failures.
- Local browser: generated MP4 through the existing MSE player with simulated Drive. Confirmed initial/loading, first frame, playing, pause, rate 1.5, mute/volume range, 10/5-second seeking, settings/checkmark/Escape, replay, native wrapper fullscreen and window fallback. Watermark remains in the wrapper.
- Simulated expiry while in the window fallback stops playback, displays a safe error and keeps Exit fullscreen usable; exiting restores body scrolling.
- EN/KK/RU and light/dark matrix passed without overflow; switching languages/themes retained one playback request instead of restarting the engine.
- Desktop, tablet and 390px mobile controls were inspected; mobile settings scroll inside the video and main controls have 44px targets. Sidebar/menu logout was checked at 1440/1024/390px. The actual local logout returned to the sign-in screen and remained signed out after reload.
- Screenshots cover the admin menu, initial/loading/playing/paused player, settings, fullscreen, mobile and error states. Review artifacts are stored in the chat workspace under `artifacts/player-controls/`, outside deployed assets.

## Not verified / release boundary

**BLOCKED:** real production PP1 playback with an approved STUDENT session, real Drive authorization and real-device Safari/iPhone/Android acceptance. No Supabase, Render, DNS, provider settings, secrets or production data were accessed or changed.

The generated local recording is a UI/engine fixture, not proof that production media works or is faster. No real caption track exists in the supplied fixture; the captions button is correctly absent, while a lesson with authorized caption tracks still needs acceptance testing. Timeline hover text and touch-drag were implemented but were not separately exercised with a physical pointer/touch device. The player is not DRM and does not prevent screen recording.

## Reproduce locally

Use the existing `tests/ui-fixture.ts` for the synthetic application. Use `tests/player-benchmark-server.ts` and the already generated ignored `work/player-benchmark/video/` for player checks; no owner recordings are needed. Do not run video preparation against the root `init.mp4`.

The player fixture exposes named local scenarios only: normal, slow, network failure, denied access, expired session, unavailable video and expired grant. Its checkbox forces wrapper-fullscreen rejection to exercise the existing window fallback. Shift+E expires only the simulated current grant. None of these routes or provider substitutes are imported into the production application.
