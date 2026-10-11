// LOCAL TEST PROVIDER ONLY. Actual SQL/BFF/UI, simulated remote Supabase Auth.
// Never import from server/main.ts or deploy this entrypoint. No Drive simulation.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
if(process.env.NODE_ENV==='production')throw new Error('Test provider cannot run in production');
Object.assign(process.env,{NODE_ENV:'test',PORT:'18878',APP_ORIGIN:'http://localhost:5174',COOKIE_SECURE:'false',DATABASE_URL:'postgresql://unused@127.0.0.1:1/postgres',SUPABASE_URL:'https://local-auth.invalid',SUPABASE_ANON_KEY:'TEST_ONLY',SUPABASE_SERVICE_ROLE_KEY:'TEST_ONLY',ADMIN_ENCRYPTION_KEY:'ab'.repeat(32)});
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,phone text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;`);
const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of(await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
const {pool}=await import('../server/db.js');
const query=async(sql:string,params:unknown[]=[])=>{const r=await db.query(sql,params);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};};
let queue=Promise.resolve();
async function lease(){let release!:()=>void;const previous=queue;queue=new Promise<void>(r=>release=r);await previous;return release;}
(pool as any).query=async(sql:string,params:unknown[]=[])=>{const release=await lease();try{return await query(sql,params);}finally{release();}};
(pool as any).connect=async()=>{const release=await lease();return {query,release};};
const users=new Map<string,any>();const id=randomUUID(),phone='+77070000001',password='UiFixture-Only-Password-2026';
const {encrypt,totp}=await import('../server/security.js');const secret='JBSWY3DPEHPK3PXP';
await query('INSERT INTO auth.users(id,phone) VALUES($1,$2)',[id,phone]);
await query("INSERT INTO private.app_users(id,phone,name,role,must_change_password,admin_totp_secret_encrypted) VALUES($1,$2,'LOCAL TEST OWNER','ADMIN',false,$3)",[id,phone,encrypt(secret,process.env.ADMIN_ENCRYPTION_KEY!)]);
users.set(id,{id,phone,password,app_metadata:{}});
globalThis.fetch=async(input:any,init?:RequestInit)=>{
 const url=String(input),body=init?.body?JSON.parse(String(init.body)):{};
 if(url==='https://local-auth.invalid/auth/v1/token?grant_type=password'){
  const user=[...users.values()].find(u=>u.phone===body.phone&&u.password===body.password);return user?Response.json({user:{id:user.id}}):new Response('{}',{status:400});
 }
 if(url==='https://local-auth.invalid/auth/v1/admin/users'&&init?.method==='POST'){
  if([...users.values()].some(u=>u.phone===body.phone))return new Response('{}',{status:422});
  const user={id:body.id,phone:body.phone,password:body.password,app_metadata:body.app_metadata};
  await (pool as any).query('INSERT INTO auth.users(id,phone) VALUES($1,$2)',[user.id,user.phone]);users.set(user.id,user);return Response.json({id:user.id,phone:user.phone,app_metadata:user.app_metadata});
 }
 const match=/^https:\/\/local-auth.invalid\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/.exec(url);
 if(match){const user=users.get(match[1]);if(!user)return new Response('{}',{status:404});if(init?.method==='PUT'){if(body.password)user.password=body.password;user.app_metadata={...user.app_metadata,...body.app_metadata};}return Response.json({id:user.id,phone:user.phone,app_metadata:user.app_metadata});}
 throw new Error('Test provider forbids other external HTTP');
};
const {app}=await import('../server/index.js');
await app.listen({host:'127.0.0.1',port:18878});
console.info('LOCAL TEST ONLY: embedded SQL + simulated Auth; Drive UNVERIFIED. UI http://localhost:5174/#account');
console.info('Fixture phone:',phone,'Fixture password:',password);
console.info('Current fixture TOTP:',totp(secret,Math.floor(Date.now()/30000)));
process.on('SIGINT',async()=>{await app.close();await db.close();process.exit(0);});
// Generate a fresh fixture TOTP in another terminal:
// node --import tsx -e "import('./server/security.ts').then(m=>console.log(m.totp('JBSWY3DPEHPK3PXP',Math.floor(Date.now()/30000))))"
