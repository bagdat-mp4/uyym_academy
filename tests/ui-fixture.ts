// LOCAL TEST PROVIDER ONLY. Actual SQL/BFF/UI, simulated remote Supabase Auth.
// Never import from server/main.ts or deploy this entrypoint. No Drive simulation.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
if(process.env.NODE_ENV==='production')throw new Error('Test provider cannot run in production');
const testOrigin=process.env.UYYM_UI_ORIGIN||'http://localhost:5174';if(!['http://localhost:5174','http://localhost:18878'].includes(testOrigin))throw new Error('Fixture origin must stay local');
Object.assign(process.env,{DOTENV_CONFIG_PATH:resolve('work/nonexistent-ui-fixture.env'),GOOGLE_APPLICATION_CREDENTIALS_BASE64:'',NODE_ENV:'test',PORT:'18878',APP_ORIGIN:testOrigin,COOKIE_SECURE:'false',DATABASE_URL:'postgresql://unused@127.0.0.1:1/postgres',SUPABASE_URL:'https://local-auth.invalid',SUPABASE_ANON_KEY:'TEST_ONLY',SUPABASE_SERVICE_ROLE_KEY:'TEST_ONLY',ADMIN_ENCRYPTION_KEY:'ab'.repeat(32)});
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
const {encrypt}=await import('../server/security.js');const secret='JBSWY3DPEHPK3PXP';
await query('INSERT INTO auth.users(id,phone) VALUES($1,$2),($3,$4)',[id,phone,studentId,studentPhone]);
await query("INSERT INTO private.app_users(id,phone,name,role,must_change_password,admin_totp_secret_encrypted) VALUES($1,$2,'LOCAL TEST OWNER','ADMIN',false,$3)",[id,phone,encrypt(secret,process.env.ADMIN_ENCRYPTION_KEY!)]);
await query("INSERT INTO private.app_users(id,phone,name,role,must_change_password) VALUES($1,$2,'LOCAL FIXTURE STUDENT','STUDENT',false)",[studentId,studentPhone]);
const courseId=String(((await query("SELECT id FROM private.courses WHERE slug='calculus-i'")).rows[0] as any).id),groupId=randomUUID();
const pp1Id=String(((await query("SELECT id FROM private.courses WHERE slug='pp1'")).rows[0] as any).id);
await query("INSERT INTO private.enrollments(user_id,course_id,status,starts_at,expires_at,created_by) VALUES($1,$2,'active',now()-interval '1 day',now()+interval '30 days',$3)",[studentId,pp1Id,id]);
await query("INSERT INTO private.lessons(course_id,title,description,published,created_by) VALUES($1,'LOCAL FIXTURE · PP1 course-wide lesson','Local content rendering only; no private Drive video.',true,$2)",[pp1Id,id]);
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
// Local UI-only recording metadata: no real media, token, or Drive URL.
const previewLesson=String(((await query("INSERT INTO private.lessons(course_id,title,description,published,video_duration_seconds,created_by) VALUES($1,'LOCAL UI FIXTURE · Variables and input','Only a player UI fixture. Real private Drive playback is not configured.',true,120,$2) RETURNING id",[pp1Id,id])).rows[0] as any).id);
await query("INSERT INTO private.lesson_video_parts(lesson_id,part_index,drive_file_id,drive_folder_id,size_bytes,start_seconds,duration_seconds) VALUES($1,-1,'LOCAL_ONLY_NO_MEDIA','LOCAL_ONLY_NO_FOLDER',16,0,0),($1,0,'LOCAL_ONLY_NO_MEDIA','LOCAL_ONLY_NO_FOLDER',16,0,4)",[previewLesson]);
await query("INSERT INTO private.lesson_progress(user_id,lesson_id,position_seconds,last_opened_at) VALUES($1,$2,30,now())",[studentId,previewLesson]);
await query("INSERT INTO private.lessons(course_id,group_id,title,description,scheduled_at,published,created_by) VALUES($1,$2,'LOCAL UI FIXTURE · Applications of derivatives','Local upcoming lesson, no recording yet.',now()+interval '2 days',true,$3)",[courseId,groupId,id]);
await query("INSERT INTO private.teacher_assignments(teacher_id,course_id,group_id,created_by) VALUES($1,$2,NULL,$3)",[teacherId,pp1Id,id]);
await query("INSERT INTO private.registration_applications(name,phone,course_id,status) VALUES('LOCAL UI FIXTURE · Ә Ғ Қ Ң Ө Ұ Ү Һ І · Very long applicant name for wrapping on small screens','+77070000005',$1,'rejected')",[courseId]);

const completedLesson=String(((await query("INSERT INTO private.lessons(course_id,title,description,published,video_duration_seconds,created_by) VALUES($1,'LOCAL UI FIXTURE · Completed lesson','UI-only completed recording. No real Drive media.',true,120,$2) RETURNING id",[pp1Id,id])).rows[0] as any).id);
await query("INSERT INTO private.lesson_video_parts(lesson_id,part_index,drive_file_id,drive_folder_id,size_bytes,start_seconds,duration_seconds) VALUES($1,-1,'LOCAL_ONLY_NO_MEDIA','LOCAL_ONLY_NO_FOLDER',16,0,0),($1,0,'LOCAL_ONLY_NO_MEDIA','LOCAL_ONLY_NO_FOLDER',16,0,4)",[completedLesson]);
await query("INSERT INTO private.lesson_progress(user_id,lesson_id,position_seconds,last_opened_at,completed_at) VALUES($1,$2,120,now(),now())",[studentId,completedLesson]);

// Synthetic existing students who have not signed in; no real roster data.
for(let candidate=1;candidate<=3;candidate++){
 const candidateId=randomUUID(),candidatePhone='+770700000'+String(20+candidate);
 await query('INSERT INTO auth.users(id,phone) VALUES($1,$2)',[candidateId,candidatePhone]);
 await query("INSERT INTO private.app_users(id,phone,name,role,active,must_change_password) VALUES($1,$2,$3,'STUDENT',true,true)",[candidateId,candidatePhone,'LOCAL COHORT CANDIDATE '+candidate]);
}

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
// Exercise an actual failed dynamic import and subsequent browser reload using
// the production build. This flag exists only in this loopback test entrypoint.
const failedChunk=process.env.UYYM_UI_FAIL_CHUNK==='chrome'?'WorkspaceChrome':'AdminPanel';
let failNextAdminChunk=['1','chrome'].includes(process.env.UYYM_UI_FAIL_CHUNK??'');
let courseReads=0;const failCourseRead=Number(process.env.UYYM_UI_FAIL_COURSES_READ??0);
app.addHook('onRequest',async(req,reply)=>{
 if(req.method==='GET'&&req.url==='/api/courses'&&++courseReads===failCourseRead)return reply.code(503).send({error:'Local UI test: retry the course list.',code:'LOCAL_UI_FAILURE'});
 if(failNextAdminChunk&&new RegExp(`^/assets/${failedChunk}-[\\w-]+\\.js$`).test(req.url)){failNextAdminChunk=false;return reply.code(404).send('Local fixture: failed chunk');}
});
const samples:{route:string;status:number;ms:number}[]=[];
const tracked=new Set(['/api/public','/api/auth/status','/api/courses','/api/courses/:id/content']);
app.addHook('onResponse',async(req,reply)=>{const route=req.routeOptions.url;if(route&&tracked.has(route)){samples.push({route,status:reply.statusCode,ms:Math.round(reply.elapsedTime)});if(samples.length>100)samples.shift();}});
app.get('/__ui/metrics',async()=>({local_fixture:true,samples}));
// UI-only fixtures represent previously approved student/teacher profiles.
// Production device approval is tested by the security suites, not this hook.
app.addHook('onResponse',async req=>{
 if(req.url!=='/api/auth/login'||req.method!=='POST')return;
 const phone=(req.body as any)?.phone;
 const fixtureId=phone===studentPhone?studentId:phone===teacherPhone?teacherId:phone===users.get(id)?.phone?id:null;
 if(fixtureId)await (pool as any).query("UPDATE private.device_bindings SET status='approved',approved_at=now(),approved_by=$2 WHERE user_id=$1 AND status='pending'",[fixtureId,id]);
});
// Optional before/after evidence from an independently built, trusted Git ref.
// Enumerated JS/CSS only; this local test entrypoint is never deployed.
if(process.env.UYYM_UI_BASELINE==='1'){
 const baseline=resolve('work/redesign/baseline-build');
 app.get('/__ui/before/',async(_req,reply)=>reply.type('text/html').send(await readFile(resolve(baseline,'index.html'))));
 for(const file of await readdir(resolve(baseline,'assets')))if(/^[A-Za-z0-9_-]+\.(js|css)$/.test(file))app.get(`/__ui/before/assets/${file}`,async(_req,reply)=>reply.type(file.endsWith('.js')?'text/javascript':'text/css').send(await readFile(resolve(baseline,'assets',file))));
}
await app.listen({host:'127.0.0.1',port:18878});
console.info(`LOCAL TEST ONLY: embedded SQL + simulated Auth; Drive UNVERIFIED. UI ${testOrigin}/#account`);
process.on('SIGINT',async()=>{await app.close();await db.close();process.exit(0);});
