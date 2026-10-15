import {createHash,randomUUID} from 'node:crypto';
import {isUtf8} from 'node:buffer';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';
import {proof,requireLearning,type Context} from './auth.js';
import {managementMutation,operationSchema,uuid,fail} from './management.js';
import {config} from './config.js';
import {listDriveFolder,validateDriveFile,validateListedDrivePart} from './drive.js';
import {deletePrivateObject,downloadPrivateObject,uploadPrivateObject} from './storage.js';

const text=z.string().trim().min(1).max(300);
const optionalText=z.string().trim().max(10000).default('');
const date=z.string().datetime({offset:true}).nullable().default(null);
const file=z.object({name:z.string().min(1).max(300),mime:z.enum(['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/x-c++src']),base64:z.string().min(1)}).strict();
const files=z.array(file).max(config.contentMaxFiles).default([]);
const base=z.object({course_id:uuid,group_id:uuid.nullable().default(null),title:text,published:z.boolean().default(false)});
const assignment=base.extend({group_id:uuid,lesson_id:uuid.nullable().default(null),instructions:z.string().trim().min(1).max(20000),due_at:date,max_grade:z.number().positive().max(100000).default(100),files}).strict();
const archive=base.extend({category:z.enum(['Quiz','Midterm','Endterm','Final']),exam_year:z.number().int().min(2000).max(2100),semester:z.string().trim().max(80).default(''),topic:z.string().trim().max(300).default(''),files}).strict();
const announcement=base.extend({body:z.string().trim().min(1).max(20000)}).strict();
const manifest=z.object({version:z.literal(1),codec:z.string().regex(/^avc1\.[0-9a-f]{6},mp4a\.40\.2$/),duration_seconds:z.number().positive(),parts:z.array(z.object({index:z.number().int().min(-1),file:z.string().regex(/^(init\.mp4|part\d{5}\.m4s)$/),drive_file_id:z.string().min(5).max(200).optional(),bytes:z.number().int().min(1).max(1048576),start:z.number().nonnegative(),duration:z.number().nonnegative().max(4.2)}).strict()).min(2)}).strict();
const lesson=base.extend({description:optionalText,teacher_id:uuid.nullable().default(null),scheduled_at:date,position:z.number().int().min(0).max(10000).default(0),drive_folder_id:z.string().min(5).max(200).nullable().default(null),source_file_id:z.string().min(5).max(200).nullable().default(null),manifest:manifest.nullable().default(null)}).strict();

function routeId(req:FastifyRequest){return uuid.parse((req.params as any).id);}
function patchBody<T extends Record<string,unknown>>(schema:z.ZodType<T>,raw:unknown):T{const parsed=schema.parse(raw);for(const key of Object.keys(parsed))if(!Object.prototype.hasOwnProperty.call(raw,key))delete parsed[key];return parsed;}
function safeName(input:string){const name=input.split(/[\\/]/).pop()?.trim()||'';if(!name||/[\u0000-\u001f\u007f<>:"|?*]/.test(name))fail('INVALID_DATA',400);return name.slice(0,160);}
function matchesMime(bytes:Buffer,mime:z.infer<typeof file>['mime']){
 if(mime==='application/pdf')return bytes.subarray(0,5).toString()==='%PDF-';
 if(mime==='image/png')return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/webp')return bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 return isUtf8(bytes)&&!bytes.includes(0);
}
function decode(input:z.infer<typeof file>){
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))fail('INVALID_DATA',400);
 const bytes=Buffer.from(input.base64,'base64');
 if(!bytes.length||bytes.length>config.contentMaxFileBytes||!matchesMime(bytes,input.mime))fail('INVALID_DATA',400);
 return {bytes,name:safeName(input.name),mime:input.mime,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function validTarget(db:PoolClient,courseId:string,groupId:string|null,lessonId:string|null=null){
 const course=(await db.query('SELECT id FROM private.courses WHERE id=$1',[courseId])).rows[0];if(!course)fail('INVALID_DATA',400);
 if(groupId){const group=(await db.query('SELECT id FROM private.groups WHERE id=$1 AND course_id=$2',[groupId,courseId])).rows[0];if(!group)fail('INVALID_DATA',400);}
 if(lessonId){const lesson=(await db.query('SELECT id FROM private.lessons WHERE id=$1 AND course_id=$2 AND (group_id IS NULL OR group_id IS NOT DISTINCT FROM $3)',[lessonId,courseId,groupId])).rows[0];if(!lesson)fail('INVALID_DATA',400);}
}
async function canEdit(db:PoolClient,ctx:Context,courseId:string,groupId:string|null){
 if(ctx.user.role==='ADMIN')return;
 if(ctx.user.role!=='TEACHER')fail('FORBIDDEN');
 const ok=(await db.query(`SELECT 1 FROM private.teacher_assignments WHERE teacher_id=$1 AND course_id=$2 AND ($3::uuid IS NULL AND group_id IS NULL OR $3::uuid IS NOT NULL AND (group_id IS NULL OR group_id=$3)) LIMIT 1`,[ctx.user_id,courseId,groupId])).rowCount;
 if(!ok)fail('FORBIDDEN');
}
async function viewScope(ctx:Context,courseId:string,groupId:string|null){
 if(ctx.user.role==='ADMIN')return;
 if(ctx.user.role==='TEACHER'){
  const ok=(await pool.query(`SELECT 1 FROM private.teacher_assignments WHERE teacher_id=$1 AND course_id=$2 AND ($3::uuid IS NULL AND group_id IS NULL OR $3::uuid IS NOT NULL AND (group_id IS NULL OR group_id=$3)) LIMIT 1`,[ctx.user_id,courseId,groupId])).rowCount;if(!ok)fail('NOT_FOUND',404);return;
 }
 const ok=(await pool.query(`SELECT 1 FROM private.enrollments e JOIN private.courses c ON c.id=e.course_id LEFT JOIN private.groups g ON g.id=e.group_id WHERE e.user_id=$1 AND e.course_id=$2 AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now() AND c.active AND c.published AND ($3::uuid IS NULL OR e.group_id=$3) AND (e.group_id IS NULL OR (g.active AND (g.starts_at IS NULL OR g.starts_at<=now()) AND (g.ends_at IS NULL OR g.ends_at>now())))`,[ctx.user_id,courseId,groupId])).rowCount;
 if(!ok)fail('NOT_FOUND',404);
}
async function courseAccess(ctx:Context,courseId:string){
 if(ctx.user.role==='ADMIN')return;
 if(ctx.user.role==='TEACHER'){if((await pool.query('SELECT 1 FROM private.teacher_assignments WHERE teacher_id=$1 AND course_id=$2 LIMIT 1',[ctx.user_id,courseId])).rowCount)return;fail('NOT_FOUND',404);}
 await viewScope(ctx,courseId,null);
}
async function attachFiles(db:PoolClient,ctx:Context,parentId:string,courseId:string,groupId:string|null,kind:'assignment'|'archive',incoming:z.infer<typeof files>){
 const decoded=incoming.map(decode),uploaded:string[]=[];
 try{
  for(const item of decoded){
   const id=randomUUID(),path=`learning/${parentId}/${id}`;await uploadPrivateObject(path,item.bytes,item.mime);uploaded.push(path);
   await db.query(`INSERT INTO private.learning_files(id,course_id,group_id,${kind==='assignment'?'assignment_id':'archive_entry_id'},storage_path,original_name,mime,file_size,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,courseId,groupId,parentId,path,item.name,item.mime,item.bytes.length,item.sha256,ctx.user_id]);
  }
 }catch(error){await Promise.all(uploaded.map(deletePrivateObject));throw error;}
}
function fileDto(row:any){return {id:row.id,name:row.original_name,mime:row.mime,size:Number(row.file_size)};}
function timeline(value:z.infer<typeof manifest>){
 if(value.parts[0].index!==-1||value.parts[0].duration!==0||value.parts.some((p,i)=>i>0&&(p.index!==i-1||p.duration<=0)))fail('INVALID_DATA',400);
 let expected=0;for(const p of value.parts.slice(1)){if(Math.abs(p.start-expected)>.05)fail('INVALID_DATA',400);expected+=p.duration;}if(Math.abs(expected-value.duration_seconds)>.05)fail('INVALID_DATA',400);
}
async function resolveVideo(data:z.infer<typeof lesson>){
 if(!data.manifest)return null;
 if(!data.drive_folder_id||!data.source_file_id)fail('INVALID_DATA',400);timeline(data.manifest);
 const original=await validateDriveFile(data.source_file_id,data.drive_folder_id,'source');
 const byName=data.manifest.parts.some(p=>!p.drive_file_id)?await listDriveFolder(data.drive_folder_id):new Map<string,any>();
 const parts=[];
 for(const part of data.manifest.parts){const listed=part.drive_file_id?null:byName.get(part.file);const id=part.drive_file_id||listed?.id;if(!id)fail('INVALID_DATA',400);if(listed)validateListedDrivePart(listed,data.drive_folder_id,part.bytes);else await validateDriveFile(id,data.drive_folder_id,'part',part.bytes);parts.push({...part,drive_file_id:id});}
 return {original,parts,codec:data.manifest.codec,duration:data.manifest.duration_seconds};
}
async function audit(db:PoolClient,ctx:Context,action:string,type:string,id:string,after:any){await db.query('INSERT INTO private.audit_log(actor_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5)',[ctx.user_id,action,type,id,JSON.stringify({after})]);}

export async function registerContentRoutes(app:FastifyInstance){
 app.get('/api/courses',async req=>{
  const ctx=await proof(req);requireLearning(ctx);let rows:any[]=[];
  if(ctx.user.role==='ADMIN')rows=(await pool.query('SELECT id,title,description,active,published,NULL::uuid AS group_id FROM private.courses ORDER BY title')).rows;
  else if(ctx.user.role==='TEACHER')rows=(await pool.query(`SELECT c.id,c.title,c.description,c.active,c.published,array_agg(t.group_id) AS group_ids FROM private.teacher_assignments t JOIN private.courses c ON c.id=t.course_id WHERE t.teacher_id=$1 GROUP BY c.id ORDER BY c.title`,[ctx.user_id])).rows;
  else rows=(await pool.query(`SELECT c.id,c.title,c.description,c.active,c.published,e.group_id,e.expires_at FROM private.enrollments e JOIN private.courses c ON c.id=e.course_id LEFT JOIN private.groups g ON g.id=e.group_id WHERE e.user_id=$1 AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now() AND c.active AND c.published AND (e.group_id IS NULL OR (g.active AND (g.starts_at IS NULL OR g.starts_at<=now()) AND (g.ends_at IS NULL OR g.ends_at>now()))) ORDER BY c.title`,[ctx.user_id])).rows;
  return {courses:rows};
 });

 app.get('/api/courses/:id/content',async req=>{
  const ctx=await proof(req),courseId=routeId(req);requireLearning(ctx);await courseAccess(ctx,courseId);
  let groups:string[]|null=null;
  if(ctx.user.role==='STUDENT'){const row=(await pool.query("SELECT group_id FROM private.enrollments WHERE user_id=$1 AND course_id=$2 AND status='active' AND starts_at<=now() AND expires_at>now()",[ctx.user_id,courseId])).rows[0];groups=row?.group_id?[row.group_id]:[];}
  if(ctx.user.role==='TEACHER'){const assigned=(await pool.query('SELECT group_id FROM private.teacher_assignments WHERE teacher_id=$1 AND course_id=$2',[ctx.user_id,courseId])).rows;if(!assigned.length)fail('NOT_FOUND',404);groups=assigned.some(x=>x.group_id===null)?null:assigned.map(x=>x.group_id);}
  const groupSql=groups===null?'TRUE':groups.length?`(x.group_id IS NULL OR x.group_id=ANY($2::uuid[]))`:'x.group_id IS NULL';
  // An ungrouped enrollment sees course-wide content only. Do not bind an
  // unused $2: it has no inferred type and shifts the student's progress ID.
  const params=groups?.length?[courseId,groups]:[courseId];const published=ctx.user.role==='STUDENT'?'AND x.published':'';
  const course=(await pool.query('SELECT id,title,description FROM private.courses WHERE id=$1',[courseId])).rows[0];if(!course)fail('NOT_FOUND',404);
  const visibleGroups=groups===null?(await pool.query('SELECT id,title,schedule_description,starts_at,ends_at FROM private.groups WHERE course_id=$1 ORDER BY title',[courseId])).rows:groups.length?(await pool.query('SELECT id,title,schedule_description,starts_at,ends_at FROM private.groups WHERE course_id=$1 AND id=ANY($2::uuid[]) ORDER BY title',[courseId,groups])).rows:[];
  const progress=ctx.user.role==='STUDENT'?`,COALESCE(lp.position_seconds,0) AS progress_seconds,lp.completed_at,lp.last_opened_at`:'';
  const lessonParams=[...params];if(ctx.user.role==='STUDENT')lessonParams.push(ctx.user_id);
  const progressJoin=ctx.user.role==='STUDENT'?`LEFT JOIN private.lesson_progress lp ON lp.lesson_id=x.id AND lp.user_id=$${lessonParams.length}`:'';
  const lessons=(await pool.query(`SELECT x.id,x.course_id,x.group_id,x.title,x.description,x.teacher_id,x.scheduled_at AS starts_at,x.position,x.published,x.revision,x.video_duration_seconds,(EXISTS(SELECT 1 FROM private.lesson_video_parts p WHERE p.lesson_id=x.id AND p.part_index=-1)) AS video_ready ${progress} FROM private.lessons x ${progressJoin} WHERE x.course_id=$1 AND ${groupSql} ${published} ORDER BY x.position,x.scheduled_at NULLS LAST,x.created_at`,lessonParams)).rows;
  const assignments=(await pool.query(`SELECT x.id,x.course_id,x.group_id,x.lesson_id,x.title,x.instructions,x.due_at,x.max_grade,x.published,x.revision FROM private.assignments x WHERE x.course_id=$1 AND ${groupSql} ${published} ORDER BY x.due_at NULLS LAST,x.created_at DESC`,params)).rows;
  const archive=(await pool.query(`SELECT x.id,x.course_id,x.group_id,x.category,x.exam_year,x.semester,x.topic,x.title,x.published,x.revision FROM private.archive_entries x WHERE x.course_id=$1 AND ${groupSql} ${published} ORDER BY x.exam_year DESC,x.category,x.title`,params)).rows;
  const announcements=(await pool.query(`SELECT x.id,x.course_id,x.group_id,x.title,x.body,x.published,x.revision,x.created_at,x.updated_at FROM private.announcements x WHERE x.course_id=$1 AND ${groupSql} ${published} ORDER BY x.created_at DESC`,params)).rows;
  const ids=[...assignments.map(x=>x.id),...archive.map(x=>x.id)];const attached=ids.length?(await pool.query('SELECT id,assignment_id,archive_entry_id,original_name,mime,file_size FROM private.learning_files WHERE assignment_id=ANY($1::uuid[]) OR archive_entry_id=ANY($1::uuid[]) ORDER BY created_at',[ids])).rows:[];
  for(const item of assignments)item.files=attached.filter(x=>x.assignment_id===item.id).map(fileDto);for(const item of archive)item.files=attached.filter(x=>x.archive_entry_id===item.id).map(fileDto);
  if(ctx.user.role==='STUDENT'&&assignments.length){
   const assignmentIds=assignments.map(x=>x.id);
   const submissions=(await pool.query(`SELECT s.id,s.assignment_id,s.status,s.current_version,s.grade,s.feedback,s.reviewed_at,s.late_allowed_until,s.revision,
     v.id AS version_id,v.answer,v.is_late,v.submitted_at
     FROM private.submissions s LEFT JOIN private.submission_versions v ON v.submission_id=s.id AND v.version=s.current_version
     WHERE s.user_id=$1 AND s.assignment_id=ANY($2::uuid[])`,[ctx.user_id,assignmentIds])).rows;
   const versionIds=submissions.map(x=>x.version_id).filter(Boolean);
   const submissionFiles=versionIds.length?(await pool.query('SELECT id,version_id,slot,original_name,mime,file_size FROM private.submission_files WHERE version_id=ANY($1::uuid[]) ORDER BY slot',[versionIds])).rows:[];
   for(const item of assignments){const own=submissions.find(x=>x.assignment_id===item.id);item.submission=own?{id:own.id,status:own.status,current_version:Number(own.current_version),grade:own.grade===null?null:Number(own.grade),feedback:own.feedback,reviewed_at:own.reviewed_at,late_allowed_until:own.late_allowed_until,revision:Number(own.revision),answer:own.answer??'',is_late:own.is_late,submitted_at:own.submitted_at,files:submissionFiles.filter(x=>x.version_id===own.version_id).map(fileDto)}:{status:'not_submitted',current_version:0,grade:null,feedback:'',revision:null,answer:'',files:[]};}
  }
  return {course,groups:visibleGroups,lessons,assignments,archive,announcements};
 });

 app.get('/api/files/:id',async(req,reply)=>{
  const ctx=await proof(req,'file'),id=routeId(req);requireLearning(ctx);
  const row=(await pool.query(`SELECT f.*,a.published AS assignment_published,r.published AS archive_published FROM private.learning_files f LEFT JOIN private.assignments a ON a.id=f.assignment_id LEFT JOIN private.archive_entries r ON r.id=f.archive_entry_id WHERE f.id=$1`,[id])).rows[0];
  if(!row)fail('NOT_FOUND',404);if(ctx.user.role==='STUDENT'&&!(row.assignment_published||row.archive_published))fail('NOT_FOUND',404);await viewScope(ctx,row.course_id,row.group_id);
  const stream=await downloadPrivateObject(row.storage_path);
  try{const fresh=await prooflessFresh(req,ctx);await viewScope(fresh,row.course_id,row.group_id);}catch(error){stream.destroy();throw error;}
  reply.header('Content-Type',row.mime).header('Content-Length',String(row.file_size)).header('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`).header('X-Content-Type-Options','nosniff');return reply.send(stream);
 });

 app.post('/api/content/assignments',async req=>{
  const data=assignment.extend(operationSchema.shape).parse(req.body);
  return managementMutation(req,'assignment.created',data,async(db,ctx)=>{await validTarget(db,data.course_id,data.group_id,data.lesson_id);const row=(await db.query('INSERT INTO private.assignments(course_id,group_id,lesson_id,title,instructions,due_at,max_grade,published,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[data.course_id,data.group_id,data.lesson_id,data.title,data.instructions,data.due_at,data.max_grade,data.published,ctx.user_id])).rows[0];await attachFiles(db,ctx,row.id,data.course_id,data.group_id,'assignment',data.files);await audit(db,ctx,'assignment.created','assignment',row.id,{title:row.title,published:row.published,max_grade:Number(row.max_grade)});return row;},['ADMIN','TEACHER'],async(db,ctx)=>canEdit(db,ctx,data.course_id,data.group_id));
 });
 app.patch('/api/content/assignments/:id',async req=>{
  const id=routeId(req),data=patchBody(assignment.partial().extend({...operationSchema.shape,revision:z.number().int().positive()}).strict(),req.body);
  return managementMutation(req,`assignment.changed.${id}`,data,async(db,ctx)=>{const old=(await db.query('SELECT * FROM private.assignments WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)fail('NOT_FOUND',404);if(Number(old.revision)!==data.revision)fail('CONFLICT',409);const next={...old,...data};await validTarget(db,next.course_id,next.group_id,next.lesson_id);const row=(await db.query('UPDATE private.assignments SET title=$2,instructions=$3,due_at=$4,published=$5,lesson_id=$6,max_grade=$7,updated_at=now() WHERE id=$1 RETURNING *',[id,next.title,next.instructions,next.due_at,next.published,next.lesson_id,next.max_grade])).rows[0];if(data.files?.length)await attachFiles(db,ctx,id,row.course_id,row.group_id,'assignment',data.files);await audit(db,ctx,'assignment.changed','assignment',id,{title:row.title,published:row.published,max_grade:Number(row.max_grade)});return row;},['ADMIN','TEACHER'],async(db,ctx)=>{const row=(await db.query('SELECT course_id,group_id FROM private.assignments WHERE id=$1',[id])).rows[0];if(!row)fail('NOT_FOUND',404);await canEdit(db,ctx,row.course_id,row.group_id);});
 });

 app.post('/api/content/archive',async req=>{
  const data=archive.extend(operationSchema.shape).parse(req.body);
  return managementMutation(req,'archive.created',data,async(db,ctx)=>{await validTarget(db,data.course_id,data.group_id);const row=(await db.query('INSERT INTO private.archive_entries(course_id,group_id,category,exam_year,semester,topic,title,published,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[data.course_id,data.group_id,data.category,data.exam_year,data.semester,data.topic,data.title,data.published,ctx.user_id])).rows[0];await attachFiles(db,ctx,row.id,data.course_id,data.group_id,'archive',data.files);await audit(db,ctx,'archive.created','archive',row.id,{title:row.title,category:row.category,published:row.published});return row;},['ADMIN','TEACHER'],async(db,ctx)=>canEdit(db,ctx,data.course_id,data.group_id));
 });
 app.patch('/api/content/archive/:id',async req=>{
  const id=routeId(req),data=patchBody(archive.partial().extend({...operationSchema.shape,revision:z.number().int().positive()}).strict(),req.body);
  return managementMutation(req,`archive.changed.${id}`,data,async(db,ctx)=>{const old=(await db.query('SELECT * FROM private.archive_entries WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)fail('NOT_FOUND',404);if(Number(old.revision)!==data.revision)fail('CONFLICT',409);const next={...old,...data};const row=(await db.query('UPDATE private.archive_entries SET category=$2,exam_year=$3,semester=$4,topic=$5,title=$6,published=$7,updated_at=now() WHERE id=$1 RETURNING *',[id,next.category,next.exam_year,next.semester,next.topic,next.title,next.published])).rows[0];if(data.files?.length)await attachFiles(db,ctx,id,row.course_id,row.group_id,'archive',data.files);await audit(db,ctx,'archive.changed','archive',id,{title:row.title,category:row.category,published:row.published});return row;},['ADMIN','TEACHER'],async(db,ctx)=>{const row=(await db.query('SELECT course_id,group_id FROM private.archive_entries WHERE id=$1',[id])).rows[0];if(!row)fail('NOT_FOUND',404);await canEdit(db,ctx,row.course_id,row.group_id);});
 });

 app.post('/api/content/announcements',async req=>{
  const data=announcement.extend(operationSchema.shape).parse(req.body);
  return managementMutation(req,'announcement.created',data,async(db,ctx)=>{await validTarget(db,data.course_id,data.group_id);const row=(await db.query('INSERT INTO private.announcements(course_id,group_id,title,body,published,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[data.course_id,data.group_id,data.title,data.body,data.published,ctx.user_id])).rows[0];await audit(db,ctx,'announcement.created','announcement',row.id,{title:row.title,published:row.published});return row;},['ADMIN','TEACHER'],async(db,ctx)=>canEdit(db,ctx,data.course_id,data.group_id));
 });
 app.patch('/api/content/announcements/:id',async req=>{
  const id=routeId(req),data=patchBody(announcement.partial().extend({...operationSchema.shape,revision:z.number().int().positive()}).strict(),req.body);
  return managementMutation(req,`announcement.changed.${id}`,data,async(db,ctx)=>{const old=(await db.query('SELECT * FROM private.announcements WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)fail('NOT_FOUND',404);if(Number(old.revision)!==data.revision)fail('CONFLICT',409);const next={...old,...data};const row=(await db.query('UPDATE private.announcements SET title=$2,body=$3,published=$4 WHERE id=$1 RETURNING *',[id,next.title,next.body,next.published])).rows[0];await audit(db,ctx,'announcement.changed','announcement',id,{title:row.title,published:row.published});return row;},['ADMIN','TEACHER'],async(db,ctx)=>{const row=(await db.query('SELECT course_id,group_id FROM private.announcements WHERE id=$1',[id])).rows[0];if(!row)fail('NOT_FOUND',404);await canEdit(db,ctx,row.course_id,row.group_id);});
 });

 app.post('/api/content/lessons',async req=>{
  const data=lesson.extend(operationSchema.shape).parse(req.body);
  return managementMutation(req,'lesson.created',data,async(db,ctx)=>{const video=await resolveVideo(data);if(data.published&&!video)fail('INVALID_DATA',400);await validTarget(db,data.course_id,data.group_id);const teacherId=ctx.user.role==='TEACHER'?ctx.user_id:data.teacher_id;const row=(await db.query(`INSERT INTO private.lessons(course_id,group_id,title,description,teacher_id,scheduled_at,position,published,drive_file_id,drive_folder_id,video_mime,video_size,video_duration_seconds,video_codec,drive_checked_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[data.course_id,data.group_id,data.title,data.description,teacherId,data.scheduled_at,data.position,data.published,data.source_file_id,data.drive_folder_id,video?'video/mp4':null,video?.original.size??null,video?.duration??null,video?.codec??null,video?'now':null,ctx.user_id])).rows[0];if(video)for(const p of video.parts)await db.query('INSERT INTO private.lesson_video_parts(lesson_id,part_index,drive_file_id,drive_folder_id,size_bytes,start_seconds,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)',[row.id,p.index,p.drive_file_id,data.drive_folder_id,p.bytes,p.start,p.duration]);await audit(db,ctx,'lesson.created','lesson',row.id,{title:row.title,published:row.published,video_ready:Boolean(video)});return row;},['ADMIN','TEACHER'],async(db,ctx)=>canEdit(db,ctx,data.course_id,data.group_id));
 });
 app.patch('/api/content/lessons/:id',async req=>{
  const id=routeId(req),data=patchBody(lesson.omit({manifest:true,drive_folder_id:true,source_file_id:true}).partial().extend({...operationSchema.shape,revision:z.number().int().positive()}).strict(),req.body);
  return managementMutation(req,`lesson.changed.${id}`,data,async(db,ctx)=>{const old=(await db.query('SELECT * FROM private.lessons WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)fail('NOT_FOUND',404);if(Number(old.revision)!==data.revision)fail('CONFLICT',409);const next={...old,...data};if(next.published&&!(await db.query('SELECT 1 FROM private.lesson_video_parts WHERE lesson_id=$1 AND part_index=-1',[id])).rowCount)fail('INVALID_DATA',400);const row=(await db.query('UPDATE private.lessons SET title=$2,description=$3,scheduled_at=$4,position=$5,published=$6,updated_at=now() WHERE id=$1 RETURNING *',[id,next.title,next.description,next.scheduled_at,next.position,next.published])).rows[0];if(!row.published)await db.query('UPDATE private.playback_grants SET revoked_at=now() WHERE lesson_id=$1 AND revoked_at IS NULL',[id]);await audit(db,ctx,'lesson.changed','lesson',id,{title:row.title,published:row.published});return row;},['ADMIN','TEACHER'],async(db,ctx)=>{const row=(await db.query('SELECT course_id,group_id FROM private.lessons WHERE id=$1',[id])).rows[0];if(!row)fail('NOT_FOUND',404);await canEdit(db,ctx,row.course_id,row.group_id);});
 });
}

async function prooflessFresh(req:FastifyRequest,previous:Context){
 const {context}=await import('./auth.js');const fresh=await context(req);requireLearning(fresh);if(fresh.id!==previous.id||String(fresh.auth_epoch)!==String(previous.auth_epoch))fail('FORBIDDEN');return fresh;
}
