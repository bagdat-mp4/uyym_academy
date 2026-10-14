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
const teacherId=randomUUID(),teacherPhone='+77070000004',teacherPassword='UiFixture-Teacher-Password-2026';
const studentId=randomUUID(),studentPhone='+77070000002',studentPassword='UiFixture-Student-Password-2026';
const {encrypt,totp}=await import('../server/security.js');const secret='JBSWY3DPEHPK3PXP';
await query('INSERT INTO auth.users(id,phone) VALUES($1,$2),($3,$4)',[id,phone,studentId,studentPhone]);
await query("INSERT INTO private.app_users(id,phone,name,role,must_change_password,admin_totp_secret_encrypted) VALUES($1,$2,'LOCAL TEST OWNER','ADMIN',false,$3)",[id,phone,encrypt(secret,process.env.ADMIN_ENCRYPTION_KEY!)]);
await query("INSERT INTO private.app_users(id,phone,name,role,must_change_password) VALUES($1,$2,'LOCAL FIXTURE STUDENT','STUDENT',false)",[studentId,studentPhone]);
const courseId=String(((await query("SELECT id FROM private.courses WHERE slug='calculus-i'")).rows[0] as any).id),groupId=randomUUID();
const pp1Id=String(((await query("SELECT id FROM private.courses WHERE slug='pp1'")).rows[0] as any).id);
await query("INSERT INTO private.registration_applications(name,phone,course_id) VALUES('LOCAL FIXTURE · PP1 APPLICANT','+77070000003',$1)",[pp1Id]);
await query("INSERT INTO private.groups(id,course_id,title,active,capacity,starts_at,ends_at,schedule_description) VALUES($1,$2,'LOCAL UI FIXTURE · CALC A',true,5,now()-interval '1 day',now()+interval '30 days','Сейсенбі және бейсенбі · 18:00 · Asia/Almaty')",[groupId,courseId]);
await query("INSERT INTO private.enrollments(user_id,course_id,group_id,status,starts_at,expires_at,payment_status,created_by) VALUES($1,$2,$3,'active',now()-interval '1 day',now()+interval '30 days','paid',$4)",[studentId,courseId,groupId,id]);
await query("INSERT INTO private.lessons(course_id,group_id,title,description,scheduled_at,published,created_by) VALUES($1,$2,'LOCAL FIXTURE · Derivatives','Черновик без Drive-видео для проверки интерфейса.',now()+interval '1 day',false,$3)",[courseId,groupId,id]);
const assignmentId=String(((await query("INSERT INTO private.assignments(course_id,group_id,title,instructions,due_at,max_grade,published,created_by) VALUES($1,$2,'LOCAL FIXTURE · Homework 1','Решите задания 1–5 и покажите ход решения.',now()+interval '7 days',20,true,$3) RETURNING id",[courseId,groupId,id])).rows[0] as any).id);
const submissionId=String(((await query("INSERT INTO private.submissions(assignment_id,user_id,status,current_version,feedback,reviewed_by,reviewed_at) VALUES($1,$2,'needs_revision',1,'Проверьте второй пункт и отправьте новую версию.',$3,now()) RETURNING id",[assignmentId,studentId,id])).rows[0] as any).id);
await query("INSERT INTO private.submission_versions(submission_id,version,answer,is_late) VALUES($1,1,'1) lim x→0 sin(x)/x = 1. 2) Требуется исправление.',false)",[submissionId]);
await query("INSERT INTO private.archive_entries(course_id,group_id,category,exam_year,semester,topic,title,published,created_by) VALUES($1,$2,'Midterm',2025,'Fall','Limits','LOCAL FIXTURE · Midterm archive',true,$3)",[courseId,groupId,id]);
await query("INSERT INTO private.announcements(course_id,group_id,title,body,published,created_by) VALUES($1,$2,'LOCAL FIXTURE · Келесі сабақ','Келесі сабақта туындының қолданылуын талқылаймыз. Конспект пен калькуляторды дайындаңыз.',true,$3)",[courseId,groupId,id]);
await query('INSERT INTO auth.users(id,phone) VALUES($1,$2)',[teacherId,teacherPhone]);
await query("INSERT INTO private.app_users(id,phone,name,role,must_change_password) VALUES($1,$2,'LOCAL FIXTURE TEACHER','TEACHER',false)",[teacherId,teacherPhone]);
await query('INSERT INTO private.teacher_assignments(teacher_id,course_id,group_id,can_manage_access,created_by) VALUES($1,$2,$3,true,$4)',[teacherId,courseId,groupId,id]);
users.set(teacherId,{id:teacherId,phone:teacherPhone,password:teacherPassword,app_metadata:{}});
users.set(id,{id,phone,password,app_metadata:{}});
users.set(studentId,{id:studentId,phone:studentPhone,password:studentPassword,app_metadata:{}});
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
// UI-only fixtures represent previously approved student/teacher profiles.
// Production device approval is tested by the security suites, not this hook.
app.addHook('onResponse',async req=>{
 if(req.url!=='/api/auth/login'||req.method!=='POST')return;
 const phone=(req.body as any)?.phone;
 const fixtureId=phone===studentPhone?studentId:phone===teacherPhone?teacherId:null;
 if(fixtureId)await (pool as any).query("UPDATE private.device_bindings SET status='approved',approved_at=now(),approved_by=$2 WHERE user_id=$1 AND status='pending'",[fixtureId,id]);
});
await app.listen({host:'127.0.0.1',port:18878});
console.info('LOCAL TEST ONLY: embedded SQL + simulated Auth; Drive UNVERIFIED. UI http://localhost:5174/#account');
console.info('Fixture phone:',phone,'Fixture password:',password);
console.info('Fixture student:',studentPhone,'Fixture password:',studentPassword);
console.info('Current fixture TOTP:',totp(secret,Math.floor(Date.now()/30000)));
process.on('SIGINT',async()=>{await app.close();await db.close();process.exit(0);});
// Generate a fresh fixture TOTP in another terminal:
// node --import tsx -e "import('./server/security.ts').then(m=>console.log(m.totp('JBSWY3DPEHPK3PXP',Math.floor(Date.now()/30000))))"
