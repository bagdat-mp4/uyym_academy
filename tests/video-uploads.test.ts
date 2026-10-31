import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {GoogleAuth,OAuth2Client} from 'google-auth-library';
import type {FastifyInstance,HTTPMethods} from 'fastify';

// Local contract test: actual BFF, SQL, signatures and range checks; Google
// identity/Drive HTTP are deterministic fixtures, never the owner's account.
const origin='https://video-upload-fixture.example',ownerId=randomUUID();
const ownerEmail='owner@example.invalid',readerEmail='reader@fixture.gserviceaccount.com';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
type Actor={id:string;key:CryptoKeyPair;cookie:string;csrf:string};
let db:PGlite,app:FastifyInstance,owner:Actor,teacher:Actor,otherTeacher:Actor,unassignedTeacher:Actor,student:Actor,courseId:string;
let endPool:(()=>Promise<void>)|undefined,previousFetch:typeof fetch;
const previousClient=GoogleAuth.prototype.getClient,previousGetToken=OAuth2Client.prototype.getToken,previousVerify=OAuth2Client.prototype.verifyIdToken,previousAccess=OAuth2Client.prototype.getAccessToken;
const files=new Map<string,{name:string;mimeType:string;parents:string[];size?:number}>();
let mediaBytes=Buffer.alloc(1048576+16);mediaBytes.write('ftyp',4);let uploadReceived=0,uploadCalls=0,expireNextQuery=false,backendRole='reader',permissionPatches=0;

before(async()=>{
 Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:origin,COOKIE_SECURE:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/postgres',SUPABASE_URL:'https://auth-video-fixture.example',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ADMIN_ENCRYPTION_KEY:'ab'.repeat(32),DRIVE_OWNER_USER_ID:ownerId,DRIVE_OWNER_EMAIL:ownerEmail,DRIVE_OAUTH_CLIENT_ID:'fixture-client',DRIVE_OAUTH_CLIENT_SECRET:'fixture-secret',DRIVE_OAUTH_ENCRYPTION_KEY:'cd'.repeat(32),DRIVE_ALLOWED_PERMISSION_EMAILS:`${ownerEmail},${readerEmail}`,GOOGLE_APPLICATION_CREDENTIALS_BASE64:Buffer.from(JSON.stringify({client_email:readerEmail})).toString('base64')});
 (GoogleAuth.prototype as any).getClient=async()=>({getRequestHeaders:async()=>new Headers({authorization:'Bearer SERVICE_FIXTURE'})});
 (OAuth2Client.prototype as any).getToken=async()=>({tokens:{refresh_token:'PRIVATE_FIXTURE_REFRESH',id_token:'FIXTURE_ID'}});
 (OAuth2Client.prototype as any).verifyIdToken=async()=>({getPayload:()=>({email:ownerEmail,email_verified:true})});
 (OAuth2Client.prototype as any).getAccessToken=async function(){this.credentials.expiry_date=Date.now()+3600000;return {token:'OWNER_FIXTURE'};};
 previousFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.hostname,'www.googleapis.com');
  const authorization=new Headers(init?.headers).get('authorization');assert.ok(authorization==='Bearer OWNER_FIXTURE'||authorization==='Bearer SERVICE_FIXTURE');
  if(url.pathname==='/upload/drive/v3/files'&&init?.method==='POST')return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=FIXTURE'}});
  if(url.pathname==='/upload/drive/v3/files'&&init?.method==='PUT'){
   if(!init.body&&expireNextQuery){expireNextQuery=false;return new Response(null,{status:410});}
   if(!init.body)return new Response(null,{status:308,headers:uploadReceived?{range:`bytes=0-${uploadReceived-1}`}:{}});
   const range=new Headers(init.headers).get('content-range')||'';const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);assert.ok(match);
   const start=Number(match[1]),end=Number(match[2]),total=Number(match[3]);assert.equal(start,uploadReceived);assert.equal(total,mediaBytes.length);
   const bytes=Buffer.from(init.body as Uint8Array);assert.equal(bytes.length,end-start+1);assert.deepEqual(bytes,mediaBytes.subarray(start,end+1));
   uploadCalls++;uploadReceived=end+1;
   if(uploadReceived<total)return new Response(null,{status:308,headers:{range:`bytes=0-${uploadReceived-1}`}});
   files.set('SOURCE_VIDEO',{name:'source.mp4',mimeType:'video/mp4',parents:['WEEK_FOLDER'],size:total});
   return Response.json({id:'SOURCE_VIDEO'}, {status:201});
  }
  if(url.pathname==='/drive/v3/about')return Response.json({storageQuota:{limit:'429496729600',usage:String(mediaBytes.length),usageInDrive:String(mediaBytes.length)}});
  if(url.pathname==='/drive/v3/files'&&init?.method==='POST'){
   const data=JSON.parse(String(init.body));const id=data.name==='UYYM Academy private lessons'?'ROOT_FOLDER':data.name==='Week 01'?'WEEK_FOLDER':'COURSE_FOLDER';
   files.set(id,{name:data.name,mimeType:data.mimeType,parents:data.parents||[]});return Response.json({id,mimeType:data.mimeType,parents:data.parents||[],ownedByMe:true});
  }
  const parts=url.pathname.split('/'),fileId=parts[4];const file=files.get(fileId);assert.ok(file,`Unknown fixture file ${fileId}`);
  if(parts[5]==='permissions'){
   if(init?.method==='POST'){backendRole=JSON.parse(String(init.body)).role;return Response.json({id:'SERVICE_PERMISSION'});}
   if(init?.method==='PATCH'){backendRole=JSON.parse(String(init.body)).role;permissionPatches++;return Response.json({id:'SERVICE_PERMISSION',role:backendRole});}
   return Response.json({permissions:[{id:'OWNER_PERMISSION',type:'user',emailAddress:ownerEmail,role:'owner'},{id:'SERVICE_PERMISSION',type:'user',emailAddress:readerEmail,role:backendRole}]});
  }
  if(url.searchParams.get('alt')==='media'){
   const match=/^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range')||'');assert.ok(match);
   const start=Number(match[1]),end=Number(match[2]);return new Response(mediaBytes.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${mediaBytes.length}`}});
  }
  return Response.json({id:fileId,mimeType:file.mimeType,parents:file.parents,ownedByMe:true,trashed:false,...(file.size?{size:file.size}:{})});
 };
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,phone text);create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of(await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const {pool}=await import('../server/db.js');endPool=pool.end.bind(pool);
 const query=async(sql:string,params:unknown[]=[])=>{const result=await db.query(sql,params);return {rows:result.rows,rowCount:result.rows.length||result.affectedRows||0,fields:[],command:'',oid:0};};
 (pool as any).query=query;(pool as any).connect=async()=>({query,release(){}});
 ({app}=await import('../server/index.js'));await app.ready();
 owner=await actor('ADMIN',ownerId);teacher=await actor('TEACHER');otherTeacher=await actor('TEACHER');unassignedTeacher=await actor('TEACHER');student=await actor('STUDENT');
 courseId=(await db.query<{id:string}>("SELECT id FROM private.courses WHERE slug='pp1'")).rows[0].id;
 await db.query('INSERT INTO private.teacher_assignments(teacher_id,course_id,created_by) VALUES($1,$2,$3)',[teacher.id,courseId,owner.id]);
 await db.query('INSERT INTO private.teacher_assignments(teacher_id,course_id,created_by) VALUES($1,$2,$3)',[otherTeacher.id,courseId,owner.id]);
 await db.query("INSERT INTO private.enrollments(user_id,course_id,status,starts_at,expires_at,created_by) VALUES($1,$2,'active',now()-interval '1 day',now()+interval '30 days',$3)",[student.id,courseId,owner.id]);
});
after(async()=>{globalThis.fetch=previousFetch;GoogleAuth.prototype.getClient=previousClient;OAuth2Client.prototype.getToken=previousGetToken;OAuth2Client.prototype.verifyIdToken=previousVerify;OAuth2Client.prototype.getAccessToken=previousAccess;await app?.close();await endPool?.();await db?.close();});
let person=0;
async function actor(role:'ADMIN'|'TEACHER'|'STUDENT',id=randomUUID()):Promise<Actor>{
 const phone=`+7709${String(++person).padStart(7,'0')}`;
 await db.query('INSERT INTO auth.users(id,phone) VALUES($1,$2)',[id,phone]);
 await db.query('INSERT INTO private.app_users(id,phone,name,role,must_change_password) VALUES($1,$2,$3,$4,false)',[id,phone,`Fixture ${role}`,role]);
 if(role==='ADMIN'){const {encrypt}=await import('../server/security.js');await db.query('UPDATE private.app_users SET admin_totp_secret_encrypted=$2 WHERE id=$1',[id,encrypt('JBSWY3DPEHPK3PXP',process.env.ADMIN_ENCRYPTION_KEY!)]);}
 const key=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']) as CryptoKeyPair;
 const publicKey=await webcrypto.subtle.exportKey('jwk',key.publicKey),device=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();
 await db.query("INSERT INTO private.device_bindings(id,user_id,public_key,label,status,approved_at,approved_by) VALUES($1,$2,$3,'Approved fixture','approved',now(),$4)",[device,id,JSON.stringify(publicKey),owner?.id??id]);
 await db.query('SELECT private.open_application_session($1,$2,1,$3,$4,$5,1800)',[id,device,sha(token),csrf,role==='ADMIN']);
 return {id,key,cookie:`__Host-uyym_session=${token}`,csrf};
}
async function signed(actor:Actor,method:HTTPMethods,path:string,body?:unknown,purpose='api'){
 const headers={cookie:actor.cookie,...(method==='GET'?{}:{origin,'content-type':'application/json','x-csrf-token':actor.csrf})};
 const challenge=await app.inject({method:'POST',url:'/api/proof/challenge',headers:{cookie:actor.cookie,origin,'content-type':'application/json','x-csrf-token':actor.csrf},payload:{method,path,purpose,body_hash:sha(body===undefined?'':JSON.stringify(body))}});
 assert.equal(challenge.statusCode,200,challenge.body);const result=challenge.json();
 const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},actor.key.privateKey,new TextEncoder().encode(result.payload));
 return app.inject({method,url:path,headers:{...headers,'x-proof-id':result.id,'x-device-proof':Buffer.from(signature).toString('base64url')},...(body!==undefined?{payload:body as any}:{})});
}

test('owner OAuth, scoped teacher resumable MP4, student proof streaming and revoke',async()=>{
 assert.equal((await signed(student,'GET','/api/admin/owner-drive')).statusCode,403);
 assert.equal((await signed(teacher,'POST','/api/admin/owner-drive/connect',{})).statusCode,403);
 const start=await signed(owner,'POST','/api/admin/owner-drive/connect',{});assert.equal(start.statusCode,200,start.body);
 const {state,url}=start.json();assert.match(url,/accounts\.google\.com/);
 const callback=await app.inject({method:'GET',url:`/api/drive/oauth/callback?state=${encodeURIComponent(state)}&code=FIXTURE_CODE`});assert.equal(callback.statusCode,302);
 assert.equal(callback.headers['referrer-policy'],'no-referrer');
 const finish=await signed(owner,'POST','/api/admin/owner-drive/finish',{state});assert.equal(finish.statusCode,200,finish.body);
 assert.equal((await signed(owner,'GET','/api/admin/owner-drive')).json().connected,true);
 backendRole='writer';
 const reconnect=await signed(owner,'POST','/api/admin/owner-drive/connect',{});assert.equal(reconnect.statusCode,200);
 const reconnectState=reconnect.json().state;
 const reconnectCallback=await app.inject({method:'GET',url:`/api/drive/oauth/callback?state=${encodeURIComponent(reconnectState)}&code=FIXTURE_CODE`});assert.equal(reconnectCallback.statusCode,302);
 const reconnectFinish=await signed(owner,'POST','/api/admin/owner-drive/finish',{state:reconnectState});assert.equal(reconnectFinish.statusCode,200,reconnectFinish.body);
 assert.equal(backendRole,'reader');assert.equal(permissionPatches,1,'reconnect must downgrade backend access back to reader');
 assert.equal((await signed(owner,'PATCH',`/api/admin/teacher-video-access/${teacher.id}`,{enabled:true})).statusCode,200);
 assert.equal((await signed(owner,'PATCH',`/api/admin/teacher-video-access/${unassignedTeacher.id}`,{enabled:true})).statusCode,200);
 assert.equal((await signed(unassignedTeacher,'POST','/api/teacher/video-uploads',{course_id:courseId,group_id:null,week:1,title:'Foreign course',description:'',name:'foreign.mp4',size:mediaBytes.length})).statusCode,404);
 const startUpload=await signed(teacher,'POST','/api/teacher/video-uploads',{course_id:courseId,group_id:null,week:1,title:'Real fixture lesson',description:'Source owned by owner',name:'teams.mp4',size:mediaBytes.length});
 assert.equal(startUpload.statusCode,200,startUpload.body);const {upload_id,lesson_id}=startUpload.json();
 assert.equal((await signed(student,'GET',`/api/teacher/video-uploads/${upload_id}`)).statusCode,403);
 assert.equal((await signed(otherTeacher,'GET',`/api/teacher/video-uploads/${upload_id}`)).statusCode,404);
 assert.equal((await signed(teacher,'POST',`/api/teacher/video-uploads/${upload_id}/sync`,{})).json().offset,0);
 const first=await signed(teacher,'PUT',`/api/teacher/video-uploads/${upload_id}/chunk`,{offset:0,data:mediaBytes.subarray(0,1048576).toString('base64')});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().offset,1048576);
 const final=await signed(teacher,'PUT',`/api/teacher/video-uploads/${upload_id}/chunk`,{offset:1048576,data:mediaBytes.subarray(1048576).toString('base64')});assert.equal(final.statusCode,200,final.body);assert.equal(final.json().status,'completed');assert.equal(uploadCalls,2);
 const draft=(await db.query<{published:boolean;drive_file_id:string}>('SELECT published,drive_file_id FROM private.lessons WHERE id=$1',[lesson_id])).rows[0];assert.equal(draft.published,false);assert.equal(draft.drive_file_id,'SOURCE_VIDEO');
 assert.equal((await signed(student,'POST',`/api/lessons/${lesson_id}/playback`,{},'playback')).statusCode,404);
 const revision=(await db.query<{revision:number}>('SELECT revision FROM private.lessons WHERE id=$1',[lesson_id])).rows[0].revision;
 assert.equal((await signed(teacher,'PATCH',`/api/content/lessons/${lesson_id}`,{operation_id:randomUUID(),revision:Number(revision),published:true})).statusCode,200);
 const play=await signed(student,'POST',`/api/lessons/${lesson_id}/playback`,{},'playback');assert.equal(play.statusCode,200,play.body);assert.equal(play.json().source,'native');
 const grant=play.json().grant_id,path=`/api/native-chunk/${lesson_id}?grant=${grant}&start=0&end=1023`;
 assert.equal((await app.inject({method:'GET',url:path,headers:{cookie:student.cookie}})).statusCode,403);
 backendRole='writer';assert.equal((await signed(student,'GET',path,undefined,'media')).statusCode,403,'a backend writer role must close student media access');backendRole='reader';
 const media=await signed(student,'GET',path,undefined,'media');assert.equal(media.statusCode,206,media.body.slice(0,80));assert.equal(media.headers['content-range'],`bytes 0-1023/${mediaBytes.length}`);
 await db.query("UPDATE private.enrollments SET status='paused' WHERE user_id=$1 AND course_id=$2",[student.id,courseId]);
 assert.equal((await signed(student,'GET',path,undefined,'media')).statusCode,404);
 const unfinished=await signed(teacher,'POST','/api/teacher/video-uploads',{course_id:courseId,group_id:null,week:1,title:'Revoked upload',description:'',name:'revoked.mp4',size:mediaBytes.length});
 assert.equal(unfinished.statusCode,200,unfinished.body);
 const pendingId=unfinished.json().upload_id;
 expireNextQuery=true;
 const expired=await signed(teacher,'POST',`/api/teacher/video-uploads/${pendingId}/sync`,{});
 assert.equal(expired.statusCode,200,expired.body);assert.equal(expired.json().status,'failed');
 const restarted=await signed(teacher,'POST',`/api/teacher/video-uploads/${pendingId}/restart`,{});
 assert.equal(restarted.statusCode,200,restarted.body);assert.equal(restarted.json().offset,0);
 const cancelled=await signed(teacher,'DELETE',`/api/teacher/video-uploads/${pendingId}`,{});
 assert.equal(cancelled.statusCode,200,cancelled.body);assert.equal(cancelled.json().status,'cancelled');
 const cancelledRow=(await db.query<{status:string;session_uri_encrypted:string}>('SELECT status,session_uri_encrypted FROM private.teacher_video_uploads WHERE id=$1',[pendingId])).rows[0];
 assert.equal(cancelledRow.status,'cancelled');assert.equal(cancelledRow.session_uri_encrypted,'');
 assert.equal((await signed(teacher,'POST',`/api/teacher/video-uploads/${pendingId}/sync`,{})).statusCode,409);
 assert.equal((await signed(otherTeacher,'DELETE',`/api/teacher/video-uploads/${pendingId}`,{})).statusCode,404);
 const revokePending=await signed(teacher,'POST','/api/teacher/video-uploads',{course_id:courseId,group_id:null,week:1,title:'Revoked upload',description:'',name:'revoked-again.mp4',size:mediaBytes.length});
 assert.equal(revokePending.statusCode,200,revokePending.body);
 assert.equal((await signed(owner,'PATCH',`/api/admin/teacher-video-access/${teacher.id}`,{enabled:false})).statusCode,200);
 assert.equal((await signed(teacher,'PUT',`/api/teacher/video-uploads/${revokePending.json().upload_id}/chunk`,{offset:0,data:mediaBytes.subarray(0,1048576).toString('base64')})).statusCode,403);
 assert.equal(uploadCalls,2);
 assert.equal((await signed(teacher,'POST','/api/teacher/video-uploads',{course_id:courseId,group_id:null,week:1,title:'Second lesson',description:'',name:'second.mp4',size:mediaBytes.length})).statusCode,403);
 assert.equal((await signed(owner,'PATCH',`/api/admin/teacher-video-access/${otherTeacher.id}`,{enabled:true})).statusCode,200);
 assert.equal((await signed(otherTeacher,'GET',`/api/teacher/video-uploads/${pendingId}`)).statusCode,404);
 assert.equal((await signed(otherTeacher,'POST','/api/teacher/video-uploads',{course_id:courseId,group_id:null,week:1,title:'Independent upload',description:'',name:'other.mp4',size:mediaBytes.length})).statusCode,200);
 const activity=await signed(owner,'GET','/api/admin/video-upload-activity');assert.equal(activity.statusCode,200);assert.ok(activity.json().events.some((event:any)=>event.action==='completed'));
 for(const payload of [startUpload.body,final.body,play.body,activity.body])assert.ok(!payload.includes('PRIVATE_FIXTURE_REFRESH')&&!payload.includes('upload_id=FIXTURE')&&!payload.includes('SOURCE_VIDEO'));
});
