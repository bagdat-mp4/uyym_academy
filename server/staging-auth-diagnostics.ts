export const stagingAuthFailureChecks = [
  'totp_context_missing_or_expired',
  'totp_csrf_rejected',
  'totp_login_ticket_required',
  'totp_admin_role_required',
  'totp_password_change_required',
  'totp_rate_limited',
  'totp_authenticator_missing',
  'totp_code_invalid_or_replayed',
  'totp_auth_epoch_changed',
  'totp_login_ticket_expired_or_revoked',
  'totp_browser_not_approvable',
] as const;

export type StagingAuthFailureCheck = typeof stagingAuthFailureChecks[number];

export function logStagingAuthFailure(
  check: StagingAuthFailureCheck,
  env: NodeJS.ProcessEnv = process.env,
  write: (line: string) => void = line => console.warn(line),
) {
  if (env.NODE_ENV !== 'test' || env.UYYM_UI_DRIVE_STAGING !== '1') return;
  // Fixed field names and an allowlisted check identifier only. Never add request,
  // account, browser, code, cookie, token, or database values to this diagnostic.
  write(JSON.stringify({ event: 'staging_auth_check_failed', check }));
}
