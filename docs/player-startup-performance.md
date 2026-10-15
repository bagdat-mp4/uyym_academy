# Private player startup: measured local change, pending PP1 acceptance

2026-10-15. Base: `761efc6`. Branch: `codex/player-startup-performance`.
No production deployment, provider configuration or production data changes.

## Finding and change

Before each bounded part, the backend awaited four independent Drive reads in
series: file metadata, folder metadata, folder ACL, file ACL. On a controlled
upstream this consumed four network round trips. It is a demonstrated code-path
bottleneck; it does **not** prove how much of the reported production 4–5.5 s
comes from Drive, proof/SQL, token refresh, or the user's network.

Resolve request-local authorization once, then run the same four fresh reads
concurrently. No metadata/ACL cache, no shared permission result between parts,
no extra prefetch or buffer growth. Token acquisition here includes library cache
lookup/refresh; it must not be interpreted as a new OAuth exchange every time.

The media route still checks device proof/session/enrollment/grant before Drive,
again after validation, and again after upstream media headers, before sending
bytes. A revoked grant cancels the pending upstream stream. Parts remain <=1 MiB,
with exact Range/body-length validation, private no-store responses, and existing
heartbeat rules. Heartbeat 403 is not ignored or retried with weaker security.

Staff previews now receive an explicit role. ADMIN/TEACHER register no progress
timer or pause listener and have no completion action; STUDENT retains both.
The server's STUDENT-only progress restriction is unchanged.

## Reproducible local comparison

Installed FFmpeg generates one 12-second H.264 test pattern in
`work/player-benchmark/video/`; it uses no owner recording. All generation runs
with that directory as its working directory. The local server uses the actual
ProtectedPlayer, MediaSource, Drive validator and bounded streamer. The upstream
is simulated: 650 ms per Drive operation, 20 ms per token-header acquisition,
80 ms body delay. No real Supabase/Drive connections. This is **not** a private
PP1 production benchmark, throughput test, or real-device Safari validation.

```powershell
npx.cmd tsx tests/prepare-player-benchmark.ts
npx.cmd tsx tests/player-benchmark-server.ts --baseline
# Open http://localhost:5175/__benchmark; New run -> Start watching -> Read ...
# Stop the local server, then run the optimized version, using the same video:
npx.cmd tsx tests/player-benchmark-server.ts
```

The baseline module is copied from the inspected local Git commit `761efc6`
into ignored `work/`, with local import paths adjusted. It is never deployed.
The page deliberately says LOCAL ONLY; it supplies fake provider/auth responses
and is not evidence of real account/device authorization. Security admission is
tested separately through real Fastify routes + PGlite SQL + real signed proofs.

One clean paired run in the built-in desktop browser, milliseconds:

| Measurement | Before | After |
| --- | ---: | ---: |
| playback HTTP response (local fixture) | 95 | 81 |
| first media part=-1, full response | 3531 | 1464 |
| first media part=0, full response | 3530 | 1462 |
| first presented frame, requestVideoFrameCallback | 7390 | 3219 |
| loadeddata (first frame available, separate event) | 7384 | 3214 |
| init: token-header acquisition, aggregate | 148.1 | 45.8 |
| init: metadata reads | 1316.7 | 664.5 |
| init: ACL reads | 1314.0 | 665.2 |
| init: validation wall time including token | 2752.3 | 690.9 |
| init: media headers | 652.7 | 654.7 |
| init: streamed body | 94.1 | 92.6 |

Metadata/ACL run concurrently after the change: **do not sum overlapping phase
durations**. First presented frame improves ~56% in this controlled run. An
earlier independent run recorded 7506 -> 4283 ms; paint scheduling varies, so
neither result is a production latency guarantee. Raw local snapshots/screenshots
are in ignored `work/player-benchmark/{before,after}-phases.{txt,png}`.

## Safe production measurement after review

Current production code does not yet contain this instrumentation. Before release,
record baseline for the same PP1 lesson, same approved STUDENT browser/network,
position zero, tab visible, no CPU/network throttling; distinguish Render wake-up
from warm playback. Record three warm runs and compare medians. No clearing
browser data, exporting cookies/HAR, changing enrollment or resetting a device.

For a reviewed candidate in a trusted test environment, enable numeric diagnostics
in that browser tab's Console:

```js
sessionStorage.setItem('uyym-player-timing', '1')
```

Reopen the lesson from the start. Console `[uyym-player]` records only fixed event
labels and milliseconds: `playback`, `media_init`, `media_0`, `first_frame_ready`,
`first_frame`. Request measurements include obtaining/signing the one-use proof
and consuming the response. `first_frame` is measured from Start watching (or
Retry) to the presented-frame callback; if unsupported, only the explicitly
separate `first_frame_ready` event exists. A request returning 200 alone is not a
frame measurement. Do not compare a resumed nonzero fragment against part=0.

In Network, record request Duration for playback and first media parts -1 and 0.
The response Timing pane exposes numeric `Server-Timing` phases: `access`,
`drive_token`, `drive_metadata`, `drive_permissions`, `drive_validate`,
`drive_headers`, `prepare`. `drive_body` only becomes known after streaming;
opt-in server log records with event `player_timing` include it and `total_ms`.
Those logs contain only kind, numeric part/status and phase durations, with no
request URL, grant/session/user/file IDs, provider response, tokens or keys.
No extra diagnostic endpoint, permissions or Render settings are needed.

Disable afterwards:

```js
sessionStorage.removeItem('uyym-player-timing')
```

Share only numeric timings/statuses and fixed error codes. For heartbeat 403,
Network -> failed heartbeat -> Response `code` distinguishes e.g.
`MEDIA_GRANT_EXPIRED` from proof failure; the supplied Console stack alone does
not establish the cause. Do not share Headers, full URLs, cookies or HAR.

## Acceptance gates

- PASS: local same-video MSE before/after frame measurement and phase timings.
- PASS: all four reads overlap and are repeated per part; public/changed/foreign/
  unverified Drive data fails closed; oversized/truncated/full-file Range fails.
- PASS: real BFF + fixture SQL/proof admission rechecks revoked grants after ACLs
  and after upstream headers; paused enrollment also blocks bytes; upstream
  cancellation; existing cross-user/course/device tests.
- PASS: staff progress listeners/timers/completion are absent; STUDENT progress
  listener lifecycle; server rejects valid staff progress requests.
- PASS: local browser previews for ADMIN and TEACHER, seek/play/pause, zero
  progress PATCH requests; STUDENT explicit completion sends one PATCH and shows
  success. Desktop and a narrow viewport (observed CSS width 433 px, no horizontal
  overflow) were checked. This does not emulate a real phone or Safari.
- PASS: final full suite 86 passed, one dedicated PostgreSQL test skipped;
  TypeScript and production build. Tests use only isolated/mocked providers.
- BLOCKED: real same-PP1-video before/after timings under an approved STUDENT
  session. No such session is available to the agent; screenshots report latency
  but do not contain a complete phase/frame measurement.
- BLOCKED: exact cause of production heartbeat 403 (Response code not supplied).
- BLOCKED: real Android/iPhone/Safari playback performance.

Do not represent local simulated-provider results as production acceptance or
publish automatically while the requested PP1 verification remains incomplete.
