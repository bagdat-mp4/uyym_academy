import type {FastifyInstance,FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction,audit} from './db.js';
import {config} from './config.js';
import {context,requireLearning} from './auth.js';
import {readAccess,freshManagement,uuid,fail} from './management.js';
import {hash,opaque,HttpError} from './security.js';
import {authorizationUrl,encryptOAuth,decryptOAuth,connectOwner,ownerDriveStatus,courseWeekFolder,startResumable,uploadChunk,queryUpload,verifyOwnerFile} from './owner-drive.js';
import {validateDriveFile} from './drive.js';

const startBody=z.object({course_id:uuid,group_id:uuid.nullable(),week:z.number().int().min(1).max(104),title:z.string().trim().min(1).max(300),description:z.string().max(10000).default(''),name:z.string().trim().min(5).max(240).regex(/\.mp4$/i),size:z.number().int().min(12).max(20*1024*1024*1024)}).strict();
const chunkBody=z.object({offset:z.number().int().min(0),data:z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(1400000)}).strict();
const stateBody=z.object({state:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)}).strict();
const toggleBody=z.object({enabled:z.boolean()}).strict();
function uploadId(req:FastifyRequest){return uuid.parse((req.params as any).id);}
function owner(ctx:{user_id:string;user:{role:string}}){if(ctx.user.role!=='ADMIN'||ctx.user_id!==config.driveOwnerUserId)fail('FORBIDDEN');}
async function assigned(db:any,teacherId:string,courseId:string,groupId:string|null){
 const user=(await db.query("SELECT active,role FROM private.app_users WHERE id=$1",[teacherId])).rows[0];
 if(!user?.active||user.role!=='TEACHER')fail('FORBIDDEN');
 const permission=(await db.query('SELECT enabled FROM private.teacher_video_upload_access WHERE teacher_id=$1',[teacherId])).rows[0];
 if(!permission?.enabled)fail('FORBIDDEN');
 const course=(await db.query('SELECT id,slug,weeks FROM private.courses WHERE id=$1 AND active',[courseId])).rows[0];if(!course)fail('NOT_FOUND',404);
 if(groupId&&!(await db.query('SELECT 1 FROM private.groups WHERE id=$1 AND course_id=$2 AND active',[groupId,courseId])).rowCount)fail('NOT_FOUND',404);
 const scope=(await db.query(`SELECT 1 FROM private.teacher_assignments WHERE teacher_id=$1 AND course_id=$2 AND (group_id IS NULL OR group_id=$3) LIMIT 1`,[teacherId,courseId,groupId])).rowCount;
 if(!scope)fail('NOT_FOUND',404);return course;
}
async function freshTeacher(db:any,req:FastifyRequest,previous:any,courseId:string,groupId:string|null){
 const fresh=await context(req,db);requireLearning(fresh);
 if(fresh.id!==previous.id||fresh.user_id!==previous.user_id||fresh.user.role!=='TEACHER')fail('FORBIDDEN');
 // Share-lock the permission for the duration of a chunk. Revocation waits for
 // an in-flight chunk, then prevents the next one from starting.
 const access=(await db.query('SELECT enabled FROM private.teacher_video_upload_access WHERE teacher_id=$1 FOR SHARE',[fresh.user_id])).rows[0];
 if(!access?.enabled)fail('FORBIDDEN');
 await assigned(db,fresh.user_id,courseId,groupId);return fresh;
}
async function logUpload(db:any,uploadId:string,actorId:string,action:string,offset:number){
 await db.query('INSERT INTO private.teacher_video_upload_events(upload_id,actor_id,action,offset_bytes) VALUES($1,$2,$3,$4)',[uploadId,actorId,action,offset]);
}
async function finish(db:any,row:any,fileId:string,actorId:string){
 await verifyOwnerFile(fileId,row.folder_id,Number(row.file_size));
 await validateDriveFile(fileId,row.folder_id,'source',Number(row.file_size));
 await db.query("UPDATE private.teacher_video_uploads SET status='completed',next_offset=file_size,drive_file_id=$2,session_uri_encrypted='',updated_at=now() WHERE id=$1",[row.id,fileId]);
 await db.query("UPDATE private.lessons SET drive_file_id=$2,drive_folder_id=$3,video_mime='video/mp4',video_size=$4,drive_checked_at=now(),updated_at=now() WHERE id=$1 AND published=false",[row.lesson_id,fileId,row.folder_id,row.file_size]);
 await logUpload(db,row.id,actorId,'completed',Number(row.file_size));
 await audit(db,actorId,'teacher.video.completed','lesson',row.lesson_id,{course_id:row.course_id,week:row.week,size_bytes:Number(row.file_size)});
}

export async function registerVideoUploadRoutes(app:FastifyInstance){
 app.get('/api/admin/owner-drive',async req=>{const ctx=await readAccess(req);const status=await ownerDriveStatus();return ctx.user_id===config.driveOwnerUserId?{...status,can_connect:true}:{configured:status.configured,connected:status.connected,can_connect:false};});
 app.post('/api/admin/owner-drive/connect',async req=>{
  const ctx=await readAccess(req);owner(ctx);
  const state=opaque();await pool.query('INSERT INTO private.owner_drive_oauth_requests(state_hash,admin_id,session_id,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',[hash(state),ctx.user_id,ctx.id]);
  return {url:authorizationUrl(state),state};
 });
 // Google redirects without browser-proof headers. This only stores the short-lived
 // code, encrypted; the owner must finish with a fresh signed POST from the same session.
 app.get('/api/drive/oauth/callback',async(req,reply)=>{
  reply.header('Referrer-Policy','no-referrer');
  const query=z.object({state:stateBody.shape.state,code:z.string().max(4096).optional(),error:z.string().max(256).optional()}).parse(req.query);
  if(!query.code||query.error)return reply.redirect('/#account?drive_oauth=failed');
  const updated=await pool.query(`UPDATE private.owner_drive_oauth_requests SET code_encrypted=$2 WHERE state_hash=$1 AND code_encrypted IS NULL AND consumed_at IS NULL AND expires_at>now()`,[hash(query.state),encryptOAuth(query.code)]);
  return reply.redirect(updated.rowCount?'/#account?drive_oauth=ready':'/#account?drive_oauth=failed');
 });
 app.post('/api/admin/owner-drive/finish',async req=>{
  const ctx=await readAccess(req);owner(ctx);const {state}=stateBody.parse(req.body);
  const row=(await pool.query('SELECT code_encrypted FROM private.owner_drive_oauth_requests WHERE state_hash=$1 AND admin_id=$2 AND session_id=$3 AND consumed_at IS NULL AND expires_at>now()',[hash(state),ctx.user_id,ctx.id])).rows[0];
  if(!row?.code_encrypted)fail('INVALID_DATA',400);
  const result=await connectOwner(decryptOAuth(row.code_encrypted));
  await pool.query('UPDATE private.owner_drive_oauth_requests SET consumed_at=now(),code_encrypted=NULL WHERE state_hash=$1 AND consumed_at IS NULL',[hash(state)]);
  await audit(pool,ctx.user_id,'owner.drive.connected','drive',null,{email:result.email});
  return {connected:true,email:result.email};
 });
 app.get('/api/admin/teacher-video-access',async req=>{
  await readAccess(req);
  const {rows}=await pool.query(`SELECT u.id,u.name,COALESCE(a.enabled,false) AS enabled FROM private.app_users u LEFT JOIN private.teacher_video_upload_access a ON a.teacher_id=u.id WHERE u.role='TEACHER' AND u.active ORDER BY u.name`);
  return {teachers:rows};
 });
 app.patch('/api/admin/teacher-video-access/:id',async req=>{
  const ctx=await readAccess(req),id=uploadId(req),data=toggleBody.parse(req.body);
  return transaction(async db=>{
   const fresh=await freshManagement(db,req,ctx);
   const user=(await db.query("SELECT id FROM private.app_users WHERE id=$1 AND role='TEACHER' AND active",[id])).rows[0];if(!user)fail('NOT_FOUND',404);
   await db.query(`INSERT INTO private.teacher_video_upload_access(teacher_id,enabled,updated_by) VALUES($1,$2,$3)
    ON CONFLICT(teacher_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now()`,[id,data.enabled,fresh.user_id]);
   await audit(db,fresh.user_id,'teacher.video.access','user',id,{enabled:data.enabled});return {ok:true,enabled:data.enabled};
  });
 });
 app.get('/api/teacher/video-uploads',async req=>{
  const ctx=await readAccess(req,['TEACHER']);
  const {rows}=await pool.query(`SELECT v.id,v.course_id,v.group_id,v.lesson_id,v.week,v.original_name,v.file_size,v.next_offset,v.status,v.created_at,v.updated_at,l.title,l.published,l.revision FROM private.teacher_video_uploads v JOIN private.lessons l ON l.id=v.lesson_id WHERE v.teacher_id=$1 ORDER BY v.created_at DESC LIMIT 100`,[ctx.user_id]);
  const enabled=Boolean((await pool.query('SELECT enabled FROM private.teacher_video_upload_access WHERE teacher_id=$1',[ctx.user_id])).rows[0]?.enabled);
  return {uploads:rows,enabled};
 });
 app.post('/api/teacher/video-uploads',async req=>{
  const ctx=await readAccess(req,['TEACHER']),data=startBody.parse(req.body);
  const course=await assigned(pool,ctx.user_id,data.course_id,data.group_id);
  if(data.week>Number(course.weeks))fail('INVALID_DATA',400);
  const folder=await courseWeekFolder(course.id,course.slug,data.week);
  const remoteName=`${new Date().toISOString().slice(0,10)}-${randomUUID()}.mp4`;
  const session=await startResumable(folder,remoteName,data.size);
  return transaction(async db=>{
   await freshManagement(db,req,ctx,['TEACHER']);await assigned(db,ctx.user_id,data.course_id,data.group_id);
   const lesson=(await db.query(`INSERT INTO private.lessons(course_id,group_id,title,description,teacher_id,week,published,created_by) VALUES($1,$2,$3,$4,$5,$6,false,$5) RETURNING id`,[data.course_id,data.group_id,data.title,data.description,ctx.user_id,data.week])).rows[0];
   const row=(await db.query(`INSERT INTO private.teacher_video_uploads(teacher_id,course_id,group_id,lesson_id,week,folder_id,original_name,file_size,session_uri_encrypted,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '6 days') RETURNING id`,[ctx.user_id,data.course_id,data.group_id,lesson.id,data.week,folder,data.name,data.size,encryptOAuth(session)])).rows[0];
   await logUpload(db,row.id,ctx.user_id,'started',0);
   await audit(db,ctx.user_id,'teacher.video.started','lesson',lesson.id,{course_id:data.course_id,week:data.week,size_bytes:data.size});
   return {upload_id:row.id,lesson_id:lesson.id,offset:0,chunk_bytes:1048576};
  });
 });
 app.get('/api/teacher/video-uploads/:id',async req=>{
  const ctx=await readAccess(req,['TEACHER']),id=uploadId(req);
  const row=(await pool.query('SELECT id,teacher_id,course_id,group_id,lesson_id,file_size,next_offset,status,expires_at FROM private.teacher_video_uploads WHERE id=$1',[id])).rows[0];
  if(!row||row.teacher_id!==ctx.user_id)fail('NOT_FOUND',404);
  return {upload_id:row.id,lesson_id:row.lesson_id,size:Number(row.file_size),offset:Number(row.next_offset),status:row.status};
 });
 app.post('/api/teacher/video-uploads/:id/sync',async req=>{
  const ctx=await readAccess(req,['TEACHER']),id=uploadId(req);
  return transaction(async db=>{
   const row=(await db.query('SELECT * FROM private.teacher_video_uploads WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row||row.teacher_id!==ctx.user_id)fail('NOT_FOUND',404);
   await freshTeacher(db,req,ctx,row.course_id,row.group_id);
   if(row.status==='completed')return {offset:Number(row.file_size),status:'completed',lesson_id:row.lesson_id};
   if(row.status!=='uploading'||new Date(row.expires_at).getTime()<=Date.now())fail('CONFLICT',409);
   const result=await queryUpload(decryptOAuth(row.session_uri_encrypted),Number(row.file_size));
   if(result.complete){await finish(db,row,result.file_id,ctx.user_id);return {offset:Number(row.file_size),status:'completed',lesson_id:row.lesson_id};}
   await db.query('UPDATE private.teacher_video_uploads SET next_offset=$2,updated_at=now() WHERE id=$1',[id,result.offset]);
   return {offset:result.offset,status:'uploading',lesson_id:row.lesson_id};
  });
 });
 app.put('/api/teacher/video-uploads/:id/chunk',{bodyLimit:2*1024*1024},async req=>{
  const ctx=await readAccess(req,['TEACHER']),id=uploadId(req),data=chunkBody.parse(req.body);
  const bytes=Buffer.from(data.data,'base64');
  if(!bytes.length||bytes.length>1048576||bytes.toString('base64')!==data.data)fail('INVALID_DATA',400);
  return transaction(async db=>{
   const row=(await db.query('SELECT * FROM private.teacher_video_uploads WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row||row.teacher_id!==ctx.user_id)fail('NOT_FOUND',404);
   await freshTeacher(db,req,ctx,row.course_id,row.group_id);
   const size=Number(row.file_size),end=data.offset+bytes.length;
   if(row.status!=='uploading'||new Date(row.expires_at).getTime()<=Date.now()||data.offset!==Number(row.next_offset)||end>size||end<size&&bytes.length%262144!==0)fail('CONFLICT',409);
   if(data.offset===0&&bytes.subarray(4,8).toString('ascii')!=='ftyp')fail('INVALID_DATA',400);
   const result=await uploadChunk(decryptOAuth(row.session_uri_encrypted),size,bytes,data.offset);
   await freshTeacher(db,req,ctx,row.course_id,row.group_id);
   if(result.complete){await finish(db,row,result.file_id,ctx.user_id);return {offset:size,status:'completed',lesson_id:row.lesson_id};}
   if(result.offset<data.offset||result.offset>end)throw new HttpError(503,'Drive offset жарамсыз');
   await db.query('UPDATE private.teacher_video_uploads SET next_offset=$2,updated_at=now() WHERE id=$1',[id,result.offset]);
   if(result.offset===size||result.offset%8388608<bytes.length)await logUpload(db,id,ctx.user_id,'progress',result.offset);
   return {offset:result.offset,status:'uploading',lesson_id:row.lesson_id};
  });
 });
 app.get('/api/admin/video-upload-activity',async req=>{
  await readAccess(req);const {rows}=await pool.query(`SELECT e.action,e.offset_bytes,e.created_at,v.course_id,v.week,u.name AS teacher_name,l.title AS lesson_title FROM private.teacher_video_upload_events e JOIN private.teacher_video_uploads v ON v.id=e.upload_id JOIN private.app_users u ON u.id=e.actor_id JOIN private.lessons l ON l.id=v.lesson_id ORDER BY e.id DESC LIMIT 100`);return {events:rows};
 });
}
