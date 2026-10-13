import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { cleanupTemporarySecurity } from '../server/cleanup.js';

let db: PGlite;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text);
    alter table storage.objects enable row level security;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    // Exercise an UPGRADE where the dedicated runtime role already exists.
    if (file.includes('004')) await db.exec(await readFile(new URL('../supabase/backend-role.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL(file, dir), 'utf8'));
  }
});
after(async () => { await db?.close(); });

async function user(role = 'STUDENT') {
  const id = randomUUID(), phone = `+77${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  await db.query('insert into auth.users(id) values($1)', [id]);
  await db.query('insert into private.app_users(id,phone,name,role,must_change_password) values($1,$2,$3,$4,false)', [id, phone, 'Management fixture', role]);
  return id;
}
async function cohort(capacity = 2) {
  const course = (await db.query<{ id: string }>(`select id from private.courses where slug='calculus-i'`)).rows[0].id;
  const id = randomUUID();
  await db.query('insert into private.groups(id,course_id,title,capacity) values($1,$2,$3,$4)', [id, course, 'Capacity fixture', capacity]);
  return { id, course };
}
async function enroll(group: Awaited<ReturnType<typeof cohort>>, actor: string, status: string, expires = '1 hour', starts = '-1 hour') {
  const id = randomUUID(), student = await user();
  await db.query(`insert into private.enrollments(id,user_id,course_id,group_id,status,starts_at,expires_at,created_by) values($1,$2,$3,$4,$5,now()+$6::interval,now()+$7::interval,$8)`, [id, student, group.course, group.id, status, starts, expires, actor]);
  return { id, student };
}

test('additive migration004 protects new private tables/functions and grants existing runtime role', async () => {
  for (const table of ['payment_corrections', 'auth_operations', 'mutation_receipts']) {
    const rls = (await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass`, [`private.${table}`])).rows[0];
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const access = (await db.query<{ allowed: boolean }>(`select has_table_privilege($1,$2,'SELECT') as allowed`, [role, `private.${table}`])).rows[0];
      assert.equal(access.allowed, false);
    }
    const runtime = (await db.query<{ allowed: boolean }>(`select has_table_privilege('uyym_backend',$1,'SELECT') as allowed`, [`private.${table}`])).rows[0];
    assert.equal(runtime.allowed, true);
  }
  const functions = await db.query<{ allowed: boolean }>(`select has_function_privilege('authenticated',p.oid,'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'`);
  assert.ok(functions.rows.every(x => !x.allowed));
  for (const table of ['payments', 'payment_corrections', 'mutation_receipts']) {
    const grants = (await db.query<{ update_allowed: boolean; delete_allowed: boolean }>(`select has_table_privilege('uyym_backend',$1,'UPDATE') as update_allowed,has_table_privilege('uyym_backend',$1,'DELETE') as delete_allowed`, [`private.${table}`])).rows[0];
    assert.deepEqual(grants, { update_allowed: false, delete_allowed: false });
  }
  const authGrants = (await db.query<{ update_allowed: boolean; delete_allowed: boolean }>(`select has_table_privilege('uyym_backend','private.auth_operations','UPDATE') as update_allowed,has_table_privilege('uyym_backend','private.auth_operations','DELETE') as delete_allowed`)).rows[0];
  assert.deepEqual(authGrants, { update_allowed: true, delete_allowed: false });
});

test('fresh runtime role can reconcile Auth operations but cannot erase their history', async () => {
  const fresh = new PGlite();
  try {
    await fresh.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) await fresh.exec(await readFile(new URL(file, dir), 'utf8'));
    await fresh.exec(await readFile(new URL('../supabase/backend-role.sql', import.meta.url), 'utf8'));
    const grants = (await fresh.query<{ select_allowed: boolean; insert_allowed: boolean; update_allowed: boolean; delete_allowed: boolean }>(`select has_table_privilege('uyym_backend','private.auth_operations','SELECT') as select_allowed,has_table_privilege('uyym_backend','private.auth_operations','INSERT') as insert_allowed,has_table_privilege('uyym_backend','private.auth_operations','UPDATE') as update_allowed,has_table_privilege('uyym_backend','private.auth_operations','DELETE') as delete_allowed`)).rows[0];
    assert.deepEqual(grants, { select_allowed: true, insert_allowed: true, update_allowed: true, delete_allowed: false });
    const applications = (await fresh.query<{ select_allowed: boolean; insert_allowed: boolean; update_allowed: boolean; delete_allowed: boolean }>(
      `select has_table_privilege('uyym_backend','private.registration_applications','SELECT') as select_allowed,
              has_table_privilege('uyym_backend','private.registration_applications','INSERT') as insert_allowed,
              has_table_privilege('uyym_backend','private.registration_applications','UPDATE') as update_allowed,
              has_table_privilege('uyym_backend','private.registration_applications','DELETE') as delete_allowed`,
    )).rows[0];
    assert.deepEqual(applications, { select_allowed: true, insert_allowed: true, update_allowed: true, delete_allowed: false });
    await fresh.exec('set role uyym_backend');
    await assert.rejects(fresh.query('delete from private.auth_operations where false'), /permission denied/);
    await fresh.exec('reset role');
  } finally { await fresh.close(); }
});

test('registration applications keep private access and reject duplicate pending or approved requests', async () => {
  const rls = (await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `select relrowsecurity,relforcerowsecurity from pg_class where oid='private.registration_applications'::regclass`,
  )).rows[0];
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const access = (await db.query<{ select_allowed: boolean; insert_allowed: boolean; update_allowed: boolean }>(
      `select has_table_privilege($1,'private.registration_applications','SELECT') as select_allowed,
              has_table_privilege($1,'private.registration_applications','INSERT') as insert_allowed,
              has_table_privilege($1,'private.registration_applications','UPDATE') as update_allowed`, [role],
    )).rows[0];
    assert.deepEqual(access, { select_allowed: false, insert_allowed: false, update_allowed: false });
  }
  const backend = (await db.query<{ select_allowed: boolean; insert_allowed: boolean; update_allowed: boolean; delete_allowed: boolean }>(
    `select has_table_privilege('uyym_backend','private.registration_applications','SELECT') as select_allowed,
            has_table_privilege('uyym_backend','private.registration_applications','INSERT') as insert_allowed,
            has_table_privilege('uyym_backend','private.registration_applications','UPDATE') as update_allowed,
            has_table_privilege('uyym_backend','private.registration_applications','DELETE') as delete_allowed`,
  )).rows[0];
  assert.deepEqual(backend, { select_allowed: true, insert_allowed: true, update_allowed: true, delete_allowed: false });

  const actor = await user('ADMIN'), student = await user(), group = await cohort();
  const phone = (await db.query<{ phone: string }>('select phone from private.app_users where id=$1', [student])).rows[0].phone;
  const add = () => db.query<{ id: string }>(
    'insert into private.registration_applications(name,phone,course_id) values($1,$2,$3) returning id',
    ['Registration fixture', phone, group.course],
  );
  const first = (await add()).rows[0].id;
  await assert.rejects(add(), /unique constraint/);
  await db.query("update private.registration_applications set status='rejected' where id=$1", [first]);
  const second = (await add()).rows[0].id;
  const enrollment = (await db.query<{ id: string }>(
    `insert into private.enrollments(user_id,course_id,group_id,status,starts_at,expires_at,created_by)
     values($1,$2,$3,'active',now(),now()+interval '6 weeks',$4) returning id`,
    [student, group.course, group.id, actor],
  )).rows[0].id;
  await db.query(
    `update private.registration_applications set status='approved',student_id=$2,enrollment_id=$3,approved_by=$4,approved_at=now() where id=$1`,
    [second, student, enrollment, actor],
  );
  await assert.rejects(add(), /unique constraint/);
});

test('future pending and paused enrollments reserve seats; revoked and elapsed rows release seats', async () => {
  const actor = await user('ADMIN'), group = await cohort(2);
  const first = await enroll(group, actor, 'pending', '2 days', '1 day');
  await enroll(group, actor, 'paused');
  await assert.rejects(enroll(group, actor, 'active'), /group capacity exceeded/);
  await db.query(`update private.enrollments set status='revoked',revoked_at=now(),revoked_by=$2,revocation_reason='Seat released' where id=$1`, [first.id, actor]);
  const next = await enroll(group, actor, 'active');
  await db.query(`update private.enrollments set starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1`, [next.id]);
  await enroll(group, actor, 'active');
  const count = (await db.query<{ n: number }>(`select count(*)::integer as n from private.enrollments where group_id=$1 and status in ('active','pending','paused') and expires_at>now()`, [group.id])).rows[0].n;
  assert.equal(count, 2);
});

test('management capacity writes reject repeatable snapshots instead of silently overbooking', async () => {
  const group = await cohort();
  await db.exec('begin isolation level repeatable read');
  try {
    await assert.rejects(db.query('select private.management_lock()'), /READ COMMITTED/);
  } finally { await db.exec('rollback'); }
  await db.exec('begin isolation level repeatable read');
  try {
    await assert.rejects(db.query('update private.groups set capacity=3 where id=$1', [group.id]), /READ COMMITTED/);
  } finally { await db.exec('rollback'); }
  await db.exec('begin isolation level read committed');
  try { await db.query('select private.management_lock()'); await db.exec('commit'); }
  catch (error) { await db.exec('rollback'); throw error; }
});

test('capacity reduction and group transfer cannot overbook either group', async () => {
  const actor = await user('ADMIN'), first = await cohort(2), second = await cohort(1);
  const e1 = await enroll(first, actor, 'active');
  await enroll(first, actor, 'active');
  const e2 = await enroll(second, actor, 'active');
  await assert.rejects(db.query('update private.groups set capacity=1 where id=$1', [first.id]), /below reserved seats/);
  await assert.rejects(db.query('update private.enrollments set group_id=$2 where id=$1', [e1.id, second.id]), /group capacity exceeded/);
  await db.query(`update private.enrollments set status='expired' where id=$1`, [e2.id]);
  await db.query('update private.enrollments set group_id=$2 where id=$1', [e1.id, second.id]);
  const result = (await db.query<{ group_id: string }>('select group_id from private.enrollments where id=$1', [e1.id])).rows[0];
  assert.equal(result.group_id, second.id);
});

test('management revisions advance automatically, and group dates reject reversed intervals', async () => {
  const group = await cohort();
  const updated = (await db.query<{ revision: number }>(`update private.groups set schedule_description='Дүйсенбі 18:00 · Asia/Almaty',revision=999 where id=$1 returning revision`, [group.id])).rows[0];
  assert.equal(Number(updated.revision), 2);
  await assert.rejects(db.query(`update private.groups set starts_at=now(),ends_at=now()-interval '1 day' where id=$1`, [group.id]), /groups_dates_check/);
  for (const table of ['courses', 'site_settings']) {
    const where = table === 'site_settings' ? 'id=true' : `id='${group.course}'`;
    const before = Number((await db.query<{ revision: number }>(`select revision from private.${table} where ${where}`)).rows[0].revision);
    const after = Number((await db.query<{ revision: number }>(`update private.${table} set revision=999 where ${where} returning revision`)).rows[0].revision);
    assert.equal(after, before + 1);
  }
});

test('payments and full correction history are append-only; duplicate correction revision fails', async () => {
  const actor = await user('ADMIN'), group = await cohort(), e = await enroll(group, actor, 'pending');
  const payment = randomUUID();
  await db.query(`insert into private.payments(id,enrollment_id,amount_kzt,paid_at,recorded_by,method) values($1,$2,60000,now(),$3,'bank_transfer')`, [payment, e.id, actor]);
  await db.query(`insert into private.payment_corrections(payment_id,revision,amount_kzt,paid_at,method,state,reason,recorded_by) values($1,1,50000,now(),'bank_transfer','posted','Corrected amount',$2),($1,2,50000,now(),'bank_transfer','voided','Duplicate receipt',$2)`, [payment, actor]);
  await assert.rejects(db.query(`update private.payments set amount_kzt=1 where id=$1`, [payment]), /append-only/);
  await assert.rejects(db.query(`delete from private.payment_corrections where payment_id=$1`, [payment]), /append-only/);
  await assert.rejects(db.query(`insert into private.payment_corrections(payment_id,revision,amount_kzt,paid_at,state,reason,recorded_by) values($1,2,50000,now(),'posted','Duplicate revision',$2)`, [payment, actor]), /unique constraint/);
  const last = (await db.query<{ state: string; revision: number }>(`select state,revision from private.payment_corrections where payment_id=$1 order by revision desc limit 1`, [payment])).rows[0];
  assert.deepEqual(last, { state: 'voided', revision: 2 });
  const status = (await db.query<{ status: string }>('select status from private.enrollments where id=$1', [e.id])).rows[0].status;
  assert.equal(status, 'pending', 'payment recording never activates enrollment');
});

test('secretless Auth intent reserves one unfinished operation; completed operations retain recovery history', async () => {
  const actor = await user('ADMIN'), subject = await user(), op = randomUUID();
  await db.query(`insert into private.auth_operations(id,actor_id,action,request_hash,target_user_id,state) values($1,$2,'reset_password',$3,$4,'inflight')`, [op, actor, hash('safe reset intent'), subject]);
  await db.query('update private.app_users set auth_operation_id=$2 where id=$1', [subject, op]);
  await assert.rejects(db.query(`insert into private.auth_operations(id,actor_id,action,request_hash,target_user_id) values($1,$2,'reset_password',$3,$4)`, [randomUUID(), actor, hash('safe duplicate intent'), subject]), /auth_operations_one_reset_user/);
  await assert.rejects(db.query(`update private.auth_operations set last_error_code='unsafe remote error containing a token' where id=$1`, [op]), /check constraint/);
  await db.query(`update private.auth_operations set state='reconcile_required',last_error_code='REMOTE_TIMEOUT' where id=$1`, [op]);
  assert.equal((await db.query<{ auth_operation_id: string }>('select auth_operation_id from private.app_users where id=$1', [subject])).rows[0].auth_operation_id, op);
  await db.query(`update private.auth_operations set state='completed',completed_at=now() where id=$1`, [op]);
  await db.query('update private.app_users set auth_operation_id=null where id=$1', [subject]);
  await db.query(`insert into private.auth_operations(id,actor_id,action,request_hash,target_user_id) values($1,$2,'reset_password',$3,$4)`, [randomUUID(), actor, hash('new explicit reset intent'), subject]);
  const columns = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema='private' and table_name='auth_operations'`)).rows.map(x => x.column_name);
  for (const forbidden of ['password', 'temporary_password', 'access_token', 'refresh_token', 'response', 'payload']) assert.ok(!columns.includes(forbidden));
});

test('idempotency receipts reject secrets, arbitrary/nested responses and mutation of stored results', async () => {
  const actor = await user('ADMIN'), op = randomUUID();
  const insert = (id: string, response: unknown) => db.query(`insert into private.mutation_receipts(operation_id,actor_id,action,request_hash,response) values($1,$2,'group.created',$3,$4)`, [id, actor, hash('safe group intent'), JSON.stringify(response)]);
  await insert(op, { id: randomUUID(), revision: 1, ok: true });
  await assert.rejects(insert(op, { ok: true }), /unique constraint/);
  await assert.rejects(insert(randomUUID(), { temporary_password: 'must-not-store' }), /check constraint/);
  await assert.rejects(insert(randomUUID(), { id: { password: 'nested' } }), /check constraint/);
  await assert.rejects(insert(randomUUID(), { name: 'arbitrary user profile' }), /check constraint/);
  await assert.rejects(db.query(`update private.mutation_receipts set response='{}' where operation_id=$1`, [op]), /immutable/);
});

test('bounded cleanup respects FKs/retention and never deletes bindings, users, operations, receipts or audit', async () => {
  const actor = await user('ADMIN'), student = await user(), device = randomUUID();
  await db.query('insert into private.device_bindings(id,user_id,public_key,label) values($1,$2,$3,$4)', [device, student, JSON.stringify(key), 'Cleanup fixture browser']);
  await db.query('select * from private.approve_device($1,$2)', [actor, device]);
  const epoch = Number((await db.query<{ auth_epoch: number }>('select auth_epoch from private.app_users where id=$1', [student])).rows[0].auth_epoch);
  const oldSession = randomUUID(), liveSession = randomUUID(), oldTicket = randomUUID(), liveTicket = randomUUID();
  const token = () => randomUUID() + randomUUID();
  await db.query(`insert into private.app_sessions(id,user_id,device_id,token_hash,csrf_token,auth_epoch,created_at,expires_at,revoked_at) values($1,$2,$3,$4,$5,$6,now()-interval '40 days',now()-interval '39 days',now()-interval '38 days')`, [oldSession, student, device, token(), token(), epoch]);
  await db.query(`insert into private.app_sessions(id,user_id,device_id,token_hash,csrf_token,auth_epoch,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '30 minutes')`, [liveSession, student, device, token(), token(), epoch]);
  await db.query(`insert into private.login_tickets(id,user_id,device_id,token_hash,csrf_token,auth_epoch,created_at,expires_at,revoked_at) values($1,$2,$3,$4,$5,$6,now()-interval '40 days',now()-interval '39 days',now()-interval '38 days')`, [oldTicket, student, device, token(), token(), epoch]);
  await db.query(`insert into private.login_tickets(id,user_id,device_id,token_hash,csrf_token,auth_epoch,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '15 minutes')`, [liveTicket, student, device, token(), token(), epoch]);
  for (const [session, ticket] of [[oldSession, null], [null, oldTicket]]) {
    await db.query(`insert into private.challenges(user_id,session_id,ticket_id,device_id,purpose,method,path,nonce,auth_epoch,issued_at,expires_at) values($1,$2,$3,$4,'api','GET','/api/test',$5,$6,now()-interval '40 days',now()-interval '40 days'+interval '45 seconds')`, [student, session, ticket, device, token(), epoch]);
  }
  const liveChallenge = randomUUID();
  await db.query(`insert into private.challenges(id,user_id,session_id,device_id,purpose,method,path,nonce,auth_epoch,expires_at) values($1,$2,$3,$4,'api','GET','/api/test',$5,$6,now()+interval '45 seconds')`, [liveChallenge, student, liveSession, device, token(), epoch]);
  const course = (await db.query<{ id: string }>(`select id from private.courses limit 1`)).rows[0].id, lesson = randomUUID();
  await db.query('insert into private.lessons(id,course_id,title) values($1,$2,$3)', [lesson, course, 'Cleanup grant fixture']);
  await db.query(`insert into private.playback_grants(user_id,session_id,device_id,lesson_id,auth_epoch,created_at,expires_at) values($1,$2,$3,$4,$5,now()-interval '40 days',now()-interval '39 days')`, [student, oldSession, device, lesson, epoch]);
  const liveGrant = randomUUID();
  await db.query(`insert into private.playback_grants(id,user_id,session_id,device_id,lesson_id,auth_epoch,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`, [liveGrant, student, liveSession, device, lesson, epoch]);
  const staleRate = hash('old-rate-key'), liveRate = hash('live-rate-key');
  await db.query(`insert into private.security_rate_limits(key_hash,window_start,attempts) values($1,now()-interval '2 days',1),($2,now(),8)`, [staleRate, liveRate]);
  const permanentTables = ['app_users', 'device_bindings', 'audit_log', 'auth_operations', 'mutation_receipts'];
  const permanent = new Map<string, number>();
  for (const table of permanentTables) permanent.set(table, (await db.query<{ n: number }>(`select count(*)::integer as n from private.${table}`)).rows[0].n);
  const run = async () => {
    await db.exec('begin');
    try { const result = await cleanupTemporarySecurity(db as any, 1); await db.exec('commit'); return result; }
    catch (error) { await db.exec('rollback'); throw error; }
  };
  for (let i = 0; i < 5; i++) {
    const result = await run();
    assert.ok(Object.values(result).every(n => n <= 1), 'every deletion is bounded');
  }
  assert.deepEqual(await run(), { challenges: 0, playback_grants: 0, login_tickets: 0, app_sessions: 0, rate_limits: 0 });
  for (const [table, expected] of permanent) assert.equal((await db.query<{ n: number }>(`select count(*)::integer as n from private.${table}`)).rows[0].n, expected, table);
  for (const [table, id] of [['app_sessions', liveSession], ['login_tickets', liveTicket], ['challenges', liveChallenge], ['playback_grants', liveGrant]]) assert.equal((await db.query(`select id from private.${table} where id=$1`, [id])).rows.length, 1);
  assert.equal((await db.query('select key_hash from private.security_rate_limits where key_hash=$1', [liveRate])).rows.length, 1);
  assert.equal((await db.query('select id from private.app_sessions where id=$1', [oldSession])).rows.length, 0);
  assert.equal((await db.query('select id from private.login_tickets where id=$1', [oldTicket])).rows.length, 0);
  await assert.rejects(cleanupTemporarySecurity(db as any, 1001), /1\.\.1000/);
});

test('REAL PostgreSQL: two connections racing for last seat cannot overbook', { skip: !process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL absent: embedded PostgreSQL is serial and cannot prove multi-connection races' : false }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3, statement_timeout: 10000 });
  const schema = `uyym_race_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^uyym_race_[a-f0-9]{32}$/);
  const source = await readFile(new URL('../supabase/migrations/202610110004_management.sql', import.meta.url), 'utf8');
  const extractFunction = (name: string) => {
    const match = new RegExp(`create function private\\.${name}\\([\\s\\S]*?\\n\\$\\$;`).exec(source);
    assert.ok(match, `extract production SQL function ${name}`);
    return match[0].replaceAll('private', schema);
  };
  let one: pg.PoolClient | undefined, two: pg.PoolClient | undefined;
  try {
    await pool.query(`create schema ${schema}`);
    await pool.query(`create table ${schema}.groups(id uuid primary key,capacity integer not null);
      create table ${schema}.enrollments(id uuid primary key,group_id uuid references ${schema}.groups(id),status text not null,starts_at timestamptz not null,expires_at timestamptz not null);`);
    for (const name of ['management_lock', 'management_before_statement', 'enforce_enrollment_capacity', 'enforce_group_capacity']) await pool.query(extractFunction(name));
    await pool.query(`create trigger enrollment_statement before insert or update or delete on ${schema}.enrollments for each statement execute function ${schema}.management_before_statement();
      create trigger group_statement before insert or update or delete on ${schema}.groups for each statement execute function ${schema}.management_before_statement();
      create trigger enrollment_capacity before insert or update on ${schema}.enrollments for each row execute function ${schema}.enforce_enrollment_capacity();
      create trigger group_capacity before update of capacity on ${schema}.groups for each row execute function ${schema}.enforce_group_capacity();`);
    const group = randomUUID();
    await pool.query(`insert into ${schema}.groups values($1,1)`, [group]);
    one = await pool.connect(); two = await pool.connect();
    await one.query('begin isolation level read committed');
    await two.query('begin isolation level read committed');
    const pid = (await two.query('select pg_backend_pid() as pid')).rows[0].pid;
    await one.query(`insert into ${schema}.enrollments values($1,$2,'active',now(),now()+interval '1 hour')`, [randomUUID(), group]);
    const pending = two.query(`insert into ${schema}.enrollments values($1,$2,'pending',now()+interval '1 minute',now()+interval '1 hour')`, [randomUUID(), group]);
    let blocked = false;
    for (let i = 0; i < 20; i++) {
      const result = await pool.query(`select wait_event_type from pg_stat_activity where pid=$1`, [pid]);
      if (result.rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(blocked, true, 'second real connection waits on management advisory lock');
    await one.query('commit');
    await assert.rejects(pending, /group capacity exceeded/);
    await two.query('rollback');
    assert.equal(Number((await pool.query(`select count(*) as n from ${schema}.enrollments`)).rows[0].n), 1);
  } finally {
    await one?.query('rollback').catch(() => {}); await two?.query('rollback').catch(() => {});
    one?.release(); two?.release();
    // Only this verified random test schema is removed; no existing private
    // schema, user data, Supabase tables or external resources are changed.
    await pool.query(`drop schema if exists ${schema} cascade`);
    await pool.end();
  }
});
