# UYYM Academy: Render deployment and DNS cutover

The app is one Node web service: Fastify serves `dist/client` and `/api` on the same origin. Vercel Functions' 4.5 MB request limit is smaller than the application's supported homework upload. Do not deploy only `dist/client`: that would leave authentication, lessons and private media unavailable.

## Before creating the service

1. Push the reviewed commit to the private `bagdat-mp4/uyym_academy` repository. Never commit `.env`, Google credentials, local video, or `supabase/.temp`.
2. Confirm migrations through `008` exist in Supabase project `yadwvngmlviwevbsmcdt`. Keep a tested database backup and the owner recovery procedure available.
3. Verify the dedicated Google Drive service account can access only the restricted lesson folders and that the allowed folder and email lists match the intended files.

## Render web service

Connect the **private** GitHub repository and `main` branch. Use Node 22, build command `npm ci && npm run build`, start command `npm start`, and health check path `/api/health`. Select the region closest to the Supabase database. Start with the temporary `*.onrender.com` URL; keep Name.com unchanged until its HTTPS checks pass. Render Free is suitable only for a preview: it spins down on idle and may suspend for high outbound Drive traffic. The always-on `0.5c-512mb` service is currently $7/month before usage charges; obtain the owner's choice before selecting it.

Set these server-only environment variables in Render, never in GitHub or Vite:

| Name | Value or purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Exact temporary HTTPS Render origin until cutover; then `https://uyym.app` |
| `APP_ALLOWED_ORIGINS` | After cutover, exact temporary Render origin and `https://www.uyym.app`, comma-separated |
| `COOKIE_SECURE` | `true` |
| `DATABASE_URL` | Supabase backend database connection string with SSL and least-privileged role |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Existing Supabase project values; service role is server-only |
| `ADMIN_ENCRYPTION_KEY` | Existing key used for stored TOTP secret; do **not** regenerate during migration |
| `DRIVE_ALLOWED_FOLDER_IDS`, `DRIVE_ALLOWED_PERMISSION_EMAILS` | Existing restricted Drive configuration |
| `GOOGLE_APPLICATION_CREDENTIALS_BASE64` | Base64 of the existing service-account JSON, stored as a server-only secret |

The Google service-account JSON can alternatively be added as a Render **Secret File** named `google-drive.json`, with `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-drive.json`. Preserve its exact content but do not add it to the repo. Set `PORT` only if Render does not provide one; the server reads the platform `PORT` and binds `0.0.0.0`. `TRUST_LOCAL_PROXY` must remain false on Render. Copy optional content limits from `.env.example` if changed from defaults. Use Render's secret dashboard to set values; never send them in chat or expose them through build logs.

## Temporary HTTPS verification

Verify the Render deployment is Live, `/api/health` returns 200, `/` and an internal navigation URL return HTML, `/api/public` returns the real courses with `configured:true`, assets load, and `/api/auth/status` returns an unauthenticated state without errors. Load the PP1 application but do not submit a duplicate real application. Confirm a foreign Origin cannot POST and that admin login/TOTP is reachable only through the existing approved browser. Review Render logs for startup and request errors. The separate-student browser and long-video tests are still pending; record them honestly.

## Domain cutover

Add `uyym.app` and `www.uyym.app` in Render's Custom Domains. Read the **exact records shown in that dashboard**. Only after the temporary HTTPS URL passes, replace the old website records at Name.com: root `A` currently `216.198.79.1`, `www` CNAME currently `85d9f6843d8e21aa.vercel-dns-017.com`. Leave all MX, TXT, SPF, DKIM and other unrelated records untouched. Do not guess the new targets; copy them from Render. Keep the old Vercel deployment available for rollback.

After the new domain resolves and Render provisions TLS, change `APP_ORIGIN` to `https://uyym.app`, include the temporary URL and `https://www.uyym.app` in `APP_ALLOWED_ORIGINS`, and redeploy. Test apex and www TLS, Render's www-to-apex redirect, login and TOTP from the approved browser, public PP1 form without resubmitting, protected content, cookies (`Secure`, `HttpOnly`, `SameSite=Strict`), and browser network requests for any `localhost` reference. The current phone/password server flow does not use Supabase browser redirects; if OAuth or email recovery is added, set the Supabase Site URL and redirect allowlist to the HTTPS domain first.

Rollback: restore the prior two website DNS records in Name.com and keep Render secrets intact while investigating. DNS cache expiry can delay rollback. Do not close the old Vercel deployment until the new domain works end to end.
