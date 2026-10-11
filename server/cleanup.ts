import type pg from 'pg';

export interface CleanupCounts { challenges: number; playback_grants: number; login_tickets: number; app_sessions: number; rate_limits: number }
type CleanupClient = Pick<pg.PoolClient, 'query'>;

/** Run INSIDE a transaction. No users, devices, audit, financial history or
 * operation receipts are deleted. Retention is fixed, not supplied by HTTP.
 * User row locks share proof/device order; SKIP LOCKED permits safe workers. */
export async function cleanupTemporarySecurity(db: CleanupClient, batch = 200): Promise<CleanupCounts> {
  if (!Number.isInteger(batch) || batch < 1 || batch > 1000) throw new Error('Cleanup batch must be 1..1000');
  const counts: CleanupCounts = { challenges: 0, playback_grants: 0, login_tickets: 0, app_sessions: 0, rate_limits: 0 };
  const candidates = await db.query<{ id: string }>(`
    SELECT u.id FROM private.app_users u
    WHERE EXISTS(SELECT 1 FROM private.challenges c WHERE c.user_id=u.id AND (c.expires_at < now()-interval '24 hours' OR c.consumed_at < now()-interval '24 hours'))
       OR EXISTS(SELECT 1 FROM private.playback_grants g WHERE g.user_id=u.id AND (g.expires_at < now()-interval '24 hours' OR g.revoked_at < now()-interval '24 hours'))
       OR EXISTS(SELECT 1 FROM private.login_tickets t WHERE t.user_id=u.id AND (t.expires_at < now()-interval '30 days' OR t.revoked_at < now()-interval '30 days') AND NOT EXISTS(SELECT 1 FROM private.challenges c WHERE c.ticket_id=t.id))
       OR EXISTS(SELECT 1 FROM private.app_sessions s WHERE s.user_id=u.id AND (s.expires_at < now()-interval '30 days' OR s.revoked_at < now()-interval '30 days') AND NOT EXISTS(SELECT 1 FROM private.challenges c WHERE c.session_id=s.id) AND NOT EXISTS(SELECT 1 FROM private.playback_grants g WHERE g.session_id=s.id))
    ORDER BY u.id LIMIT $1 FOR UPDATE OF u SKIP LOCKED`, [batch]);
  const users = candidates.rows.map(row => row.id);
  // Children first. Every delete is independently bounded. FK NOT EXISTS
  // guards keep a parent if any retained or concurrently issued child remains.
  const deletions = [
    ['challenges', `user_id=ANY($1::uuid[]) AND (expires_at<now()-interval '24 hours' OR consumed_at<now()-interval '24 hours')`, 'expires_at'],
    ['playback_grants', `user_id=ANY($1::uuid[]) AND (expires_at<now()-interval '24 hours' OR revoked_at<now()-interval '24 hours')`, 'expires_at'],
    ['login_tickets', `user_id=ANY($1::uuid[]) AND (expires_at<now()-interval '30 days' OR revoked_at<now()-interval '30 days') AND NOT EXISTS(SELECT 1 FROM private.challenges c WHERE c.ticket_id=t.id)`, 'expires_at'],
    ['app_sessions', `user_id=ANY($1::uuid[]) AND (expires_at<now()-interval '30 days' OR revoked_at<now()-interval '30 days') AND NOT EXISTS(SELECT 1 FROM private.challenges c WHERE c.session_id=t.id) AND NOT EXISTS(SELECT 1 FROM private.playback_grants g WHERE g.session_id=t.id)`, 'expires_at']
  ] as const;
  for (const [table, predicate, order] of deletions) {
    const result = await db.query(`WITH doomed AS (SELECT t.id FROM private.${table} t WHERE ${predicate} ORDER BY t.${order},t.id LIMIT $2 FOR UPDATE OF t SKIP LOCKED) DELETE FROM private.${table} t USING doomed d WHERE t.id=d.id RETURNING t.id`, [users, batch]);
    counts[table] = result.rows.length;
  }
  const limits = await db.query(`WITH doomed AS (SELECT key_hash FROM private.security_rate_limits WHERE window_start<now()-interval '24 hours' ORDER BY window_start,key_hash LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM private.security_rate_limits t USING doomed d WHERE t.key_hash=d.key_hash RETURNING t.key_hash`, [batch]);
  counts.rate_limits = limits.rows.length;
  return counts;
}
