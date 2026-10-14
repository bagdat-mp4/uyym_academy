# Authenticator setup error shown in the screenshot

The supplied cropped screenshot shows a QR/secret setup dialog with "Copy code"
and "Show QR code" controls. The current UYYM browser interface has neither of
these controls: it only verifies an existing administrator authenticator code.
The exact third-party service cannot be identified without its domain/header.
No UYYM security change is justified by this screenshot. Do not visit Supabase
by another route to investigate it.

Owner steps on the page where that dialog appeared:

1. Enable automatic date, time and timezone on the phone running the
   authenticator and on the computer. If the authenticator offers time
   correction/synchronization, use it.
2. In the authenticator, select the entry for that service and account. For a
   new setup, use the entry created for the currently displayed setup, not an
   older entry from an abandoned attempt. Keep the QR/secret private.
3. Wait for the next code cycle. Enter the fresh code on that same service's
   page promptly and confirm once. Do not send the code to the assistant.
4. If setup still fails, cancel this unfinished setup and restart setup through
   that service's own account-security settings. Preserve existing working
   MFA and recovery methods; do not disable them to get past this error.
5. If another fresh setup still fails, use that service's official support.
   Provide the non-sensitive error text and domain, not the secret, QR or code.

These are manual steps for the owner. They do not rotate UYYM's TOTP encryption
key or change its authentication checks.
