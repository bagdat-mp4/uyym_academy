# Add another administrator

Use the existing UYYM website, never the Supabase dashboard or a direct SQL role
change. Each person has an individual phone/password account, approved browser,
TOTP authenticator and offline recovery codes. The first owner remains unchanged.

1. In ADMIN → Users, search the verified phone first to avoid a duplicate account.
   If absent, create a TEACHER account with the verified name/phone. Do not assign
   courses or groups just to provision this account. Hand the one-response random
   temporary password to the person through your verified private contact.
2. On that user's row, choose **Invite ADMIN**. Verify the recipient's identity,
   confirm full administrator access, and enter your own fresh authenticator code.
   If you just signed in, wait for the next code. No ADMIN rights exist yet.
3. The recipient signs in, changes the temporary password and submits a browser
   request. The existing administrator verifies and approves that exact request
   under Browsers. Password possession alone never approves a browser.
4. The recipient signs in from the approved profile and opens **Administrator
   invitation**. In their own authenticator, manually add a time-based entry
   called UYYM Academy with the key shown only in their account. Enter its code,
   confirm responsibility for full ADMIN access, and activate ADMIN.
5. Save the one-response recovery codes offline, then return to sign-in. Sign in
   again with the personal password and TOTP. The code used for setup cannot be
   reused; wait for a new code. Check Users and an authorized read-only action.

The invitation lasts 24 hours. Setup tokens last 10 minutes and bind the recipient,
exact session, auth epoch and invitation. Generate a new setup key if needed;
only the confirmed key becomes active. The inviting administrator cannot view
the recipient's key or recovery codes. **Cancel invitation** invalidates pending
setup tokens. Invitations from an inactive issuer are rejected.

Promotion runs in one serialized transaction: encrypted TOTP and hashed recovery
codes are written with the ADMIN role, auth epoch increases, and all prior
sessions/tickets/playback grants close. The registered browser stays bound.
Other administrators' passwords, keys and sessions are unaffected. If the final
response is lost, sign in with the newly configured TOTP; recovery codes cannot
be retrieved again. Use the existing secure administrator recovery procedure
for lost access; never reset only the encryption key.

Implementation uses immutable non-secret management receipts as the invitation
ledger. No migration, new API keys or Supabase settings change is required. The
setup secret is server-generated and carried in an authenticated encrypted token
in recipient browser memory, then encrypted in the existing administrator field
on acceptance. Neither setup/recovery secrets nor OTPs enter receipts or audit
metadata. Both owner and recipient writes require the existing device proof,
CSRF checks, active session and server-side rights; OTP attempts have persistent
per-user throttling. The existing create-user API still rejects ADMIN injection.

All additional ADMIN accounts have the platform's full ADMIN role. This is not a
restricted assistant role. Existing ADMIN protection still prevents editing or
resetting administrators through ordinary user management.
