import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {FastifyInstance,HTTPMethods} from 'fastify';

// Real routes, proofs, migrations and SQL. Fixture sessions avoid remote Auth;
// this suite does not claim production concurrency or live provider coverage.
let db:PGlite,app:FastifyInstance,endPool:(()=>Promise<void>)|undefined;
const origin='https://management-test.example';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
type Actor={id:string;key:CryptoKeyPair;cookie:string;csrf:string;device:string;session:string};
let owner:Actor;
let n=1;
before(async()=>{
 Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:origin,COOKIE_SECURE:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/postgres',SUPABASE_URL:'https://auth-management-test.example',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service',ADMIN_ENCRYPTION_KEY:'ab'.repeat(32)});
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,phone text);create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of(await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const {pool}=await import('../server/db.js');endPool=pool.end.bind(pool);
 const query=async(sql:string,params:unknown[]=[])=>{const r=await db.query(sql,params);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0,fields:[],command:'',oid:0};};
 (pool as any).query=query;(pool as any).connect=async()=>({query,release(){}});
 ({app}=await import('../server/index.js'));await app.ready();owner=await actor('ADMIN');
});
after(async()=>{await app?.close();await endPool?.();await db?.close();});
async function user(role='STUDENT'){
 const id=randomUUID(),phone=`+7708${String(n++).padStart(7,'0')}`;
 await db.query('INSERT INTO auth.users(id,phone) VALUES($1,$2)',[id,phone]);await db.query('INSERT INTO private.app_users(id,phone,name,role,must_change_password) VALUES($1,$2,$3,$4,false)',[id,phone,`Fixture ${role} ${n}`,role]);return id;
}
async function actor(role='TEACHER'):Promise<Actor>{
 const id=await user(role),key=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']) as CryptoKeyPair;
 if(role==='ADMIN'){const {encrypt}=await import('../server/security.js');await db.query('UPDATE private.app_users SET admin_totp_secret_encrypted=$2 WHERE id=$1',[id,encrypt('JBSWY3DPEHPK3PXP',process.env.ADMIN_ENCRYPTION_KEY!)]);}
 const jwk=await webcrypto.subtle.exportKey('jwk',key.publicKey),device=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();
 await db.query("INSERT INTO private.device_bindings(id,user_id,public_key,label,status,approved_at,approved_by) VALUES($1,$2,$3,'Fixture approved browser','approved',now(),$4)",[device,id,JSON.stringify(jwk),owner?.id??id]);
 const session=(await db.query<{id:string}>('SELECT private.open_application_session($1,$2,1,$3,$4,$5,1800) AS id',[id,device,sha(token),csrf,role==='ADMIN'])).rows[0].id;
 return {id,key,device,session,csrf,cookie:`__Host-uyym_session=${token}`};
}
async function raw(a:Actor,method:HTTPMethods,path:string,body?:unknown,extra:Record<string,string>={}){
 const headers={cookie:a.cookie,...(method!=='GET'?{origin,'content-type':'application/json','x-csrf-token':a.csrf}:{}),...extra};return app.inject({method,url:path,headers,...(body!==undefined?{payload:body as any}:{})});
}
async function signed(a:Actor,method:HTTPMethods,path:string,body?:unknown,purpose='api'){
 const challenge=await raw(a,'POST','/api/proof/challenge',{method,path,purpose,body_hash:sha(body===undefined?'':JSON.stringify(body))});assert.equal(challenge.statusCode,200,challenge.body);
 const c=challenge.json(),signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},a.key.privateKey,new TextEncoder().encode(c.payload));return raw(a,method,path,body,{'x-proof-id':c.id,'x-device-proof':Buffer.from(signature).toString('base64url')});
}
async function create(path:string,body:Record<string,unknown>){const r=await signed(owner,'POST',path,{operation_id:randomUUID(),...body});assert.equal(r.statusCode,200,r.body);return r.json();}
async function course(){return create('/api/admin/courses',{slug:`course-${randomUUID()}`,title:'Management fixture',published:true});}
async function group(course_id:string,capacity=5){return create('/api/admin/groups',{course_id,title:'Group fixture',capacity});}
async function enrollment(student:string,course_id:string,group_id:string|null,status='active'){
 return create('/api/admin/enrollments',{user_id:student,course_id,group_id,status,starts_at:new Date(Date.now()-3600000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()});
}

test('management lists require both role and device proof, use bounded pagination and hide cryptographic material',async()=>{
 const student=await actor('STUDENT'),teacher=await actor();
 assert.equal((await signed(student,'GET','/api/admin/courses')).statusCode,403);
 assert.equal((await signed(teacher,'GET','/api/admin/options?entity=users')).statusCode,403);
 assert.equal((await raw(owner,'GET','/api/admin/devices')).statusCode,403);
 const devices=await signed(owner,'GET','/api/admin/devices?page_size=2');assert.equal(devices.statusCode,200,devices.body);assert.equal(devices.json().page_size,2);assert.ok(devices.json().items.length<=2);assert.ok(!devices.body.includes('public_key')&&!devices.body.includes('token_hash')&&!devices.body.includes('csrf_token'));
 assert.equal((await signed(owner,'GET','/api/admin/courses?page_size=101')).statusCode,400);
});

test('English API errors stay generic and authenticated routes remain protected',async()=>{
 const response=await app.inject({method:'GET',url:'/api/admin/courses',headers:{'accept-language':'en'}});
 assert.equal(response.statusCode,401);
 assert.equal(response.json().error,'Sign-in or session verification failed. Check your details or contact the administrator.');
 assert.ok(!response.body.includes('postgres')&&!response.body.includes('SUPABASE'));
});

test('public API hides the legacy affiliation FAQ from stored settings without changing stored data',async()=>{
 const previous=(await db.query<{faq:unknown}>('SELECT faq FROM private.site_settings WHERE id=true')).rows[0].faq;
 const faq=[{question:'UYYM Academy — официальный проект КБТУ?',answer:'Официальное партнёрство с КБТУ не заявлено.'},{question:'Owner question',answer:'Owner answer stays verbatim'}];
 await db.query('UPDATE private.site_settings SET faq=$1::jsonb WHERE id=true',[JSON.stringify(faq)]);
 try {
  const response=await app.inject({method:'GET',url:'/api/public'});
  assert.equal(response.statusCode,200);assert.deepEqual(response.json().settings.faq,[faq[1]]);
  assert.deepEqual((await db.query<{faq:unknown}>('SELECT faq FROM private.site_settings WHERE id=true')).rows[0].faq,faq);
 }finally{await db.query('UPDATE private.site_settings SET faq=$1::jsonb WHERE id=true',[JSON.stringify(previous)]);}
});

test('course create is idempotent, altered operation payload conflicts, PATCH omitted defaults stay unchanged',async()=>{
 const operation_id=randomUUID(),body={operation_id,slug:`idempotent-${randomUUID()}`,title:'Idempotent fixture',active:false,published:false,price_kzt:73500,weeks:8};
 const first=await signed(owner,'POST','/api/admin/courses',body);assert.equal(first.statusCode,200,first.body);const row=first.json();
 const again=await signed(owner,'POST','/api/admin/courses',body);assert.equal(again.statusCode,200,again.body);assert.equal(again.json().replayed,true);assert.equal(again.json().id,row.id);
 assert.equal((await signed(owner,'POST','/api/admin/courses',{...body,title:'Different'})).statusCode,409);
 const change=await signed(owner,'PATCH',`/api/admin/courses/${row.id}`,{operation_id:randomUUID(),revision:Number(row.revision),title:'Renamed only'});assert.equal(change.statusCode,200,change.body);const updated=change.json();assert.equal(updated.active,false);assert.equal(updated.published,false);assert.equal(updated.price_kzt,73500);assert.equal(updated.weeks,8);
 assert.equal((await signed(owner,'PATCH',`/api/admin/courses/${row.id}`,{operation_id:randomUUID(),revision:Number(row.revision),title:'Stale'})).statusCode,409);
});

test('reserved capacity includes paused and future students, revocation releases a seat, invalid course-group transfer fails',async()=>{
 const c=await course(),g=await group(c.id,1),student1=await user(),student2=await user();const e=await enrollment(student1,c.id,g.id,'paused');
 const full=await signed(owner,'POST','/api/admin/enrollments',{operation_id:randomUUID(),user_id:student2,course_id:c.id,group_id:g.id,status:'pending',starts_at:new Date(Date.now()+3600000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()});assert.equal(full.statusCode,409,full.body);
 const revoke=await signed(owner,'PATCH',`/api/admin/enrollments/${e.id}`,{operation_id:randomUUID(),revision:Number(e.revision),status:'revoked',revocation_reason:'Seat released'});assert.equal(revoke.statusCode,200,revoke.body);assert.equal(revoke.json().status,'revoked');assert.equal(revoke.json().group_id,g.id);
 await enrollment(student2,c.id,g.id,'pending');
 const other=await course(),foreign=await group(other.id);const update=await signed(owner,'PATCH',`/api/admin/enrollments/${e.id}`,{operation_id:randomUUID(),revision:Number(revoke.json().revision),group_id:foreign.id});assert.equal(update.statusCode,400,update.body);
});

test('teacher roster is confined to assigned groups, course-only assignment grants no roster or access edits',async()=>{
 const teacher=await actor(),c=await course(),own=await group(c.id),foreign=await group(c.id),s1=await user(),s2=await user();const e1=await enrollment(s1,c.id,own.id),e2=await enrollment(s2,c.id,foreign.id);
 await create('/api/admin/teacher-assignments',{teacher_id:teacher.id,course_id:c.id,group_id:own.id,can_manage_access:false});
 await create('/api/admin/teacher-assignments',{teacher_id:teacher.id,course_id:c.id,group_id:null,can_manage_access:false});
 const roster=await signed(teacher,'GET',`/api/teacher/groups/${own.id}/students`);assert.equal(roster.statusCode,200,roster.body);assert.ok(roster.json().items.some((x:any)=>x.id===e1.id));assert.ok(!roster.body.includes(s2));
 assert.ok(roster.json().items.every((x:any)=>!Object.hasOwn(x,'payment_status')&&!Object.hasOwn(x,'revocation_reason')),'teacher roster must exclude private administrative and financial fields');
 assert.equal((await signed(teacher,'GET',`/api/teacher/groups/${foreign.id}/students`)).statusCode,404);
 assert.equal((await signed(teacher,'PATCH',`/api/teacher/enrollments/${e1.id}`,{operation_id:randomUUID(),revision:Number(e1.revision),status:'paused'})).statusCode,403);
 assert.equal((await signed(teacher,'PATCH',`/api/teacher/enrollments/${e1.id}`,{operation_id:randomUUID(),revision:Number(e1.revision),group_id:foreign.id,status:'paused'})).statusCode,400);
 assert.equal((await signed(teacher,'PATCH',`/api/teacher/enrollments/${e2.id}`,{operation_id:randomUUID(),revision:Number(e2.revision),status:'paused'})).statusCode,403);
 const list=(await signed(teacher,'GET','/api/teacher/groups')).json().items;assert.ok(list.some((x:any)=>x.group_id===null&&x.has_roster===false));
});

test('teacher permission is rechecked after proof issuance; access edits retain other courses, sessions, key and history',async()=>{
 const teacher=await actor(),student=await actor('STUDENT'),c1=await course(),c2=await course(),g=await group(c1.id);const e=await enrollment(student.id,c1.id,g.id);await enrollment(student.id,c2.id,null);
 const assignment=await create('/api/admin/teacher-assignments',{teacher_id:teacher.id,course_id:c1.id,group_id:g.id,can_manage_access:true});
 const lesson1=randomUUID(),lesson2=randomUUID();await db.query("INSERT INTO private.lessons(id,course_id,title,published) VALUES($1,$2,'Course one fixture',true),($3,$4,'Course two fixture',true)",[lesson1,c1.id,lesson2,c2.id]);
 for(const lesson of [lesson1,lesson2])await db.query("INSERT INTO private.playback_grants(user_id,session_id,device_id,lesson_id,auth_epoch,expires_at) VALUES($1,$2,$3,$4,1,now()+interval '5 minutes')",[student.id,student.session,student.device,lesson]);
 const body={operation_id:randomUUID(),revision:Number(e.revision),status:'paused'};
 const challenge=await raw(teacher,'POST','/api/proof/challenge',{method:'PATCH',path:`/api/teacher/enrollments/${e.id}`,purpose:'api',body_hash:sha(JSON.stringify(body))});assert.equal(challenge.statusCode,200);const ch=challenge.json(),sig=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},teacher.key.privateKey,new TextEncoder().encode(ch.payload));
 const revokedPermission=await signed(owner,'PATCH',`/api/admin/teacher-assignments/${assignment.id}`,{operation_id:randomUUID(),revision:Number(assignment.revision),can_manage_access:false});assert.equal(revokedPermission.statusCode,200,revokedPermission.body);
 const denied=await raw(teacher,'PATCH',`/api/teacher/enrollments/${e.id}`,body,{'x-proof-id':ch.id,'x-device-proof':Buffer.from(sig).toString('base64url')});assert.equal(denied.statusCode,403,denied.body);
 const permission=await signed(owner,'PATCH',`/api/admin/teacher-assignments/${assignment.id}`,{operation_id:randomUUID(),revision:Number(revokedPermission.json().revision),can_manage_access:true});assert.equal(permission.statusCode,200,permission.body);
 const updated=await signed(teacher,'PATCH',`/api/teacher/enrollments/${e.id}`,body);assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().status,'paused');
 assert.ok(!Object.hasOwn(updated.json(),'payment_status')&&!Object.hasOwn(updated.json(),'revocation_reason'),'teacher mutation response must use the same restricted roster DTO');
 const removeAgain=await signed(owner,'PATCH',`/api/admin/teacher-assignments/${assignment.id}`,{operation_id:randomUUID(),revision:Number(permission.json().revision),can_manage_access:false});assert.equal(removeAgain.statusCode,200,removeAgain.body);
 const replayDenied=await signed(teacher,'PATCH',`/api/teacher/enrollments/${e.id}`,body);assert.equal(replayDenied.statusCode,403,replayDenied.body);
 const grants=(await db.query<{lesson_id:string;revoked_at:unknown}>('SELECT lesson_id,revoked_at FROM private.playback_grants WHERE user_id=$1',[student.id])).rows;assert.ok(grants.find(x=>x.lesson_id===lesson1)?.revoked_at);assert.equal(grants.find(x=>x.lesson_id===lesson2)?.revoked_at,null);
 assert.equal((await db.query<{revoked_at:unknown}>('SELECT revoked_at FROM private.app_sessions WHERE id=$1',[student.session])).rows[0].revoked_at,null);assert.equal((await db.query<{status:string}>('SELECT status FROM private.device_bindings WHERE id=$1',[student.device])).rows[0].status,'approved');
});

test('manual payments and corrections are immutable, audited, idempotent and never activate enrollment',async()=>{
 const c=await course(),student=await user(),e=await enrollment(student,c.id,null,'pending');const payment=await create('/api/admin/payments',{enrollment_id:e.id,amount_kzt:60000,paid_at:new Date().toISOString(),method:'bank_transfer',note:'Fixture manual verification'});assert.equal(Number(payment.revision),0);
 assert.equal(payment.recorded_by_name,(await db.query<{name:string}>('SELECT name FROM private.app_users WHERE id=$1',[owner.id])).rows[0].name);
 assert.equal((await db.query<{status:string}>('SELECT status FROM private.enrollments WHERE id=$1',[e.id])).rows[0].status,'pending');
 const body={operation_id:randomUUID(),revision:0,state:'voided',reason:'Fixture duplicate receipt'};const corrected=await signed(owner,'PATCH',`/api/admin/payments/${payment.id}`,body);assert.equal(corrected.statusCode,200,corrected.body);assert.equal(corrected.json().state,'voided');assert.equal(Number(corrected.json().revision),1);
 const replay=await signed(owner,'PATCH',`/api/admin/payments/${payment.id}`,body);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().replayed,true);
 assert.equal((await signed(owner,'PATCH',`/api/admin/payments/${payment.id}`,{...body,operation_id:randomUUID()})).statusCode,409);
 const histories=await db.query<{count:number}>('SELECT count(*)::integer AS count FROM private.payment_corrections WHERE payment_id=$1',[payment.id]);assert.equal(histories.rows[0].count,1);
 const fullHistory=await signed(owner,'GET',`/api/admin/payments/${payment.id}/history?page_size=1`);assert.equal(fullHistory.statusCode,200,fullHistory.body);assert.equal(fullHistory.json().total,2);assert.equal(fullHistory.json().items.length,1);assert.equal(fullHistory.json().items[0].revision,1);assert.equal(fullHistory.json().items[0].reason,body.reason);assert.equal(fullHistory.json().items[0].state,'voided');assert.equal(fullHistory.json().items[0].recorded_by_name,payment.recorded_by_name);
 const original=await signed(owner,'GET',`/api/admin/payments/${payment.id}/history?page_size=1&page=2`);assert.equal(original.statusCode,200,original.body);assert.equal(original.json().items[0].revision,0);assert.equal(original.json().items[0].amount_kzt,60000);assert.equal(original.json().items[0].note,'Fixture manual verification');assert.equal(original.json().items[0].method,'bank_transfer');assert.equal(original.json().items[0].state,'posted');
 assert.equal((await raw(owner,'GET',`/api/admin/payments/${payment.id}/history`)).statusCode,403);
 assert.equal((await signed(await actor(),'GET',`/api/admin/payments/${payment.id}/history`)).statusCode,403);
 assert.equal((await signed(await actor('STUDENT'),'GET',`/api/admin/payments/${payment.id}/history`)).statusCode,403);
 assert.equal((await signed(owner,'GET',`/api/admin/payments/${randomUUID()}/history`)).statusCode,404);
 await assert.rejects(db.query('UPDATE private.payments SET amount_kzt=1 WHERE id=$1',[payment.id]),/append-only/);
 const audit=(await signed(owner,'GET',`/api/admin/audit?user_id=${student}`)).json().items;assert.ok(audit.some((x:any)=>x.action==='payment.corrected'&&x.metadata.after.state==='voided'));
});

test('settings validates real contact destinations and options exposes labels without account secrets',async()=>{
 const current=(await signed(owner,'GET','/api/admin/settings')).json().settings;
 const body={operation_id:randomUUID(),revision:Number(current.revision),title:'UYYM Academy',contacts:{whatsapp:'',instagram:'',contact_email:''},teachers_public:[],faq:[{question:'Fixture question?',answer:'Owner-written fixture answer'}]};const updated=await signed(owner,'PATCH','/api/admin/settings',body);assert.equal(updated.statusCode,200,updated.body);
 const invalid=await signed(owner,'PATCH','/api/admin/settings',{...body,operation_id:randomUUID(),revision:Number(updated.json().revision),contacts:{whatsapp:'',instagram:'javascript:alert(1)',contact_email:''}});assert.equal(invalid.statusCode,400);
 const options=await signed(owner,'GET','/api/admin/options?entity=users&role=STUDENT');assert.equal(options.statusCode,200,options.body);assert.ok(options.json().items.every((x:any)=>x.role==='STUDENT'&&x.label));assert.ok(!options.body.includes('recovery_hashes')&&!options.body.includes('admin_totp')&&!options.body.includes('auth_epoch'));
});

test('audit resolves named objects and preserves safe changes without exposing joined account secrets',async()=>{
 const c=await create('/api/admin/courses',{slug:`audit-${randomUUID()}`,title:'Audit named course'}),g=await create('/api/admin/groups',{course_id:c.id,title:'Audit named group',capacity:5});
 const updated=await signed(owner,'PATCH',`/api/admin/groups/${g.id}`,{operation_id:randomUUID(),revision:Number(g.revision),title:'Audit renamed group',capacity:4});assert.equal(updated.statusCode,200,updated.body);
 const result=await signed(owner,'GET','/api/admin/audit?q=Audit');assert.equal(result.statusCode,200,result.body);
 const items=result.json().items,courseEvent=items.find((x:any)=>x.action==='course.created'&&x.target_id===c.id),groupEvent=items.find((x:any)=>x.action==='group.changed'&&x.target_id===g.id);
 assert.equal(courseEvent.object_label,'Audit named course');assert.equal(groupEvent.object_label,'Audit renamed group · Audit named course');assert.equal(typeof groupEvent.actor_name,'string');assert.equal(groupEvent.metadata.before.capacity,5);assert.equal(groupEvent.metadata.after.capacity,4);
 for(const secret of ['admin_totp_secret','recovery_hashes','token_hash','csrf_token','public_key','temporary_password'])assert.ok(!result.body.includes(secret));
 await db.query("INSERT INTO private.audit_log(actor_id,action,target_type,target_id,metadata) VALUES($1,'legacy.fixture','course','historical non-UUID target','{}')",[owner.id]);
 const historical=await signed(owner,'GET','/api/admin/audit?q=legacy.fixture');assert.equal(historical.statusCode,200,historical.body);assert.equal(historical.json().items[0].object_label,null);
});

test('learning content is scoped by course/group; private files close immediately after access revocation',async()=>{
 const c=await course(),own=await group(c.id),foreign=await group(c.id),student=await actor('STUDENT'),outsider=await actor('STUDENT'),teacher=await actor();
 const access=await enrollment(student.id,c.id,own.id);await create('/api/admin/teacher-assignments',{teacher_id:teacher.id,course_id:c.id,group_id:own.id});
 const originalFetch=globalThis.fetch,stored=new Map<string,Uint8Array>();
 globalThis.fetch=async(input:any,init?:RequestInit)=>{
  const url=String(input);if(!url.includes('/storage/v1/object/uyym-private/'))throw new Error(`Unexpected external request: ${url}`);
  const path=decodeURIComponent(url.split('/storage/v1/object/uyym-private/')[1]);
  if(init?.method==='POST'){stored.set(path,new Uint8Array(init.body as ArrayBuffer));return Response.json({Key:path});}
  if(init?.method==='DELETE'){stored.delete(path);return Response.json({});}
  const bytes=stored.get(path);return bytes?new Response(bytes as unknown as BodyInit,{status:200,headers:{'content-type':'application/pdf'}}):new Response('{}',{status:404});
 };
 try{
  const attachment=Buffer.from('%PDF-1.4 fixture').toString('base64');
  const fakeImage=Buffer.from('not really a png').toString('base64');
  const rejectedType=await signed(owner,'POST','/api/content/archive',{operation_id:randomUUID(),course_id:c.id,group_id:own.id,title:'Invalid image',published:false,category:'Quiz',exam_year:2025,semester:'',topic:'',files:[{name:'fake.png',mime:'image/png',base64:fakeImage}]});assert.equal(rejectedType.statusCode,400,rejectedType.body);
  const homework=await signed(owner,'POST','/api/content/assignments',{operation_id:randomUUID(),course_id:c.id,group_id:own.id,title:'Scoped homework',published:true,lesson_id:null,instructions:'Read the attached private PDF',due_at:null,files:[{name:'task.pdf',mime:'application/pdf',base64:attachment}]});assert.equal(homework.statusCode,200,homework.body);
  const archive=await signed(owner,'POST','/api/content/archive',{operation_id:randomUUID(),course_id:c.id,group_id:own.id,title:'Past Midterm',published:true,category:'Midterm',exam_year:2025,semester:'Fall',topic:'Vectors',files:[{name:'midterm.pdf',mime:'application/pdf',base64:attachment}]});assert.equal(archive.statusCode,200,archive.body);
  const teacherOwn=await signed(teacher,'POST','/api/content/assignments',{operation_id:randomUUID(),course_id:c.id,group_id:own.id,title:'Teacher homework',published:false,lesson_id:null,instructions:'Teacher scope',due_at:null,files:[]});assert.equal(teacherOwn.statusCode,200,teacherOwn.body);
  assert.equal((await signed(teacher,'POST','/api/content/assignments',{operation_id:randomUUID(),course_id:c.id,group_id:foreign.id,title:'Foreign homework',published:false,lesson_id:null,instructions:'Must fail',due_at:null,files:[]})).statusCode,403);
  const available=await signed(student,'GET','/api/courses');assert.equal(available.statusCode,200,available.body);assert.ok(available.json().courses.some((x:any)=>x.id===c.id));
  const view=await signed(student,'GET',`/api/courses/${c.id}/content`);assert.equal(view.statusCode,200,view.body);assert.equal(view.json().assignments.length,1);assert.equal(view.json().archive.length,1);assert.ok(!view.body.includes('storage_path'));
  await assert.rejects(db.query("INSERT INTO private.learning_files(course_id,group_id,assignment_id,storage_path,original_name,mime,file_size,sha256,created_by) VALUES($1,$2,$3,$4,'scope.pdf','application/pdf',1,$5,$6)",[c.id,foreign.id,homework.json().id,`learning/${homework.json().id}/${randomUUID()}`,'a'.repeat(64),owner.id]),/LEARNING_FILE_SCOPE_MISMATCH/);
  const fileId=view.json().assignments[0].files[0].id;const download=await signed(student,'GET',`/api/files/${fileId}`,undefined,'file');assert.equal(download.statusCode,200,download.body);assert.match(download.headers['content-disposition']??'',/task\.pdf/);
  assert.equal((await signed(outsider,'GET',`/api/courses/${c.id}/content`)).statusCode,404);
  assert.equal((await signed(outsider,'GET',`/api/files/${fileId}`,undefined,'file')).statusCode,404);
  const revoked=await signed(owner,'PATCH',`/api/admin/enrollments/${access.id}`,{operation_id:randomUUID(),revision:Number(access.revision),status:'revoked',revocation_reason:'Fixture content revocation'});assert.equal(revoked.statusCode,200,revoked.body);
  assert.equal((await signed(student,'GET',`/api/courses/${c.id}/content`)).statusCode,404);
  assert.equal((await signed(student,'GET',`/api/files/${fileId}`,undefined,'file')).statusCode,404);
 }finally{globalThis.fetch=originalFetch;}
});

test('homework versions, private files, grading and late permission stay inside the assigned group',async()=>{
 const c=await course(),own=await group(c.id),foreign=await group(c.id),student=await actor('STUDENT'),outsider=await actor('STUDENT'),teacher=await actor(),courseOnly=await actor();
 await enrollment(student.id,c.id,own.id);await enrollment(outsider.id,c.id,foreign.id);
 await create('/api/admin/teacher-assignments',{teacher_id:teacher.id,course_id:c.id,group_id:own.id});
 await create('/api/admin/teacher-assignments',{teacher_id:courseOnly.id,course_id:c.id,group_id:null});
 const originalFetch=globalThis.fetch,stored=new Map<string,Uint8Array>();
 globalThis.fetch=async(input:any,init?:RequestInit)=>{
  const url=String(input);if(!url.includes('/storage/v1/object/uyym-private/'))throw new Error(`Unexpected external request: ${url}`);
  const path=decodeURIComponent(url.split('/storage/v1/object/uyym-private/')[1]);
  if(init?.method==='POST'){stored.set(path,new Uint8Array(init.body as ArrayBuffer));return Response.json({Key:path});}
  if(init?.method==='DELETE'){stored.delete(path);return Response.json({});}
  const bytes=stored.get(path);return bytes?new Response(bytes as unknown as BodyInit,{status:200,headers:{'content-type':'application/pdf'}}):new Response('{}',{status:404});
 };
 try{
  const pdf={name:'solution.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 student answer').toString('base64')};
  const homework=await signed(owner,'POST','/api/content/assignments',{operation_id:randomUUID(),course_id:c.id,group_id:own.id,title:'Versioned homework',published:true,lesson_id:null,instructions:'Show every step',due_at:new Date(Date.now()+3600000).toISOString(),max_grade:20,files:[]});assert.equal(homework.statusCode,200,homework.body);
  const assignmentId=homework.json().id;
  const tooMany=await signed(student,'POST',`/api/assignments/${assignmentId}/submission`,{operation_id:randomUUID(),expected_revision:null,answer:'',files:[pdf,pdf,pdf]});assert.equal(tooMany.statusCode,400,tooMany.body);
  const first=await signed(student,'POST',`/api/assignments/${assignmentId}/submission`,{operation_id:randomUUID(),expected_revision:null,answer:'First answer',files:[pdf]});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().current_version,1);
  const replayBody={operation_id:randomUUID(),expected_revision:Number(first.json().revision),answer:'Corrected answer',files:[]};
  const second=await signed(student,'POST',`/api/assignments/${assignmentId}/submission`,replayBody);assert.equal(second.statusCode,200,second.body);assert.equal(second.json().current_version,2);
  const replay=await signed(student,'POST',`/api/assignments/${assignmentId}/submission`,replayBody);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().replayed,true);
  assert.equal((await signed(outsider,'POST',`/api/assignments/${assignmentId}/submission`,{operation_id:randomUUID(),expected_revision:null,answer:'Foreign',files:[]})).statusCode,404);
  assert.equal((await signed(courseOnly,'GET',`/api/assignments/${assignmentId}/submissions`)).statusCode,404);
  const roster=await signed(teacher,'GET',`/api/assignments/${assignmentId}/submissions`);assert.equal(roster.statusCode,200,roster.body);assert.equal(roster.json().items.length,1);assert.equal(roster.json().items[0].user_id,student.id);assert.equal(roster.json().items[0].current_version,2);
  const detail=await signed(teacher,'GET',`/api/assignments/${assignmentId}/students/${student.id}/submission`);assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().versions.length,2);assert.equal(detail.json().versions[0].answer,'Corrected answer');assert.equal(detail.json().versions[1].files.length,1);assert.ok(!detail.body.includes('storage_path'));
  const excessive=await signed(teacher,'PATCH',`/api/assignments/${assignmentId}/students/${student.id}/review`,{operation_id:randomUUID(),expected_revision:Number(second.json().revision),status:'reviewed',grade:21,feedback:'Too high',late_allowed_until:null});assert.equal(excessive.statusCode,400,excessive.body);
  const reviewed=await signed(teacher,'PATCH',`/api/assignments/${assignmentId}/students/${student.id}/review`,{operation_id:randomUUID(),expected_revision:Number(second.json().revision),status:'reviewed',grade:18,feedback:'Clear reasoning',late_allowed_until:null});assert.equal(reviewed.statusCode,200,reviewed.body);
  await assert.rejects(db.query('UPDATE private.submissions SET grade=21 WHERE id=$1',[reviewed.json().id]));
  await assert.rejects(db.query('UPDATE private.assignments SET max_grade=17 WHERE id=$1',[assignmentId]));
  const studentView=await signed(student,'GET',`/api/courses/${c.id}/content`);assert.equal(studentView.statusCode,200,studentView.body);const ownAssignment=studentView.json().assignments.find((x:any)=>x.id===assignmentId);assert.equal(ownAssignment.submission.grade,18);assert.equal(ownAssignment.submission.feedback,'Clear reasoning');assert.equal(ownAssignment.submission.answer,'Corrected answer');assert.ok(!studentView.body.includes('First answer'));
  const oldFile=detail.json().versions[1].files[0].id;assert.equal((await signed(student,'GET',`/api/submission-files/${oldFile}`,undefined,'file')).statusCode,200);assert.equal((await signed(outsider,'GET',`/api/submission-files/${oldFile}`,undefined,'file')).statusCode,404);assert.equal((await signed(teacher,'GET',`/api/submission-files/${oldFile}`,undefined,'file')).statusCode,200);

  const lateHomework=await signed(owner,'POST','/api/content/assignments',{operation_id:randomUUID(),course_id:c.id,group_id:own.id,title:'Late homework',published:true,lesson_id:null,instructions:'Late permission required',due_at:new Date(Date.now()-3600000).toISOString(),max_grade:10,files:[]});assert.equal(lateHomework.statusCode,200,lateHomework.body);
  const lateId=lateHomework.json().id;assert.equal((await signed(student,'POST',`/api/assignments/${lateId}/submission`,{operation_id:randomUUID(),expected_revision:null,answer:'Late attempt',files:[]})).statusCode,403);
  const allowed=await signed(teacher,'PATCH',`/api/assignments/${lateId}/students/${student.id}/review`,{operation_id:randomUUID(),expected_revision:null,status:'not_submitted',grade:null,feedback:'One extra hour',late_allowed_until:new Date(Date.now()+3600000).toISOString()});assert.equal(allowed.statusCode,200,allowed.body);assert.equal(allowed.json().current_version,0);
  const lateSubmit=await signed(student,'POST',`/api/assignments/${lateId}/submission`,{operation_id:randomUUID(),expected_revision:Number(allowed.json().revision),answer:'Late but allowed',files:[]});assert.equal(lateSubmit.statusCode,200,lateSubmit.body);assert.equal(lateSubmit.json().is_late,true);
  await db.query('UPDATE private.enrollments SET group_id=$1 WHERE user_id=$2 AND course_id=$3',[foreign.id,student.id,c.id]);
  assert.equal((await signed(teacher,'GET',`/api/submission-files/${oldFile}`,undefined,'file')).statusCode,404);
  assert.equal((await signed(teacher,'GET',`/api/assignments/${assignmentId}/students/${student.id}/submission`)).statusCode,404);
  const audit=(await db.query("SELECT metadata FROM private.audit_log WHERE target_type='submission' AND subject_id=$1 ORDER BY created_at",[student.id])).rows;assert.ok(audit.length>=4);assert.ok(!JSON.stringify(audit).includes('Corrected answer')&&!JSON.stringify(audit).includes('Clear reasoning'));
 }finally{globalThis.fetch=originalFetch;}
});
