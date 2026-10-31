import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL engine embedded in WASM. Supabase Auth/Storage integrations
// remain a separate live acceptance requirement. PGlite serializes queries,
// so these tests do not claim true multi-connection concurrency coverage.
let db: PGlite;
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, phone text);
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant all on storage.objects to anon,authenticated;
    create policy incidental_permissive_policy on storage.objects for all to anon,authenticated using(true) with check(true);
  `);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const filename of (await readdir(dir)).filter(x => x.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(filename, dir), 'utf8'));
  }
});

after(async () => { await db?.close(); });

async function fixture() {
  const admin = randomUUID(), student = randomUUID();
  for (const [id, role] of [[admin, 'ADMIN'], [student, 'STUDENT']]) {
    const phone = `+77${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    await db.query('insert into auth.users(id,phone) values($1,$2)', [id, phone]);
    await db.query('insert into private.app_users(id,phone,name,role,must_change_password) values($1,$2,$3,$4,false)', [id, phone, role === 'ADMIN' ? 'Test owner' : 'Test student', role]);
  }
  const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
  const device = randomUUID();
  await db.query('insert into private.device_bindings(id,user_id,public_key,label) values($1,$2,$3,$4)', [device, student, JSON.stringify(publicKey), 'Test browser']);
  await db.query('select * from private.approve_device($1,$2)', [admin, device]);
  return { admin, student, device, publicKey };
}

async function currentEpoch(user: string) {
  const result = await db.query<{ auth_epoch: number }>('select auth_epoch from private.app_users where id=$1', [user]);
  return Number(result.rows[0].auth_epoch);
}

async function openSession(student: string, device: string) {
  const result = await db.query<{ id: string }>('select private.open_application_session($1,$2,$3,$4,$5,false,1800) as id', [student, device, await currentEpoch(student), randomUUID() + randomUUID(), randomUUID() + randomUUID()]);
  return result.rows[0].id;
}

test('every migration executes; all private tables have FORCE RLS and browser roles lack schema/table/function grants', async () => {
  const rows = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r'`);
  assert.ok(rows.rows.length >= 20);
  for (const table of rows.rows) {
    assert.equal(table.relrowsecurity, true, table.relname);
    assert.equal(table.relforcerowsecurity, true, table.relname);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const grants = await db.query<{ schema_access: boolean; table_access: boolean }>(`select has_schema_privilege($1,'private','USAGE') as schema_access,has_table_privilege($1,$2,'SELECT') as table_access`, [role, `private.${table.relname}`]);
      assert.deepEqual(grants.rows[0], { schema_access: false, table_access: false });
    }
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const funcs = await db.query<{ allowed: boolean }>(`select has_function_privilege($1,p.oid,'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'`, [role]);
    assert.ok(funcs.rows.length >= 5);
    assert.ok(funcs.rows.every(row => row.allowed === false));
  }
});

test('a direct authenticated request cannot select application data or call privileged RPC', async () => {
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query('select * from private.courses'), /permission denied/);
    await assert.rejects(db.query('select private.revoke_device($1,$2)', [randomUUID(), randomUUID()]), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('restricted Storage policies defeat an existing permissive browser policy', async () => {
  await db.query(`insert into storage.buckets(id,name,public) values('other-public','other-public',true)`);
  await db.query(`insert into storage.objects(bucket_id,name) values('uyym-private','secret.pdf'),('other-public','public.pdf')`);
  await db.exec('set role authenticated');
  try {
    const result = await db.query<{ name: string }>('select name from storage.objects order by name');
    assert.deepEqual(result.rows, [{ name: 'public.pdf' }]);
    await assert.rejects(db.query(`insert into storage.objects(bucket_id,name) values('uyym-private','injected.cpp')`), /row-level security/);
    const changed = await db.query(`update storage.objects set name='renamed.pdf' where bucket_id='uyym-private' returning id`);
    assert.equal(changed.rows.length, 0);
  } finally { await db.exec('reset role'); }
});

test('only one live application session exists; another login cannot displace it', async () => {
  const { student, device } = await fixture();
  const session = await openSession(student, device);
  await assert.rejects(openSession(student, device), /live session already exists/);
  const old = await db.query<{ revoked_at: null }>('select revoked_at from private.app_sessions where id=$1', [session]);
  assert.equal(old.rows[0].revoked_at, null);
  const approved = await db.query<{ count: number }>(`select count(*)::integer as count from private.device_bindings where user_id=$1 and status='approved'`, [student]);
  assert.equal(approved.rows[0].count, 1);
});

test('logout, expiry and a password-reset flag preserve the approved browser binding', async () => {
  const { student, device } = await fixture();
  const session = await openSession(student, device);
  await db.query('update private.app_sessions set revoked_at=now() where id=$1', [session]);
  await db.query('update private.app_users set must_change_password=true where id=$1', [student]);
  await assert.rejects(openSession(student, device), /account unavailable/);
  await db.query('update private.app_users set must_change_password=false where id=$1', [student]);
  const second = await openSession(student, device);
  await db.query(`update private.app_sessions set created_at=now()-interval '1 hour',expires_at=now()-interval '1 second' where id=$1`, [second]);
  await openSession(student, device);
  const binding = await db.query<{ status: string }>('select status from private.device_bindings where id=$1', [device]);
  assert.equal(binding.rows[0].status, 'approved');
});

test('browser replacement atomically revokes old sessions, grants and tickets and increments epoch', async () => {
  const { admin, student, device, publicKey } = await fixture();
  const session = await openSession(student, device);
  const epoch = await currentEpoch(student);
  const course = (await db.query<{ id: string }>(`select id from private.courses where slug='calculus-i'`)).rows[0].id;
  const lesson = randomUUID();
  await db.query('insert into private.lessons(id,course_id,title) values($1,$2,$3)', [lesson, course, 'Test lesson']);
  await db.query(`insert into private.playback_grants(user_id,session_id,device_id,lesson_id,auth_epoch,expires_at) values($1,$2,$3,$4,$5,now()+interval '2 minutes')`, [student, session, device, lesson, epoch]);
  await db.query(`insert into private.login_tickets(user_id,device_id,token_hash,csrf_token,auth_epoch,expires_at) values($1,$2,$3,$4,$5,now()+interval '2 minutes')`, [student, device, randomUUID() + randomUUID(), randomUUID() + randomUUID(), epoch]);
  const next = randomUUID();
  await db.query('insert into private.device_bindings(id,user_id,public_key,label) values($1,$2,$3,$4)', [next, student, JSON.stringify(publicKey), 'Replacement browser']);
  await db.query('select * from private.approve_device($1,$2)', [admin, next]);
  assert.equal(await currentEpoch(student), epoch + 1);
  const bindings = await db.query<{ id: string; status: string }>('select id,status from private.device_bindings where user_id=$1', [student]);
  assert.equal(bindings.rows.find(x => x.id === device)?.status, 'revoked');
  assert.equal(bindings.rows.find(x => x.id === next)?.status, 'approved');
  for (const table of ['app_sessions', 'playback_grants', 'login_tickets']) {
    const left = await db.query<{ count: number }>(`select count(*)::integer as count from private.${table} where user_id=$1 and revoked_at is null`, [student]);
    assert.equal(left.rows[0].count, 0, table);
  }
  await assert.rejects(openSession(student, device), /browser not approved/);
  await openSession(student, next);
  const audit = await db.query<{ action: string }>(`select action from private.audit_log where subject_id=$1 and action='device.replaced'`, [student]);
  assert.equal(audit.rows.length, 1);
});

test('approved-device unique index rejects a second approved record even without application logic', async () => {
  const { admin, student, publicKey } = await fixture();
  await assert.rejects(db.query(`insert into private.device_bindings(user_id,public_key,label,status,approved_at,approved_by) values($1,$2,'Concurrent attempt','approved',now(),$3)`, [student, JSON.stringify(publicKey), admin]), /one_approved_device_per_user/);
});

test('only an active ADMIN can approve or revoke a browser', async () => {
  const { student, device } = await fixture();
  await assert.rejects(db.query('select private.revoke_device($1,$2)', [student, student]), /not permitted/);
  await assert.rejects(db.query('select * from private.approve_device($1,$2)', [student, device]), /not permitted/);
});

test('challenge consumption binds exact method, endpoint, body and session; replay fails', async () => {
  const { student, device } = await fixture();
  const session = await openSession(student, device);
  const id = randomUUID(), nonce = randomUUID() + randomUUID(), epoch = await currentEpoch(student);
  await db.query(`insert into private.challenges(id,user_id,session_id,device_id,purpose,method,path,nonce,auth_epoch,body_hash,expires_at) values($1,$2,$3,$4,'protected-resource','GET','/api/lessons/one?part=2',$5,$6,$7,now()+interval '60 seconds')`, [id, student, session, device, nonce, epoch, emptyHash]);
  const consume = async (method = 'GET', path = '/api/lessons/one?part=2', hash = emptyHash, context = session) => {
    const result = await db.query<{ ok: boolean }>(`select private.consume_challenge($1,$2,$3,$4,null,'protected-resource',$5,$6,$7,$8,$9) as ok`, [id, student, device, context, method, path, nonce, epoch, hash]);
    return result.rows[0].ok;
  };
  assert.equal(await consume('POST'), false);
  assert.equal(await consume('GET', '/api/lessons/other?part=2'), false);
  assert.equal(await consume('GET', '/api/lessons/one?part=3'), false);
  assert.equal(await consume('GET', '/api/lessons/one?part=2', 'a'.repeat(64)), false);
  assert.equal(await consume('GET', '/api/lessons/one?part=2', emptyHash, randomUUID()), false);
  assert.equal(await consume(), true);
  assert.equal(await consume(), false);
});

test('expired challenge and stale auth_epoch cannot be consumed', async () => {
  const { admin, student, device } = await fixture();
  const epoch = await currentEpoch(student), id = randomUUID(), nonce = randomUUID() + randomUUID();
  await db.query(`insert into private.challenges(id,user_id,device_id,purpose,method,path,nonce,auth_epoch,issued_at,expires_at) values($1,$2,$3,'login','POST','/api/auth/activate',$4,$5,now()-interval '90 seconds',now()-interval '30 seconds')`, [id, student, device, nonce, epoch]);
  const result = await db.query<{ ok: boolean }>(`select private.consume_challenge($1,$2,$3,null,null,'login','POST','/api/auth/activate',$4,$5,$6) as ok`, [id, student, device, nonce, epoch, emptyHash]);
  assert.equal(result.rows[0].ok, false);
  await db.query('select private.revoke_device($1,$2)', [admin, student]);
  assert.equal(await currentEpoch(student), epoch + 1);
  await assert.rejects(db.query('select private.open_application_session($1,$2,$3,$4,$5,false,1800)', [student, device, epoch, randomUUID() + randomUUID(), randomUUID() + randomUUID()]), /account unavailable/);
});

test('audit entries are append-only and reject common secret fields', async () => {
  const { admin, student } = await fixture();
  await assert.rejects(db.query(`insert into private.audit_log(actor_id,subject_id,action,target_type,metadata) values($1,$2,'test','user','{"password":"forbidden"}')`, [admin, student]), /check constraint/);
  await assert.rejects(db.query('delete from private.audit_log where subject_id=$1', [student]), /append-only/);
});

test('optional backend role has private runtime access without auth or DDL privileges', async () => {
  await db.exec(await readFile(new URL('../supabase/backend-role.sql', import.meta.url), 'utf8'));
  await db.exec('set role uyym_backend');
  try {
    const courses = await db.query('select id from private.courses');
    assert.equal(courses.rows.length, 3);
    for(const table of ['owner_drive_connection','owner_drive_oauth_requests','owner_drive_folders','teacher_video_upload_access','teacher_video_uploads','teacher_video_upload_events']){
      const permissions=await db.query<{can_select:boolean;can_insert:boolean;can_update:boolean;can_delete:boolean}>(`select has_table_privilege('uyym_backend',$1,'SELECT') can_select,has_table_privilege('uyym_backend',$1,'INSERT') can_insert,has_table_privilege('uyym_backend',$1,'UPDATE') can_update,has_table_privilege('uyym_backend',$1,'DELETE') can_delete`,[`private.${table}`]);
      assert.equal(permissions.rows[0].can_select,true,table);
      assert.equal(permissions.rows[0].can_delete,false,table);
    }
    assert.equal((await db.query<{allowed:boolean}>("select has_sequence_privilege('uyym_backend','private.teacher_video_upload_events_id_seq','USAGE') allowed")).rows[0].allowed,true);
    await assert.rejects(db.query('select * from auth.users'), /permission denied/);
    await assert.rejects(db.query('alter table private.courses add column injected text'), /must be owner/);
    await assert.rejects(db.query('truncate private.courses'), /permission denied/);
    await assert.rejects(db.query('delete from private.audit_log'), /permission denied/);
  } finally { await db.exec('reset role'); }
});
