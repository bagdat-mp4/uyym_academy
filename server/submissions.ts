import {Buffer,isUtf8} from 'node:buffer';
import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';
import {context,proof,requireLearning,type Context} from './auth.js';
import {deletePrivateObject,downloadPrivateObject,uploadPrivateObject} from './storage.js';
import {fail,managementMutation,operationSchema,pageParams,uuid} from './management.js';
import {hash} from './security.js';

const acceptedMime=z.enum(['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/x-c++src']);
const encodedFile=z.object({name:z.string().min(1).max(300),mime:acceptedMime,base64:z.string().min(1)}).strict();
const submitSchema=z.object({
  ...operationSchema.shape,
  expected_revision:z.number().int().positive().nullable().default(null),
  answer:z.string().max(100000).default(''),
  files:z.array(encodedFile).max(2).default([]),
}).strict();
const reviewSchema=z.object({
  ...operationSchema.shape,
  expected_revision:z.number().int().positive().nullable().default(null),
  status:z.enum(['not_submitted','submitted','reviewed','needs_revision']),
  grade:z.number().nonnegative().nullable().default(null),
  feedback:z.string().max(20000).default(''),
  late_allowed_until:z.string().datetime({offset:true}).nullable().default(null),
}).strict();

function pathIds(req:FastifyRequest){const raw=req.params as any;return {assignmentId:uuid.parse(raw.id),userId:raw.userId?uuid.parse(raw.userId):undefined};}
function safeName(input:string){const name=input.split(/[\\/]/).pop()?.trim()||'';if(!name||/[\u0000-\u001f\u007f<>:"|?*]/.test(name))fail('INVALID_DATA',400);return name.slice(0,160);}
function matchesMime(bytes:Buffer,mime:z.infer<typeof acceptedMime>){
  if(mime==='application/pdf')return bytes.subarray(0,5).toString()==='%PDF-';
  if(mime==='image/png')return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime==='image/webp')return bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  return isUtf8(bytes)&&!bytes.includes(0);
}
function decode(input:z.infer<typeof encodedFile>){
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))fail('INVALID_DATA',400);
  const bytes=Buffer.from(input.base64,'base64');
  if(!bytes.length||bytes.length>5*1024*1024||!matchesMime(bytes,input.mime))fail('INVALID_DATA',400);
  return {bytes,name:safeName(input.name),mime:input.mime,sha256:createHash('sha256').update(bytes).digest('hex')};
}
function fileDto(row:any){return {id:row.id,name:row.original_name,mime:row.mime,size:Number(row.file_size),slot:Number(row.slot)};}

async function studentAssignment(db:PoolClient|typeof pool,ctx:Context,assignmentId:string,lock=false){
  const row=(await db.query(`SELECT a.*,c.active AS course_active,c.published AS course_published,g.active AS group_active
    FROM private.assignments a
    JOIN private.courses c ON c.id=a.course_id
    JOIN private.groups g ON g.id=a.group_id
    JOIN private.enrollments e ON e.user_id=$1 AND e.course_id=a.course_id AND e.group_id=a.group_id
    WHERE a.id=$2 AND a.published AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now()
      AND c.active AND c.published AND g.active
      AND (g.starts_at IS NULL OR g.starts_at<=now()) AND (g.ends_at IS NULL OR g.ends_at>now())
    ${lock?'FOR UPDATE OF a':''}`,[ctx.user_id,assignmentId])).rows[0];
  if(!row)fail('NOT_FOUND',404);return row;
}
async function staffAssignment(db:PoolClient|typeof pool,ctx:Context,assignmentId:string,lock=false){
  if(!['ADMIN','TEACHER'].includes(ctx.user.role))fail('FORBIDDEN');
  const row=(await db.query(`SELECT a.* FROM private.assignments a WHERE a.id=$1 ${lock?'FOR UPDATE':''}`,[assignmentId])).rows[0];
  if(!row)fail('NOT_FOUND',404);
  if(ctx.user.role==='TEACHER'){
    const allowed=(await db.query('SELECT 1 FROM private.teacher_assignments WHERE teacher_id=$1 AND course_id=$2 AND group_id=$3',[ctx.user_id,row.course_id,row.group_id])).rowCount;
    if(!allowed)fail('NOT_FOUND',404);
  }
  return row;
}
async function assignedStudent(db:PoolClient|typeof pool,assignment:any,userId:string){
  const student=(await db.query(`SELECT u.id,u.name,u.phone,e.status AS enrollment_status
    FROM private.enrollments e JOIN private.app_users u ON u.id=e.user_id
    WHERE e.user_id=$1 AND e.course_id=$2 AND e.group_id=$3 AND u.role='STUDENT'`,[userId,assignment.course_id,assignment.group_id])).rows[0];
  if(!student)fail('NOT_FOUND',404);return student;
}
async function submissionDetail(db:PoolClient|typeof pool,assignment:any,userId:string){
  const submission=(await db.query(`SELECT s.*,a.max_grade FROM private.submissions s JOIN private.assignments a ON a.id=s.assignment_id
    WHERE s.assignment_id=$1 AND s.user_id=$2`,[assignment.id,userId])).rows[0];
  if(!submission)return {assignment_id:assignment.id,user_id:userId,status:'not_submitted',current_version:0,revision:null,grade:null,feedback:'',reviewed_at:null,late_allowed_until:null,versions:[]};
  const versions=(await db.query('SELECT * FROM private.submission_versions WHERE submission_id=$1 ORDER BY version DESC',[submission.id])).rows;
  const ids=versions.map((x:any)=>x.id);
  const files=ids.length?(await db.query('SELECT * FROM private.submission_files WHERE version_id=ANY($1::uuid[]) ORDER BY version_id,slot',[ids])).rows:[];
  for(const version of versions)version.files=files.filter((x:any)=>x.version_id===version.id).map(fileDto);
  return {...submission,grade:submission.grade===null?null:Number(submission.grade),max_grade:Number(submission.max_grade),revision:Number(submission.revision),versions};
}
async function audit(db:PoolClient,ctx:Context,action:string,submissionId:string,userId:string,metadata:Record<string,unknown>){
  await db.query('INSERT INTO private.audit_log(actor_id,subject_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[ctx.user_id,userId,action,'submission',submissionId,JSON.stringify(metadata)]);
}

export async function registerSubmissionRoutes(app:FastifyInstance){
  app.post('/api/assignments/:id/submission',async req=>{
    const assignmentId=pathIds(req).assignmentId,data=submitSchema.parse(req.body),decoded=data.files.map(decode);
    if(!data.answer.trim()&&!decoded.length)fail('INVALID_DATA',400);
    const uploaded:string[]=[];
    try{return await managementMutation(req,`submission.upsert.${assignmentId}`,data,async(db,fresh)=>{
      const assignment=await studentAssignment(db,fresh,assignmentId,true);
      let current=(await db.query('SELECT * FROM private.submissions WHERE assignment_id=$1 AND user_id=$2 FOR UPDATE',[assignmentId,fresh.user_id])).rows[0];
      if(current&&data.expected_revision!==Number(current.revision))fail('CONFLICT',409);
      if(!current&&data.expected_revision!==null)fail('CONFLICT',409);
      const late=Boolean(assignment.due_at&&new Date(assignment.due_at).getTime()<Date.now());
      if(late&&(!current?.late_allowed_until||new Date(current.late_allowed_until).getTime()<Date.now()))fail('DEADLINE_PASSED',403);
      const nextVersion=current?Number(current.current_version)+1:1;
      if(!current)current=(await db.query(`INSERT INTO private.submissions(assignment_id,user_id,status,current_version)
        VALUES($1,$2,'submitted',1) RETURNING *`,[assignmentId,fresh.user_id])).rows[0];
      const version=(await db.query('INSERT INTO private.submission_versions(submission_id,version,answer,is_late) VALUES($1,$2,$3,$4) RETURNING *',[current.id,nextVersion,data.answer,late])).rows[0];
      for(let i=0;i<decoded.length;i++){
        const item=decoded[i],id=randomUUID(),storagePath=`submissions/${fresh.user_id}/${current.id}/${version.id}/${id}`;
        await uploadPrivateObject(storagePath,item.bytes,item.mime);uploaded.push(storagePath);
        await db.query(`INSERT INTO private.submission_files(id,version_id,slot,storage_path,original_name,mime,file_size,sha256)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,version.id,i+1,storagePath,item.name,item.mime,item.bytes.length,item.sha256]);
      }
      const updated=(await db.query(`UPDATE private.submissions SET status='submitted',current_version=$2,grade=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[current.id,nextVersion])).rows[0];
      await audit(db,fresh,'submission.submitted',current.id,fresh.user_id,{assignment_id:assignmentId,version:nextVersion,is_late:late,file_count:decoded.length});
      return {id:current.id,assignment_id:assignmentId,status:updated.status,current_version:nextVersion,revision:Number(updated.revision),is_late:late};
    },['STUDENT']);}catch(error){await Promise.allSettled(uploaded.map(deletePrivateObject));throw error;}
  });

  app.get('/api/assignments/:id/submissions',async req=>{
    const ctx=await proof(req);requireLearning(ctx);const assignmentId=pathIds(req).assignmentId,assignment=await staffAssignment(pool,ctx,assignmentId);
    const p=pageParams(req),params:any[]=[assignment.course_id,assignment.group_id],q=p.q.trim();
    let where='e.course_id=$1 AND e.group_id=$2';if(q){params.push(`%${q}%`);where+=` AND (u.name ILIKE $${params.length} OR u.phone ILIKE $${params.length})`;}
    const total=Number((await pool.query(`SELECT count(*) AS total FROM private.enrollments e JOIN private.app_users u ON u.id=e.user_id WHERE ${where}`,params)).rows[0].total);
    const items=(await pool.query(`SELECT u.id AS user_id,u.name AS student_name,u.phone,e.status AS enrollment_status,
      s.id,s.status,s.current_version,s.grade,s.feedback,s.reviewed_at,s.late_allowed_until,s.updated_at,s.revision
      FROM private.enrollments e JOIN private.app_users u ON u.id=e.user_id
      LEFT JOIN private.submissions s ON s.assignment_id=$${params.length+1} AND s.user_id=e.user_id
      WHERE ${where} ORDER BY (s.updated_at IS NULL),s.updated_at DESC,u.name LIMIT $${params.length+2} OFFSET $${params.length+3}`,
      [...params,assignmentId,p.page_size,(p.page-1)*p.page_size])).rows.map((row:any)=>({...row,status:row.status||'not_submitted',current_version:Number(row.current_version||0),grade:row.grade===null?null:Number(row.grade),revision:row.revision===null?null:Number(row.revision)}));
    return {assignment:{id:assignment.id,title:assignment.title,due_at:assignment.due_at,max_grade:Number(assignment.max_grade)},items,total,page:p.page,page_size:p.page_size};
  });

  app.get('/api/assignments/:id/students/:userId/submission',async req=>{
    const ctx=await proof(req);requireLearning(ctx);const {assignmentId,userId}=pathIds(req),assignment=await staffAssignment(pool,ctx,assignmentId);await assignedStudent(pool,assignment,userId!);return submissionDetail(pool,assignment,userId!);
  });

  app.patch('/api/assignments/:id/students/:userId/review',async req=>{
    const {assignmentId,userId}=pathIds(req),data=reviewSchema.parse(req.body);
    const receiptScope=hash(`${assignmentId}:${userId}`).slice(0,48);
    return managementMutation(req,`submission.review.${receiptScope}`,data,async(db,ctx)=>{
      const assignment=await staffAssignment(db,ctx,assignmentId,true);await assignedStudent(db,assignment,userId!);
      let submission=(await db.query('SELECT * FROM private.submissions WHERE assignment_id=$1 AND user_id=$2 FOR UPDATE',[assignmentId,userId])).rows[0];
      if(submission&&data.expected_revision!==Number(submission.revision))fail('CONFLICT',409);
      if(!submission&&data.expected_revision!==null)fail('CONFLICT',409);
      if(!submission){
        if(data.status!=='not_submitted'||data.grade!==null)fail('INVALID_DATA',400);
        submission=(await db.query(`INSERT INTO private.submissions(assignment_id,user_id,status,current_version,feedback,late_allowed_until)
          VALUES($1,$2,'not_submitted',0,$3,$4) RETURNING *`,[assignmentId,userId,data.feedback,data.late_allowed_until])).rows[0];
      }else{
        if(!Number(submission.current_version)&&data.status!=='not_submitted')fail('INVALID_DATA',400);
        if(Number(submission.current_version)&&data.status==='not_submitted')fail('INVALID_DATA',400);
        if(data.status==='reviewed'&&data.grade===null)fail('INVALID_DATA',400);
        if(['not_submitted','submitted'].includes(data.status)&&data.grade!==null)fail('INVALID_DATA',400);
        if(data.grade!==null&&data.grade>Number(assignment.max_grade))fail('GRADE_OUT_OF_RANGE',400);
        submission=(await db.query(`UPDATE private.submissions SET status=$2,grade=$3,feedback=$4,reviewed_by=$5,
          reviewed_at=CASE WHEN $2 IN ('reviewed','needs_revision') THEN now() ELSE reviewed_at END,
          late_allowed_until=$6,updated_at=now() WHERE id=$1 RETURNING *`,[submission.id,data.status,data.grade,data.feedback,ctx.user_id,data.late_allowed_until])).rows[0];
      }
      await audit(db,ctx,'submission.reviewed',submission.id,userId!,{assignment_id:assignmentId,status:submission.status,grade:submission.grade,late_allowed_until:submission.late_allowed_until,current_version:Number(submission.current_version)});
      return {id:submission.id,assignment_id:assignmentId,user_id:userId,status:submission.status,current_version:Number(submission.current_version),grade:submission.grade===null?null:Number(submission.grade),feedback:submission.feedback,late_allowed_until:submission.late_allowed_until,revision:Number(submission.revision)};
    },['ADMIN','TEACHER'],async(db,ctx)=>{const assignment=await staffAssignment(db,ctx,assignmentId);await assignedStudent(db,assignment,userId!);});
  });

  app.get('/api/submission-files/:id',async(req,reply)=>{
    const ctx=await proof(req,'file');requireLearning(ctx);const id=uuid.parse((req.params as any).id);
    const row=(await pool.query(`SELECT f.*,s.id AS submission_id,s.user_id,s.assignment_id FROM private.submission_files f
      JOIN private.submission_versions v ON v.id=f.version_id JOIN private.submissions s ON s.id=v.submission_id WHERE f.id=$1`,[id])).rows[0];
    if(!row)fail('NOT_FOUND',404);
    if(ctx.user.role==='STUDENT'){if(row.user_id!==ctx.user_id)fail('NOT_FOUND',404);await studentAssignment(pool,ctx,row.assignment_id);}
    else {const assignment=await staffAssignment(pool,ctx,row.assignment_id);await assignedStudent(pool,assignment,row.user_id);}
    const stream=await downloadPrivateObject(row.storage_path);
    const fresh=await context(req);requireLearning(fresh);if(fresh.id!==ctx.id||String(fresh.auth_epoch)!==String(ctx.auth_epoch)){stream.destroy();fail('FORBIDDEN');}
    reply.header('Content-Type',row.mime).header('Content-Length',String(row.file_size)).header('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`).header('X-Content-Type-Options','nosniff');return reply.send(stream);
  });
}
