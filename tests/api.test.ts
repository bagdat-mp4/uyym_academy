import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from 'fastify';
import { PGlite } from '@electric-sql/pglite';

// Actual Fastify BFF routes + real PostgreSQL SQL + actual Web Crypto proofs.
// ONLY Supabase Auth's remote HTTP responses are simulated here. This does not
// verify a live Supabase configuration, Drive permissions, or video decoding.
let db: PGlite, app: FastifyInstance;
let restoreFetch: typeof fetch;
let originalPoolEnd: (() => Promise<void>) | undefined;
const origin = 'https://uyym-test.example';
const accounts = new Map<string, { id: string; password: string; app_metadata?:Record<string,string> }>();
let authFailure: 'create-before' | 'create-after' | 'reset-before' | 'reset-after' | undefined;
const createAttempts=new Map<string,number>();
let createGate:{entered:()=>void;wait:Promise<void>}|undefined;
let phoneCounter = 1;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
type Browser = { key: CryptoKeyPair; jwk: JsonWebKey; cookies: Map<string, string>; csrf: string; sessionId?: string;ip:string };
let browserCounter=1;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.APP_ORIGIN = origin;
  process.env.COOKIE_SECURE = 'true';
  process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/postgres';
  process.env.SUPABASE_URL = 'https://supabase-test.example';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-never-production';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key-never-production';
  process.env.ADMIN_ENCRYPTION_KEY = 'ab'.repeat(32);
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,phone text);
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;
  `);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const filename of (await readdir(dir)).filter(x => x.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(filename, dir), 'utf8'));
  const { pool } = await import('../server/db.js');
  originalPoolEnd = pool.end.bind(pool);
  const query = async (sql: string, params: unknown[] = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0, command: '', oid: 0, fields: [] };
  };
  // Adapter changes the transport, not any SQL or application authorization.
  (pool as any).query = query;
  (pool as any).connect = async () => ({ query, release() {} });
  restoreFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === 'https://supabase-test.example/auth/v1/token?grant_type=password' && init?.method === 'POST') {
      const account = accounts.get(body.phone);
      if (!account || account.password !== body.password) return new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ user: { id: account.id }, access_token: 'SIMULATED_SUPABASE_JWT_MUST_NOT_ESCAPE', refresh_token: 'SIMULATED_REFRESH_MUST_NOT_ESCAPE' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if(url==='https://supabase-test.example/auth/v1/admin/users'&&init?.method==='POST'){
      createAttempts.set(body.phone,(createAttempts.get(body.phone)||0)+1);
      if(authFailure==='create-before'){authFailure=undefined;throw new Error('Simulated Auth create unavailable before commit');}
      if(createGate){const gate=createGate;createGate=undefined;gate.entered();await gate.wait;}
      if(accounts.has(body.phone))return new Response('{}',{status:422});
      await db.query('insert into auth.users(id,phone) values($1,$2)',[body.id,body.phone]);
      accounts.set(body.phone,{id:body.id,password:body.password,app_metadata:body.app_metadata});
      if(authFailure==='create-after'){authFailure=undefined;throw new Error('Simulated response loss after Auth commit');}
      return Response.json({id:body.id,phone:body.phone,app_metadata:body.app_metadata});
    }
    const adminPassword = /^https:\/\/supabase-test\.example\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/.exec(url);
    if(adminPassword&&init?.method==='GET'){
      const entry=[...accounts.entries()].find(([,v])=>v.id===adminPassword[1]);
      return entry?Response.json({id:entry[1].id,phone:entry[0],app_metadata:entry[1].app_metadata||{}}):new Response('{}',{status:404});
    }
    if (adminPassword && init?.method === 'PUT') {
      const account = [...accounts.values()].find(x => x.id === adminPassword[1]);
      assert.ok(account, 'password reset must target a fixture account');
      if(authFailure==='reset-before'){authFailure=undefined;throw new Error('Simulated Auth unavailable');}
      account.password = body.password;
      if(body.app_metadata)account.app_metadata={...account.app_metadata,...body.app_metadata};
      if(authFailure==='reset-after'){authFailure=undefined;throw new Error('Simulated response loss after reset');}
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected external HTTP request in API test: ${url}`);
  };
  ({ app } = await import('../server/index.js'));
  await app.ready();
});

after(async () => {
  globalThis.fetch = restoreFetch;
  await app?.close();
  await originalPoolEnd?.();
  await db?.close();
});

async function browser(): Promise<Browser> {
  const key = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;
  assert.equal(key.privateKey.extractable, false);
  const jwk = await webcrypto.subtle.exportKey('jwk', key.publicKey);
  return { key, jwk, cookies: new Map(), csrf: '',ip:`127.0.1.${browserCounter++}` };
}

function remember(result: LightMyRequestResponse, b: Browser) {
  const header = result.headers['set-cookie'];
  for (const cookie of header ? Array.isArray(header) ? header : [header] : []) {
    const pair = /^([^=]+)=([^;]*)/.exec(cookie);
    if (!pair) continue;
    if (/Max-Age=0/i.test(cookie) || !pair[2]) b.cookies.delete(pair[1]); else b.cookies.set(pair[1], pair[2]);
  }
  if (result.statusCode === 200) {
    const data = result.json();
    if (data.csrf_token) b.csrf = data.csrf_token;
    if (data.session_id) b.sessionId = data.session_id;
  }
}

async function request(b: Browser, method: HTTPMethods, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
  if (method !== 'GET' && method !== 'HEAD') { headers.origin = origin; headers['content-type'] = 'application/json'; headers['x-csrf-token'] = b.csrf; }
  const result = await app.inject({ method, url, headers,remoteAddress:b.ip, ...(body !== undefined ? { payload: body as any } : {}) });
  remember(result, b);
  return result;
}

async function account(role: 'ADMIN' | 'TEACHER' | 'STUDENT' = 'STUDENT', temporary = false) {
  const id = randomUUID(), phone = `+7707${String(phoneCounter++).padStart(7, '0')}`, password = 'Fixture-only-password-0123';
  accounts.set(phone, { id, password });
  await db.query('insert into auth.users(id,phone) values($1,$2)', [id, phone]);
  await db.query('insert into private.app_users(id,phone,name,role,must_change_password) values($1,$2,$3,$4,$5)', [id, phone, `${role} fixture`, role, temporary]);
  return { id, phone, password };
}

async function login(b: Browser, a: Awaited<ReturnType<typeof account>>, password = accounts.get(a.phone)!.password) {
  return request(b, 'POST', '/api/auth/login', { phone: a.phone, password, public_key: b.jwk, label: 'Test browser profile' });
}

async function proofHeaders(b: Browser, method: HTTPMethods, path: string, purpose = 'api', body?: unknown) {
  const response = await request(b, 'POST', '/api/proof/challenge', { method, path, purpose, body_hash: sha(body === undefined ? '' : JSON.stringify(body)) });
  assert.equal(response.statusCode, 200, response.body);
  const challenge = response.json();
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, b.key.privateKey, new TextEncoder().encode(challenge.payload));
  return { 'x-proof-id': challenge.id, 'x-device-proof': Buffer.from(signature).toString('base64url') };
}

async function signed(b: Browser, method: HTTPMethods, path: string, purpose = 'api', body?: unknown) {
  return request(b, method, path, body, await proofHeaders(b, method, path, purpose, body));
}

async function activate(b: Browser) {
  return signed(b, 'POST', '/api/auth/activate', 'login', {});
}

async function approvedStudent() {
  const a = await account(), owner = await account('ADMIN'), b = await browser();
  assert.equal((await login(b, a)).statusCode, 200);
  const d = (await db.query<{ id: string }>(`select id from private.device_bindings where user_id=$1 and status='pending'`, [a.id])).rows[0].id;
  await db.query('select * from private.approve_device($1,$2)', [owner.id, d]);
  assert.equal((await login(b, a)).statusCode, 200);
  assert.equal((await activate(b)).statusCode, 200);
  return { a, owner, b, deviceId: d };
}

async function administrator() {
  const a = await account('ADMIN'), b = await browser();
  const { encrypt, totp } = await import('../server/security.js');
  const secret = 'JBSWY3DPEHPK3PXP';
  const counter = Math.floor(Date.now() / 30000);
  await db.query('update private.app_users set admin_totp_secret_encrypted=$2,admin_totp_last_counter=$3 where id=$1', [a.id, encrypt(secret, process.env.ADMIN_ENCRYPTION_KEY!), counter - 2]);
  assert.equal((await login(b, a)).statusCode, 200);
  assert.equal((await request(b, 'POST', '/api/auth/totp', { code: totp(secret, counter) })).statusCode, 200);
  assert.equal((await activate(b)).statusCode, 200);
  return { a, b, secret, counter };
}

test('temporary-password login exposes setup only; password change still cannot approve browser', async () => {
  const a = await account('STUDENT', true), b = await browser();
  const response = await login(b, a);
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.equal(data.session_active, false);
  assert.equal(data.device_status, 'pending');
  assert.equal(data.user.must_change_password, true);
  assert.ok(!response.body.includes('SIMULATED_SUPABASE') && !response.body.includes('SIMULATED_REFRESH'));
  assert.ok(String(response.headers['set-cookie']).includes('HttpOnly'));
  assert.ok(String(response.headers['set-cookie']).includes('Secure'));
  assert.ok(String(response.headers['set-cookie']).includes('SameSite=Strict'));
  assert.equal((await request(b, 'GET', '/api/lessons')).statusCode, 403);
  assert.equal((await request(b, 'POST', '/api/auth/change-password', { password: 'Changed-password-0123456789' })).statusCode, 200);
  const challenge = await request(b, 'POST', '/api/proof/challenge', { method: 'POST', path: '/api/auth/activate', purpose: 'login', body_hash: sha('{}') });
  assert.equal(challenge.statusCode, 403);
  assert.match(challenge.body, /Бұл аккаунт басқа құрылғыға тіркелген/);
  const active = await db.query<{ count: number }>(`select count(*)::integer as count from private.app_sessions where user_id=$1 and revoked_at is null`, [a.id]);
  assert.equal(active.rows[0].count, 0);
});

test('approved key activates application session; copied cookie alone and another key are denied', async () => {
  const { a, b } = await approvedStudent();
  const response = await signed(b, 'GET', '/api/lessons');
  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers['cache-control']), /no-store/);
  assert.equal((await request(b, 'GET', '/api/lessons')).statusCode, 403);
  const copied = await browser();
  copied.cookies = new Map(b.cookies); copied.csrf = b.csrf;
  const invalidProof = await signed(copied, 'GET', '/api/lessons');
  assert.equal(invalidProof.statusCode, 403);
  const sessions = await db.query<{ count: number }>(`select count(*)::integer as count from private.app_sessions where user_id=$1 and revoked_at is null`, [a.id]);
  assert.equal(sessions.rows[0].count, 1);
  assert.equal((await signed(b, 'GET', '/api/lessons')).statusCode, 200);
});

test('correct password in a second browser never evicts the approved student', async () => {
  const { a, b, deviceId } = await approvedStudent();
  const original = b.sessionId;
  const second = await browser();
  assert.equal((await login(second, a)).statusCode, 200);
  const response = await request(second, 'POST', '/api/proof/challenge', { method: 'POST', path: '/api/auth/activate', purpose: 'login', body_hash: sha('{}') });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /Бұл аккаунт басқа құрылғыға тіркелген/);
  assert.equal((await signed(b, 'GET', '/api/lessons')).statusCode, 200);
  const session = await db.query<{ id: string; device_id: string }>(`select id,device_id from private.app_sessions where user_id=$1 and revoked_at is null`, [a.id]);
  assert.deepEqual(session.rows, [{ id: original!, device_id: deviceId }]);
});

test('proof cannot transfer endpoint/method/body; one-use replay is rejected by actual routes', async () => {
  const { b } = await approvedStudent();
  const headers = await proofHeaders(b, 'GET', '/api/lessons');
  assert.equal((await request(b, 'GET', '/api/admin/device-requests', undefined, headers)).statusCode, 403);
  assert.equal((await request(b, 'GET', '/api/lessons', undefined, headers)).statusCode, 200);
  assert.equal((await request(b, 'GET', '/api/lessons', undefined, headers)).statusCode, 403);
  const refresh = await proofHeaders(b, 'POST', '/api/auth/refresh', 'refresh', {});
  assert.equal((await request(b, 'POST', '/api/auth/refresh', { injected: true }, refresh)).statusCode, 403);
  assert.equal((await request(b, 'GET', '/api/auth/refresh', undefined, refresh)).statusCode, 404);
  assert.equal((await request(b, 'POST', '/api/auth/refresh', {}, refresh)).statusCode, 200);
});

test('logout preserves binding; approved profile can reauthenticate while cleared-data profile stays blocked', async () => {
  const { a, b, deviceId } = await approvedStudent();
  assert.equal((await request(b, 'POST', '/api/auth/logout', {})).statusCode, 200);
  assert.equal((await request(b, 'GET', '/api/auth/status')).json().authenticated, false);
  const d = await db.query<{ status: string }>('select status from private.device_bindings where id=$1', [deviceId]);
  assert.equal(d.rows[0].status, 'approved');
  assert.equal((await login(b, a)).statusCode, 200);
  assert.equal((await activate(b)).statusCode, 200);
  const cleared = await browser();
  assert.equal((await login(cleared, a)).statusCode, 200);
  assert.equal((await request(cleared, 'POST', '/api/proof/challenge', { method: 'POST', path: '/api/auth/activate', purpose: 'login' })).statusCode, 403);
  assert.equal((await signed(b, 'GET', '/api/lessons')).statusCode, 200);
});

test('expired enrollment and foreign course do not open lessons despite a valid proof', async () => {
  const { a, owner, b } = await approvedStudent();
  const courses = (await db.query<{ id: string; slug: string }>('select id,slug from private.courses')).rows;
  const permitted = courses.find(x => x.slug === 'calculus-i')!.id, foreign = courses.find(x => x.slug === 'linear-algebra')!.id;
  const lesson = randomUUID(), foreignLesson = randomUUID();
  await db.query(`insert into private.lessons(id,course_id,title,published) values($1,$2,'Allowed fixture',true),($3,$4,'Foreign fixture',true)`, [lesson, permitted, foreignLesson, foreign]);
  await db.query(`insert into private.enrollments(user_id,course_id,status,starts_at,expires_at,created_by) values($1,$2,'active',now()-interval '1 hour',now()+interval '1 hour',$3)`, [a.id, permitted, owner.id]);
  const response = await signed(b, 'GET', '/api/lessons');
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(response.json().lessons.some((x: any) => x.id === lesson));
  assert.ok(!response.json().lessons.some((x: any) => x.id === foreignLesson));
  assert.equal((await signed(b, 'POST', `/api/lessons/${foreignLesson}/playback`, 'playback', {})).statusCode, 404);
  await db.query(`update private.enrollments set starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where user_id=$1 and course_id=$2`, [a.id, permitted]);
  assert.ok(!(await signed(b, 'GET', '/api/lessons')).json().lessons.some((x: any) => x.id === lesson));
  assert.equal((await signed(b, 'POST', `/api/lessons/${lesson}/playback`, 'playback', {})).statusCode, 404);
});

test('student proof cannot use ADMIN endpoints and non-JSON or foreign-Origin writes are rejected', async () => {
  const { b } = await approvedStudent();
  assert.equal((await signed(b, 'GET', '/api/admin/device-requests')).statusCode, 403);
  const cookies = [...b.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const foreign = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookies, origin: 'https://foreign.example', 'content-type': 'application/json', 'x-csrf-token': b.csrf }, payload: {} });
  assert.equal(foreign.statusCode, 403);
  const badCsrf = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookies, origin, 'content-type': 'application/json', 'x-csrf-token': 'invalid' }, payload: {} });
  assert.equal(badCsrf.statusCode, 403);
  const form = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookies, origin, 'content-type': 'text/plain', 'x-csrf-token': b.csrf }, payload: '{}' });
  assert.equal(form.statusCode, 403);
  assert.equal((await signed(b, 'GET', '/api/lessons')).statusCode, 200);
});

test('wrong credentials use generic error and persistent phone limiter bounds password attempts', async () => {
  const a = await account(), b = await browser();
  for (let i = 0; i < 8; i++) {
    const response = await login(b, a, 'incorrect-password');
    assert.equal(response.statusCode, 401);
    assert.ok(!response.body.includes(a.phone) && !response.body.includes(a.id));
  }
  const limited = await login(b, a, 'incorrect-password');
  assert.equal(limited.statusCode, 429);
  const devices = await db.query<{ count: number }>('select count(*)::integer as count from private.device_bindings where user_id=$1', [a.id]);
  assert.equal(devices.rows[0].count, 0);
});

test('ADMIN TOTP is required before self-browser approval, and a consumed TOTP code cannot be reused', async () => {
  const a = await account('ADMIN'), b = await browser();
  const { encrypt, totp } = await import('../server/security.js');
  const secret = 'JBSWY3DPEHPK3PXP', counter = Math.floor(Date.now() / 30000);
  await db.query('update private.app_users set admin_totp_secret_encrypted=$2,admin_totp_last_counter=$3 where id=$1', [a.id, encrypt(secret, process.env.ADMIN_ENCRYPTION_KEY!), counter - 2]);
  const first = await login(b, a);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().user.totp_required, true);
  const stale = await browser(); stale.cookies = new Map(b.cookies); stale.csrf = b.csrf;
  assert.equal((await request(b, 'POST', '/api/proof/challenge', { method: 'POST', path: '/api/auth/activate', purpose: 'login' })).statusCode, 403);
  assert.equal((await request(b, 'POST', '/api/auth/totp', { code: totp(secret, counter) })).statusCode, 200);
  assert.equal((await request(stale, 'GET', '/api/auth/status')).json().authenticated, false);
  assert.equal((await activate(b)).statusCode, 200);
  assert.equal((await signed(b, 'GET', '/api/admin/device-requests')).statusCode, 200);
  const currentSessionCookies = new Map(b.cookies), currentCsrf = b.csrf;
  assert.equal((await login(b, a)).statusCode, 200);
  assert.equal((await request(b, 'POST', '/api/auth/totp', { code: totp(secret, counter) })).statusCode, 403);
  b.cookies = currentSessionCookies; b.csrf = currentCsrf;
  assert.equal((await signed(b, 'GET', '/api/admin/device-requests')).statusCode, 200);
});

test('actual ADMIN approval endpoint replaces student browser and invalidates old cookie and playback grants', async () => {
  const owner = await administrator(), a = await account(), original = await browser();
  assert.equal((await login(original, a)).statusCode, 200);
  const requests = await signed(owner.b, 'GET', '/api/admin/device-requests');
  assert.equal(requests.statusCode, 200, requests.body);
  const firstRequest = requests.json().requests.find((x: any) => x.phone === a.phone);
  assert.ok(firstRequest.key_fingerprint && firstRequest.key_fingerprint.length === 64);
  assert.equal((await signed(owner.b, 'POST', `/api/admin/devices/${firstRequest.id}/approve`, 'api', {})).statusCode, 200);
  assert.equal((await request(original, 'GET', '/api/auth/status')).json().authenticated, false);
  assert.equal((await login(original, a)).statusCode, 200);
  assert.equal((await activate(original)).statusCode, 200);
  const oldSession = original.sessionId!;
  const course = (await db.query<{ id: string }>(`select id from private.courses where slug='pp1'`)).rows[0].id, lesson = randomUUID();
  await db.query(`insert into private.lessons(id,course_id,title) values($1,$2,'Grant fixture')`, [lesson, course]);
  const old = (await db.query<{ user_id: string; device_id: string; auth_epoch: number }>('select user_id,device_id,auth_epoch from private.app_sessions where id=$1', [oldSession])).rows[0];
  await db.query(`insert into private.playback_grants(user_id,session_id,device_id,lesson_id,auth_epoch,expires_at) values($1,$2,$3,$4,$5,now()+interval '5 minutes')`, [a.id, oldSession, old.device_id, lesson, old.auth_epoch]);
  const second = await browser();
  assert.equal((await login(second, a)).statusCode, 200);
  const next = (await signed(owner.b, 'GET', '/api/admin/device-requests')).json().requests.find((x: any) => x.phone === a.phone);
  assert.equal(next.replacement, true);
  assert.equal((await signed(owner.b, 'POST', `/api/admin/devices/${next.id}/approve`, 'api', {})).statusCode, 200);
  assert.equal((await request(original, 'GET', '/api/auth/status')).json().authenticated, false);
  assert.equal((await request(original, 'GET', '/api/lessons')).statusCode, 401);
  const grants = await db.query<{ count: number }>('select count(*)::integer as count from private.playback_grants where session_id=$1 and revoked_at is null', [oldSession]);
  assert.equal(grants.rows[0].count, 0);
  assert.equal((await login(second, a)).statusCode, 200);
  assert.equal((await activate(second)).statusCode, 200);
  assert.equal((await signed(second, 'GET', '/api/lessons')).statusCode, 200);
});

test('TEACHER sees only assigned group lessons and cannot use global ADMIN endpoints', async () => {
  const a = await account('TEACHER'), owner = await account('ADMIN'), b = await browser();
  assert.equal((await login(b, a)).statusCode, 200);
  const device = (await db.query<{ id: string }>('select id from private.device_bindings where user_id=$1', [a.id])).rows[0].id;
  await db.query('select * from private.approve_device($1,$2)', [owner.id, device]);
  assert.equal((await login(b, a)).statusCode, 200);
  assert.equal((await activate(b)).statusCode, 200);
  const course = (await db.query<{ id: string }>(`select id from private.courses where slug='linear-algebra'`)).rows[0].id;
  const assigned = randomUUID(), foreign = randomUUID(), ownLesson = randomUUID(), foreignLesson = randomUUID();
  await db.query(`insert into private.groups(id,course_id,title) values($1,$2,'Assigned group'),($3,$2,'Foreign group')`, [assigned, course, foreign]);
  await db.query('insert into private.teacher_assignments(teacher_id,course_id,group_id,created_by) values($1,$2,$3,$4)', [a.id, course, assigned, owner.id]);
  await db.query(`insert into private.lessons(id,course_id,group_id,title,published) values($1,$2,$3,'Own group lesson',true),($4,$2,$5,'Foreign group lesson',true)`, [ownLesson, course, assigned, foreignLesson, foreign]);
  const lessons = (await signed(b, 'GET', '/api/lessons')).json().lessons;
  assert.ok(lessons.some((x: any) => x.id === ownLesson));
  assert.ok(!lessons.some((x: any) => x.id === foreignLesson));
  assert.equal((await signed(b, 'POST', `/api/lessons/${foreignLesson}/playback`, 'playback', {})).statusCode, 404);
  assert.equal((await signed(b, 'GET', '/api/admin/device-requests')).statusCode, 403);
  assert.equal((await signed(b, 'POST', `/api/admin/users/${a.id}/revoke-device`, 'api', {})).statusCode, 403);
});

test('playback manifest hides Drive IDs; grants cannot transfer accounts and pause/revoke blocks new media admission', async () => {
  const first = await approvedStudent(), second = await approvedStudent();
  const course = (await db.query<{ id: string }>(`select id from private.courses where slug='calculus-i'`)).rows[0].id;
  const lesson = randomUUID(), foreignLesson = randomUUID();
  await db.query(`insert into private.lessons(id,course_id,title,published,video_codec,video_duration_seconds) values($1,$2,'Playback authorization fixture',true,'avc1.42c01f,mp4a.40.2',4),($3,$2,'Wrong lesson fixture',true,'avc1.42c01f,mp4a.40.2',4)`, [lesson, course, foreignLesson]);
  await db.query(`insert into private.lesson_video_parts(lesson_id,part_index,drive_file_id,drive_folder_id,size_bytes,start_seconds,duration_seconds) values($1,-1,'SERVER_ONLY_INIT_ID','SERVER_ONLY_FOLDER',128,0,0),($1,0,'SERVER_ONLY_PART_ID','SERVER_ONLY_FOLDER',1024,0,4)`, [lesson]);
  for (const fixture of [first, second]) {
    await db.query(`insert into private.enrollments(user_id,course_id,status,starts_at,expires_at,created_by) values($1,$2,'active',now()-interval '1 hour',now()+interval '1 hour',$3)`, [fixture.a.id, course, fixture.owner.id]);
  }
  const manifest = await signed(first.b, 'POST', `/api/lessons/${lesson}/playback`, 'playback', {});
  assert.equal(manifest.statusCode, 200, manifest.body);
  assert.ok(!manifest.body.includes('SERVER_ONLY') && !manifest.body.includes('drive_file_id'));
  assert.equal(manifest.json().parts.length, 2);
  assert.equal(manifest.json().duration_seconds, 4);
  assert.ok(manifest.json().watermark.includes('•••••'));
  const grant = manifest.json().grant_id;
  assert.equal((await signed(first.b, 'POST', `/api/playback/${grant}/heartbeat`, 'heartbeat', {})).statusCode, 200);
  assert.equal((await signed(second.b, 'GET', `/api/media/${lesson}?grant=${grant}&part=0`, 'media')).statusCode, 403);
  assert.equal((await signed(first.b, 'GET', `/api/media/${foreignLesson}?grant=${grant}&part=0`, 'media')).statusCode, 404);
  const invalidGrant=await signed(first.b,'GET',`/api/media/${lesson}?grant=${randomUUID()}&part=0`,'media');
  assert.equal(invalidGrant.statusCode,403);assert.equal(invalidGrant.json().code,'MEDIA_GRANT_EXPIRED');
  await db.query("update private.playback_grants set heartbeat_at=now()-interval '36 seconds' where id=$1",[grant]);
  const staleGrant=await signed(first.b,'GET',`/api/media/${lesson}?grant=${grant}&part=0`,'media');
  assert.equal(staleGrant.statusCode,403);assert.equal(staleGrant.json().code,'MEDIA_GRANT_EXPIRED');
  await db.query('update private.playback_grants set heartbeat_at=now() where id=$1',[grant]);
  await db.query(`update private.enrollments set status='paused' where user_id=$1 and course_id=$2`, [first.a.id, course]);
  assert.equal((await signed(first.b, 'POST', `/api/playback/${grant}/heartbeat`, 'heartbeat', {})).statusCode, 404);
  assert.equal((await signed(first.b, 'GET', `/api/media/${lesson}?grant=${grant}&part=0`, 'media')).statusCode, 404);
  await db.query('select private.revoke_device($1,$2)', [first.owner.id, first.a.id]);
  assert.equal((await request(first.b, 'GET', `/api/media/${lesson}?grant=${grant}&part=0`)).statusCode, 401);
  // No successful binary request was made here: remote Drive and actual video
  // playback remain outside the explicitly simulated Auth + local SQL suite.
});

test('student sees only published announcements and saves viewing progress with explicit completion', async()=>{
 const student=await approvedStudent(),course=(await db.query<{id:string}>("select id from private.courses where slug='calculus-i'")).rows[0].id;
 const group=randomUUID(),lesson=randomUUID();
 await db.query(`insert into private.groups(id,course_id,title,schedule_description) values($1,$2,'Progress group','Mon 18:00 · Asia/Almaty')`,[group,course]);
 await db.query(`insert into private.enrollments(user_id,course_id,group_id,status,starts_at,expires_at,created_by) values($1,$2,$3,'active',now()-interval '1 hour',now()+interval '1 day',$4)`,[student.a.id,course,group,student.owner.id]);
 await db.query(`insert into private.lessons(id,course_id,group_id,title,published,video_duration_seconds) values($1,$2,$3,'Progress lesson',true,120)`,[lesson,course,group]);
 await db.query(`insert into private.announcements(course_id,group_id,title,body,published,created_by) values($1,$2,'Visible announcement','Published body',true,$3),($1,$2,'Draft announcement','Hidden body',false,$3)`,[course,group,student.owner.id]);
 const first=await signed(student.b,'PATCH',`/api/lessons/${lesson}/progress`,'api',{position_seconds:42,completed:false});
 assert.equal(first.statusCode,200,first.body);assert.equal(first.json().completed_at,null);
 const content=await signed(student.b,'GET',`/api/courses/${course}/content`);
 assert.equal(content.statusCode,200,content.body);
 assert.deepEqual(content.json().announcements.map((x:any)=>x.title),['Visible announcement']);
 assert.equal(content.json().groups[0].schedule_description,'Mon 18:00 · Asia/Almaty');
 const listed=content.json().lessons.find((x:any)=>x.id===lesson);assert.equal(Number(listed.progress_seconds),42);assert.equal(listed.completed_at,null);
 const completed=await signed(student.b,'PATCH',`/api/lessons/${lesson}/progress`,'api',{position_seconds:70,completed:true});
 assert.equal(completed.statusCode,200,completed.body);assert.ok(completed.json().completed_at);
 assert.equal((await signed(student.b,'GET',`/api/lessons/${lesson}/attendance`)).statusCode,403);
 const outsider=await approvedStudent();
 assert.equal((await signed(outsider.b,'PATCH',`/api/lessons/${lesson}/progress`,'api',{position_seconds:1,completed:false})).statusCode,404);
});

test('teacher announcements and attendance stay inside assigned groups',async()=>{
 const teacher=await account('TEACHER'),owner=await account('ADMIN'),browserProfile=await browser();
 assert.equal((await login(browserProfile,teacher)).statusCode,200);
 const device=(await db.query<{id:string}>('select id from private.device_bindings where user_id=$1',[teacher.id])).rows[0].id;
 await db.query('select * from private.approve_device($1,$2)',[owner.id,device]);
 assert.equal((await login(browserProfile,teacher)).statusCode,200);assert.equal((await activate(browserProfile)).statusCode,200);
 const student=await account('STUDENT'),course=(await db.query<{id:string}>("select id from private.courses where slug='linear-algebra'")).rows[0].id;
 const ownGroup=randomUUID(),foreignGroup=randomUUID(),ownLesson=randomUUID(),foreignLesson=randomUUID();
 await db.query(`insert into private.groups(id,course_id,title) values($1,$3,'Teacher group'),($2,$3,'Foreign group')`,[ownGroup,foreignGroup,course]);
 await db.query('insert into private.teacher_assignments(teacher_id,course_id,group_id,created_by) values($1,$2,$3,$4)',[teacher.id,course,ownGroup,owner.id]);
 await db.query(`insert into private.lessons(id,course_id,group_id,title) values($1,$3,$4,'Own attendance'),($2,$3,$5,'Foreign attendance')`,[ownLesson,foreignLesson,course,ownGroup,foreignGroup]);
 await db.query(`insert into private.enrollments(user_id,course_id,group_id,status,starts_at,expires_at,created_by) values($1,$2,$3,'active',now()-interval '1 hour',now()+interval '1 day',$4)`,[student.id,course,ownGroup,owner.id]);
 const ownAnnouncement={operation_id:randomUUID(),course_id:course,group_id:ownGroup,title:'Class update',body:'Bring your notes.',published:true};
 assert.equal((await signed(browserProfile,'POST','/api/content/announcements','api',ownAnnouncement)).statusCode,200);
 const foreignAnnouncement={...ownAnnouncement,operation_id:randomUUID(),group_id:foreignGroup};
 assert.equal((await signed(browserProfile,'POST','/api/content/announcements','api',foreignAnnouncement)).statusCode,403);
 const body={operation_id:randomUUID(),records:[{user_id:student.id,status:'present'}]};
 assert.equal((await signed(browserProfile,'PUT',`/api/lessons/${ownLesson}/attendance`,'api',body)).statusCode,200);
 const roster=await signed(browserProfile,'GET',`/api/lessons/${ownLesson}/attendance`);assert.equal(roster.statusCode,200,roster.body);assert.equal(roster.json().items[0].status,'present');
 assert.equal((await signed(browserProfile,'GET',`/api/lessons/${foreignLesson}/attendance`)).statusCode,404);
 assert.equal((await signed(browserProfile,'PUT',`/api/lessons/${foreignLesson}/attendance`,'api',{...body,operation_id:randomUUID()})).statusCode,404);
});

test('account creation is idempotent; password is one-response only and ADMIN role injection is rejected',async()=>{
 const owner=await administrator();const body={operation_id:randomUUID(),name:'Provisioned test student',phone:`+7707${String(phoneCounter++).padStart(7,'0')}`,role:'STUDENT',identity_verified:true};
 const response=await signed(owner.b,'POST','/api/admin/users','api',body);assert.equal(response.statusCode,201,response.body);
 const result=response.json();assert.equal(result.status,'completed');assert.ok(result.temporary_password.length>=32);assert.ok(result.user.must_change_password);
 const replay=await signed(owner.b,'POST','/api/admin/users','api',body);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().user.id,result.user.id);assert.equal(replay.json().temporary_password,undefined);
 const ledger=(await db.query('select row_to_json(o) as data from private.auth_operations o where id=$1',[body.operation_id])).rows[0];assert.ok(!JSON.stringify(ledger).includes(result.temporary_password));
 const audit=(await db.query('select metadata from private.audit_log where target_id=$1',[result.user.id])).rows;assert.ok(!JSON.stringify(audit).includes(result.temporary_password));
 assert.equal((await signed(owner.b,'POST','/api/admin/users','api',{...body,name:'Changed replay'})).statusCode,409);
 assert.equal((await signed(owner.b,'POST','/api/admin/users','api',{...body,operation_id:randomUUID(),role:'ADMIN'})).statusCode,400);
 const b=await browser();assert.equal((await login(b,{...result.user,password:result.temporary_password},result.temporary_password)).statusCode,200);
 assert.equal((await request(b,'POST','/api/proof/challenge',{method:'GET',path:'/api/admin/users',purpose:'api'})).statusCode,403);
 const student=await approvedStudent();assert.equal((await signed(student.b,'GET','/api/admin/users')).statusCode,403);
});

test('public PP1 application is normalized, approved once, enrolled, and scoped to the selected course',async()=>{
 const pp1=(await db.query<{id:string}>("select id from private.courses where slug='pp1'")).rows[0].id;
 const publicBrowser=await browser(),phone=`+7707${String(phoneCounter++).padStart(7,'0')}`;
 const payload={name:'PP1 application student',phone:phone.replace('+7','8 '),course_id:pp1};
 const submitted=await request(publicBrowser,'POST','/api/applications',payload);
 assert.equal(submitted.statusCode,201,submitted.body);assert.equal(submitted.json().application.status,'pending');
 assert.equal((await request(publicBrowser,'POST','/api/applications',payload)).statusCode,409);
 assert.equal((await request(publicBrowser,'POST','/api/applications',{phone,course_id:pp1})).statusCode,400);
 assert.equal((await request(publicBrowser,'POST','/api/applications',{name:'Unknown course',phone:`+7707${String(phoneCounter++).padStart(7,'0')}`,course_id:randomUUID()})).statusCode,400);

 const owner=await administrator();
 assert.equal((await request(publicBrowser,'GET','/api/admin/applications')).statusCode,401);
 const list=await signed(owner.b,'GET','/api/admin/applications?page=1&page_size=20&q=PP1');
 assert.equal(list.statusCode,200,list.body);
 const application=list.json().items.find((item:any)=>item.id===submitted.json().application.id);assert.ok(application);assert.equal(application.phone,phone);
 const operationId=randomUUID(),path=`/api/admin/applications/${application.id}/approve`,approval={operation_id:operationId,identity_verified:true};
 const approved=await signed(owner.b,'POST',path,'api',approval);
 assert.equal(approved.statusCode,201,approved.body);const result=approved.json();assert.equal(result.application.status,'approved');assert.ok(result.temporary_password);
 const replay=await signed(owner.b,'POST',path,'api',approval);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().temporary_password,undefined);
 const secondApproval=await signed(owner.b,'POST',path,'api',{...approval,operation_id:randomUUID()});assert.equal(secondApproval.statusCode,200,secondApproval.body);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.app_users where phone=$1',[phone])).rows[0].n,1);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.enrollments where user_id=$1 and course_id=$2',[result.user.id,pp1])).rows[0].n,1);

 const studentBrowser=await browser(),student={id:result.user.id,phone,password:result.temporary_password};
 const firstLogin=await login(studentBrowser,student,result.temporary_password);assert.equal(firstLogin.statusCode,200,firstLogin.body);assert.equal(firstLogin.json().user.must_change_password,true);
 assert.equal((await request(studentBrowser,'POST','/api/auth/change-password',{password:'PP1-changed-password-0123456789'})).statusCode,200);
 const requests=await signed(owner.b,'GET','/api/admin/device-requests');const pending=requests.json().requests.find((item:any)=>item.phone===phone);assert.ok(pending);
 assert.equal((await signed(owner.b,'POST',`/api/admin/devices/${pending.id}/approve`,'api',{})).statusCode,200);
 accounts.get(phone)!.password='PP1-changed-password-0123456789';
 assert.equal((await login(studentBrowser,student,'PP1-changed-password-0123456789')).statusCode,200);
 assert.equal((await activate(studentBrowser)).statusCode,200);
 const courses=await signed(studentBrowser,'GET','/api/courses');assert.equal(courses.statusCode,200,courses.body);assert.deepEqual(courses.json().courses.map((course:any)=>course.id),[pp1]);
 assert.equal((await signed(studentBrowser,'GET','/api/admin/applications')).statusCode,403);
});

test('owner can reject a pending application without creating an account, then applicant may resubmit',async()=>{
 const pp1=(await db.query<{id:string}>("select id from private.courses where slug='pp1'")).rows[0].id;
 const phone=`+7707${String(phoneCounter++).padStart(7,'0')}`;
 const publicBrowser=await browser(),payload={name:'Rejected PP1 test',phone,course_id:pp1};
 const submitted=await request(publicBrowser,'POST','/api/applications',payload);
 assert.equal(submitted.statusCode,201,submitted.body);
 const first=submitted.json().application;
 const owner=await administrator(),student=await approvedStudent();
 const path=`/api/admin/applications/${first.id}/reject`;
 const body={operation_id:randomUUID(),revision:1};
 assert.equal((await signed(student.b,'POST',path,'api',body)).statusCode,403);
 assert.equal((await signed(owner.b,'POST',path,'api',{...body,revision:2})).statusCode,409);
 const rejected=await signed(owner.b,'POST',path,'api',body);
 assert.equal(rejected.statusCode,200,rejected.body);
 assert.equal(rejected.json().ok,true);
 assert.equal((await db.query<{status:string}>('select status from private.registration_applications where id=$1',[first.id])).rows[0].status,'rejected');
 const replay=await signed(owner.b,'POST',path,'api',body);
 assert.equal(replay.statusCode,200,replay.body);
 assert.equal(replay.json().replayed,true);
 assert.equal((await signed(owner.b,'POST',path,'api',{operation_id:randomUUID(),revision:1})).statusCode,409);
 assert.equal((await db.query<{n:number}>("select count(*)::int as n from private.audit_log where action='application.rejected' and target_id=$1",[first.id])).rows[0].n,1);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.app_users where phone=$1',[phone])).rows[0].n,0);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.enrollments e join private.app_users u on u.id=e.user_id where u.phone=$1',[phone])).rows[0].n,0);
 const resubmitted=await request(publicBrowser,'POST','/api/applications',payload);
 assert.equal(resubmitted.statusCode,201);
 const secondPath=`/api/admin/applications/${resubmitted.json().application.id}/reject`;
 assert.equal((await signed(owner.b,'POST',secondPath,'api',body)).statusCode,409);
});

test('lost Auth create response reconciles the preallocated identity without duplicates or password replay',async()=>{
 const owner=await administrator(),body={operation_id:randomUUID(),name:'Lost response fixture',phone:`+7707${String(phoneCounter++).padStart(7,'0')}`,role:'TEACHER',identity_verified:true};
 authFailure='create-after';const pending=await signed(owner.b,'POST','/api/admin/users','api',body);assert.equal(pending.statusCode,202,pending.body);assert.equal(pending.json().status,'reconcile_required');
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.app_users where phone=$1',[body.phone])).rows[0].n,0);
 const retry=await signed(owner.b,'POST','/api/admin/users','api',body);assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().status,'completed');assert.equal(retry.json().temporary_password,undefined);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from auth.users where phone=$1',[body.phone])).rows[0].n,1);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.app_users where phone=$1',[body.phone])).rows[0].n,1);
});

test('block and password reset revoke sessions/tickets/grants while preserving approved browser',async()=>{
 const owner=await administrator(),student=await approvedStudent(),id=student.a.id;
 const block={operation_id:randomUUID(),name:'Blocked fixture',phone:student.a.phone,active:false};
 assert.equal((await signed(owner.b,'PATCH',`/api/admin/users/${id}`,'api',block)).statusCode,200);
 assert.equal((await request(student.b,'GET','/api/lessons')).statusCode,401);
 assert.equal((await db.query<{status:string}>('select status from private.device_bindings where id=$1',[student.deviceId])).rows[0].status,'approved');
 assert.equal((await signed(owner.b,'PATCH',`/api/admin/users/${id}`,'api',{...block,operation_id:randomUUID(),active:true})).statusCode,200);
 assert.equal((await login(student.b,student.a)).statusCode,200);assert.equal((await activate(student.b)).statusCode,200);
 const reset={operation_id:randomUUID(),identity_verified:true};const response=await signed(owner.b,'POST',`/api/admin/users/${id}/password-reset`,'api',reset);assert.equal(response.statusCode,200,response.body);assert.ok(response.json().temporary_password);
 assert.equal((await request(student.b,'GET','/api/lessons')).statusCode,401);
 assert.equal((await db.query<{status:string}>('select status from private.device_bindings where id=$1',[student.deviceId])).rows[0].status,'approved');
 assert.equal((await login(student.b,student.a,response.json().temporary_password)).statusCode,200);assert.equal((await request(student.b,'GET','/api/auth/status')).json().user.must_change_password,true);
 const replay=await signed(owner.b,'POST',`/api/admin/users/${id}/password-reset`,'api',reset);assert.equal(replay.json().temporary_password,undefined);
 assert.equal((await signed(owner.b,'PATCH',`/api/admin/users/${owner.a.id}`,'api',{operation_id:randomUUID(),name:'Owner',active:false})).statusCode,403);
 assert.equal((await signed(owner.b,'POST',`/api/admin/users/${owner.a.id}/password-reset`,'api',{operation_id:randomUUID(),identity_verified:true})).statusCode,403);
});

test('uncertain reset fails closed and reconciles by Auth marker without silently changing password again',async()=>{
 const owner=await administrator(),student=await approvedStudent(),body={operation_id:randomUUID(),identity_verified:true};authFailure='reset-after';
 const response=await signed(owner.b,'POST',`/api/admin/users/${student.a.id}/password-reset`,'api',body);assert.equal(response.statusCode,202,response.body);
 assert.equal((await request(student.b,'GET','/api/lessons')).statusCode,401);
 assert.equal((await login(student.b,student.a)).statusCode,401);
 const password=accounts.get(student.a.phone)!.password;
 const replay=await signed(owner.b,'POST',`/api/admin/users/${student.a.id}/password-reset`,'api',body);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().temporary_password,undefined);assert.equal(accounts.get(student.a.phone)!.password,password);
 assert.equal((await login(student.b,student.a,password)).statusCode,200);assert.equal((await db.query<{status:string}>('select status from private.device_bindings where id=$1',[student.deviceId])).rows[0].status,'approved');
});

test('reset unavailable before Auth commit supports deliberate delayed retry, with one-response password and preserved browser',async()=>{
 const owner=await administrator(),student=await approvedStudent(),body={operation_id:randomUUID(),identity_verified:true};const initialPassword=accounts.get(student.a.phone)!.password;authFailure='reset-before';
 const failed=await signed(owner.b,'POST',`/api/admin/users/${student.a.id}/password-reset`,'api',body);assert.equal(failed.statusCode,202,failed.body);assert.equal(failed.json().status,'reconcile_required');assert.equal(accounts.get(student.a.phone)!.password,initialPassword);
 const check=await signed(owner.b,'POST',`/api/admin/auth-operations/${body.operation_id}/reconcile`,'api',{});assert.equal(check.statusCode,202,check.body);assert.equal(check.json().status,'reconcile_required');assert.equal((await login(student.b,student.a,initialPassword)).statusCode,401);
 const retry={operation_id:randomUUID(),identity_verified:true},path=`/api/admin/auth-operations/${body.operation_id}/retry`;
 assert.equal((await signed(owner.b,'POST',path,'api',retry)).statusCode,409);
 await db.query("update private.auth_operations set created_at=now()-interval '61 seconds',updated_at=now()-interval '61 seconds',lease_until=NULL where id=$1",[body.operation_id]);
 const completed=await signed(owner.b,'POST',path,'api',retry);assert.equal(completed.statusCode,200,completed.body);assert.equal(completed.json().status,'completed');const password=completed.json().temporary_password;assert.ok(password&&password!==initialPassword);assert.equal(accounts.get(student.a.phone)!.password,password);
 const again=await signed(owner.b,'POST',path,'api',retry);assert.equal(again.statusCode,200,again.body);assert.equal(again.json().operation_id,retry.operation_id);assert.equal(again.json().temporary_password,undefined);assert.equal(accounts.get(student.a.phone)!.password,password);
 const older=(await db.query<{state:string;last_error_code:string}>('select state,last_error_code from private.auth_operations where id=$1',[body.operation_id])).rows[0];assert.equal(older.state,'failed');assert.equal(older.last_error_code,'OPERATION_SUPERSEDED');
 assert.equal((await db.query<{status:string}>('select status from private.device_bindings where id=$1',[student.deviceId])).rows[0].status,'approved');assert.equal((await login(student.b,student.a,password)).statusCode,200);
 const ledger=(await db.query('select row_to_json(o) as data from private.auth_operations o where id in ($1,$2)',[body.operation_id,retry.operation_id])).rows;assert.ok(!JSON.stringify(ledger).includes(password));
});

test('superseded reset marker cannot unblock or resurrect a newer pending reset',async()=>{
 const owner=await administrator(),student=await approvedStudent(),previous={operation_id:randomUUID(),identity_verified:true};authFailure='reset-before';
 assert.equal((await signed(owner.b,'POST',`/api/admin/users/${student.a.id}/password-reset`,'api',previous)).statusCode,202);
 await db.query("update private.auth_operations set created_at=now()-interval '61 seconds',updated_at=now()-interval '61 seconds',lease_until=NULL where id=$1",[previous.operation_id]);
 const retry={operation_id:randomUUID(),identity_verified:true};authFailure='reset-before';const newer=await signed(owner.b,'POST',`/api/admin/auth-operations/${previous.operation_id}/retry`,'api',retry);assert.equal(newer.statusCode,202,newer.body);
 const remote=accounts.get(student.a.phone)!;remote.app_metadata={...remote.app_metadata,uyym_password_operation:previous.operation_id};
 const stale=await signed(owner.b,'POST',`/api/admin/auth-operations/${previous.operation_id}/reconcile`,'api',{});assert.equal(stale.statusCode,202,stale.body);assert.equal(stale.json().status,'failed');
 const gate=(await db.query<{auth_operation_id:string}>('select auth_operation_id from private.app_users where id=$1',[student.a.id])).rows[0];assert.equal(gate.auth_operation_id,retry.operation_id);assert.equal((await login(student.b,student.a)).statusCode,401);
 const older=(await db.query<{state:string;last_error_code:string}>('select state,last_error_code from private.auth_operations where id=$1',[previous.operation_id])).rows[0];assert.equal(older.state,'failed');assert.equal(older.last_error_code,'OPERATION_SUPERSEDED');
 const pending=(await db.query<{state:string}>('select state from private.auth_operations where id=$1',[retry.operation_id])).rows[0];assert.equal(pending.state,'reconcile_required');
 const tooSoon={operation_id:randomUUID(),identity_verified:true};assert.equal((await signed(owner.b,'POST',`/api/admin/auth-operations/${retry.operation_id}/retry`,'api',tooSoon)).statusCode,409);
});

test('create unavailable before commit resumes fixed identity after 60 seconds; lease, replay and receipts never duplicate or archive passwords',async()=>{
 const owner=await administrator(),body={operation_id:randomUUID(),name:'Resumable student fixture',phone:`+7707${String(phoneCounter++).padStart(7,'0')}`,role:'STUDENT',identity_verified:true};authFailure='create-before';
 const initial=await signed(owner.b,'POST','/api/admin/users','api',body);assert.equal(initial.statusCode,202,initial.body);assert.equal(initial.json().status,'reconcile_required');assert.equal(accounts.has(body.phone),false);
 const old=(await db.query<{auth_user_id:string}>('select auth_user_id from private.auth_operations where id=$1',[body.operation_id])).rows[0];
 const path=`/api/admin/auth-operations/${body.operation_id}/resume-create`,resume={identity_verified:true};assert.equal((await signed(owner.b,'POST',path,'api',resume)).statusCode,409);
 assert.equal((await signed(owner.b,'POST',path,'api',{identity_verified:true,phone:body.phone})).statusCode,400);
 await db.query("update private.auth_operations set created_at=now()-interval '61 seconds',updated_at=now()-interval '61 seconds',lease_until=NULL where id=$1",[body.operation_id]);
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});createGate={entered,wait};
 const pending=signed(owner.b,'POST',path,'api',resume);await ready;
 const concurrent=await signed(owner.b,'POST',path,'api',resume);assert.equal(concurrent.statusCode,202,concurrent.body);assert.equal(concurrent.json().status,'inflight');assert.equal(concurrent.json().temporary_password,undefined);release();
 const completed=await pending;assert.equal(completed.statusCode,201,completed.body);assert.equal(completed.json().status,'completed');assert.equal(completed.json().user.id,old.auth_user_id);const password=completed.json().temporary_password;assert.ok(password&&password===accounts.get(body.phone)!.password);
 const again=await signed(owner.b,'POST',path,'api',resume);assert.equal(again.statusCode,200,again.body);assert.equal(again.json().temporary_password,undefined);assert.equal(createAttempts.get(body.phone),2);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from auth.users where phone=$1',[body.phone])).rows[0].n,1);assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.app_users where phone=$1',[body.phone])).rows[0].n,1);
 const operation=(await db.query<{attempts:number;data:unknown}>('select attempts,row_to_json(o) as data from private.auth_operations o where id=$1',[body.operation_id])).rows[0];assert.equal(operation.attempts,2);assert.ok(!JSON.stringify(operation.data).includes(password));
 const history=(await db.query('select metadata from private.audit_log where target_id in ($1,$2)',[body.operation_id,old.auth_user_id])).rows;assert.ok(!JSON.stringify(history).includes(password));
});

test('resume-create reconciles an existing own marker without POST and rejects an unrelated marker without overwrite or deletion',async()=>{
 const owner=await administrator(),own={operation_id:randomUUID(),name:'Existing marker fixture',phone:`+7707${String(phoneCounter++).padStart(7,'0')}`,role:'TEACHER',identity_verified:true};authFailure='create-after';assert.equal((await signed(owner.b,'POST','/api/admin/users','api',own)).statusCode,202);
 await db.query("update private.auth_operations set created_at=now()-interval '61 seconds',updated_at=now()-interval '61 seconds',lease_until=NULL where id=$1",[own.operation_id]);const reconciled=await signed(owner.b,'POST',`/api/admin/auth-operations/${own.operation_id}/resume-create`,'api',{identity_verified:true});assert.equal(reconciled.statusCode,200,reconciled.body);assert.equal(reconciled.json().status,'completed');assert.equal(reconciled.json().temporary_password,undefined);assert.equal(createAttempts.get(own.phone),1);
 const foreign={operation_id:randomUUID(),name:'Wrong marker fixture',phone:`+7707${String(phoneCounter++).padStart(7,'0')}`,role:'STUDENT',identity_verified:true};authFailure='create-before';assert.equal((await signed(owner.b,'POST','/api/admin/users','api',foreign)).statusCode,202);
 const op=(await db.query<{auth_user_id:string}>('select auth_user_id from private.auth_operations where id=$1',[foreign.operation_id])).rows[0],password='Unrelated-fixture-password';await db.query('insert into auth.users(id,phone) values($1,$2)',[op.auth_user_id,foreign.phone]);accounts.set(foreign.phone,{id:op.auth_user_id,password,app_metadata:{uyym_operation:randomUUID()}});
 await db.query("update private.auth_operations set created_at=now()-interval '61 seconds',updated_at=now()-interval '61 seconds',lease_until=NULL where id=$1",[foreign.operation_id]);const denied=await signed(owner.b,'POST',`/api/admin/auth-operations/${foreign.operation_id}/resume-create`,'api',{identity_verified:true});assert.equal(denied.statusCode,202,denied.body);assert.equal(denied.json().status,'failed');assert.equal(denied.json().temporary_password,undefined);assert.equal(createAttempts.get(foreign.phone),1);assert.equal(accounts.get(foreign.phone)!.password,password);
 assert.equal((await signed(owner.b,'POST',`/api/admin/auth-operations/${foreign.operation_id}/resume-create`,'api',{identity_verified:true})).statusCode,409);
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from private.app_users where id=$1',[op.auth_user_id])).rows[0].n,0);assert.equal((await db.query<{n:number}>('select count(*)::int as n from auth.users where id=$1',[op.auth_user_id])).rows[0].n,1);
});
