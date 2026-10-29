import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';
import {hash,normalizePhone} from './security.js';
import type {Context} from './auth.js';
import {readAccess,managementMutation,pageList,uuid,operationSchema,fail} from './management.js';

const revision=z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text=z.string().trim().min(1).max(160);
const date=z.string().datetime({offset:true});
const status=z.enum(['pending','active','paused','expired','revoked']);
const method=z.enum(['manual','cash','bank_transfer','card','other']);
const filters=z.object({q:z.string().max(120).default(''),course_id:uuid.optional(),group_id:uuid.optional(),user_id:uuid.optional(),role:z.enum(['ADMIN','TEACHER','STUDENT']).optional(),status:z.string().max(30).optional()});
const courses=z.object({slug:z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(100),title:text,description:z.string().max(10000).default(''),published:z.boolean().default(false),active:z.boolean().default(true),weeks:z.number().int().min(1).max(104).default(6),lessons_per_week:z.number().int().min(1).max(14).default(2),lesson_minutes:z.number().int().min(1).max(480).default(90),price_kzt:z.number().int().min(0).max(100000000).default(60000),default_group_size:z.number().int().min(1).max(10000).default(5)});
const groups=z.object({course_id:uuid,title:text,capacity:z.number().int().min(1).max(10000).default(5),active:z.boolean().default(true),starts_at:date.nullable().default(null),ends_at:date.nullable().default(null),schedule_description:z.string().max(2000).default('')});
const assignments=z.object({teacher_id:uuid,course_id:uuid,group_id:uuid.nullable().default(null),can_manage_access:z.boolean().default(false)});
const enrollments=z.object({user_id:uuid,course_id:uuid,group_id:uuid.nullable().default(null),status:status.default('pending'),starts_at:date,expires_at:date,payment_status:z.enum(['unpaid','partial','paid','refunded']).default('unpaid'),revocation_reason:z.string().max(1000).default('')});
const payments=z.object({enrollment_id:uuid,amount_kzt:z.number().int().min(1).max(100000000),paid_at:date,method:method.default('manual'),note:z.string().max(2000).default('')});
const studentChanges=z.object({operation_id:uuid,revision,status:status.optional(),starts_at:date.optional(),expires_at:date.optional()}).strict().refine(d=>d.status!==undefined||d.starts_at!==undefined||d.expires_at!==undefined);
const groupStudents=z.object({
 operation_id:uuid,
 students:z.array(z.object({user_id:uuid,enrollment_revision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()}).strict()).min(1).max(100),
 status:z.enum(['active','pending']),starts_at:date,expires_at:date,
}).strict().refine(data=>new Set(data.students.map(student=>student.user_id)).size===data.students.length);

const courseSelect='c.id,c.slug,c.title,c.description,c.published,c.active,c.weeks,c.lessons_per_week,c.lesson_minutes,c.price_kzt,c.default_group_size,c.revision,c.created_at,c.updated_at';
const groupSelect=`g.id,g.course_id,g.title,g.capacity,g.active,g.starts_at,g.ends_at,g.schedule_description,g.revision,g.created_at,g.updated_at,c.title AS course_title,(SELECT count(*)::integer FROM private.enrollments e WHERE e.group_id=g.id AND e.status IN ('pending','active','paused') AND e.expires_at>now()) AS reserved_seats`;
const effective=`CASE WHEN e.status='revoked' THEN 'revoked' WHEN e.expires_at<=now() THEN 'expired' WHEN NOT u.active OR u.auth_operation_id IS NOT NULL OR NOT c.active OR NOT c.published OR (e.group_id IS NOT NULL AND (NOT g.active OR g.ends_at<=now())) THEN 'paused' WHEN e.status='active' AND (e.starts_at>now() OR g.starts_at>now()) THEN 'pending' ELSE e.status END`;
const enrollmentSelect=`e.id,e.user_id,e.course_id,e.group_id,e.status,e.starts_at,e.expires_at,e.payment_status,e.revision,e.revoked_at,e.revocation_reason,e.created_at,e.updated_at,u.name AS user_name,u.name AS student_name,u.phone,u.active AS user_active,c.title AS course_title,g.title AS group_title,${effective} AS effective_status`;
// Teachers need access dates and educational roster details, never the owner's
// payment status or private administrative reason for revoking enrollment.
const teacherEnrollmentSelect=`e.id,e.user_id,e.course_id,e.group_id,e.status,e.starts_at,e.expires_at,e.revision,e.revoked_at,e.created_at,e.updated_at,u.name AS user_name,u.name AS student_name,u.phone,u.active AS user_active,c.title AS course_title,g.title AS group_title,${effective} AS effective_status`;
const enrollmentFrom='private.enrollments e JOIN private.app_users u ON u.id=e.user_id JOIN private.courses c ON c.id=e.course_id LEFT JOIN private.groups g ON g.id=e.group_id';
const assignmentSelect='t.id,t.teacher_id,t.course_id,t.group_id,t.can_manage_access,t.revision,t.created_at,u.name AS teacher_name,u.phone,c.title AS course_title,g.title AS group_title';
const assignmentFrom='private.teacher_assignments t JOIN private.app_users u ON u.id=t.teacher_id JOIN private.courses c ON c.id=t.course_id LEFT JOIN private.groups g ON g.id=t.group_id';
const paymentFrom=`private.payments p JOIN private.enrollments e ON e.id=p.enrollment_id JOIN private.app_users u ON u.id=e.user_id JOIN private.courses c ON c.id=e.course_id LEFT JOIN private.groups g ON g.id=e.group_id LEFT JOIN LATERAL (SELECT x.* FROM private.payment_corrections x WHERE x.payment_id=p.id ORDER BY x.revision DESC LIMIT 1) pc ON true LEFT JOIN private.app_users recorder ON recorder.id=COALESCE(pc.recorded_by,p.recorded_by)`;
const paymentSelect=`p.id,p.enrollment_id,e.user_id,e.course_id,e.group_id,u.name AS student_name,u.name AS user_name,u.phone,c.title AS course_title,g.title AS group_title,COALESCE(pc.amount_kzt,p.amount_kzt) AS amount_kzt,COALESCE(pc.paid_at,p.paid_at) AS paid_at,COALESCE(pc.method,p.method) AS method,COALESCE(pc.note,p.note) AS note,COALESCE(pc.state,'posted') AS state,COALESCE(pc.revision,0) AS revision,COALESCE(pc.reason,'') AS reason,p.created_at,COALESCE(pc.recorded_by,p.recorded_by) AS recorded_by,recorder.name AS recorded_by_name`;
// target_id is historical text. Compare UUIDs as text instead of casting an
// old or external target string; labels expose names only, never whole rows.
const auditFrom=`private.audit_log a LEFT JOIN private.app_users actor ON actor.id=a.actor_id LEFT JOIN private.app_users subject ON subject.id=a.subject_id LEFT JOIN LATERAL (
 SELECT c.title AS label FROM private.courses c WHERE a.target_type='course' AND c.id::text=a.target_id
 UNION ALL SELECT concat_ws(' · ',g.title,c.title) FROM private.groups g JOIN private.courses c ON c.id=g.course_id WHERE a.target_type='group' AND g.id::text=a.target_id
 UNION ALL SELECT concat_ws(' · ',u.name,c.title,g.title) FROM private.enrollments e JOIN private.app_users u ON u.id=e.user_id JOIN private.courses c ON c.id=e.course_id LEFT JOIN private.groups g ON g.id=e.group_id WHERE a.target_type='enrollment' AND e.id::text=a.target_id
 UNION ALL SELECT concat_ws(' · ',u.name,c.title) FROM private.payments p JOIN private.enrollments e ON e.id=p.enrollment_id JOIN private.app_users u ON u.id=e.user_id JOIN private.courses c ON c.id=e.course_id WHERE a.target_type='payment' AND p.id::text=a.target_id
 UNION ALL SELECT concat_ws(' · ',u.name,c.title,g.title) FROM private.teacher_assignments t JOIN private.app_users u ON u.id=t.teacher_id JOIN private.courses c ON c.id=t.course_id LEFT JOIN private.groups g ON g.id=t.group_id WHERE a.target_type='assignment' AND t.id::text=a.target_id
 UNION ALL SELECT u.name FROM private.app_users u WHERE a.target_type='user' AND u.id::text=a.target_id
 UNION ALL SELECT concat_ws(' · ',u.name,d.label) FROM private.device_bindings d JOIN private.app_users u ON u.id=d.user_id WHERE a.target_type='device' AND d.id::text=a.target_id
 UNION ALL SELECT COALESCE(o.name,u.name) FROM private.auth_operations o LEFT JOIN private.app_users u ON u.id=o.target_user_id WHERE a.target_type='auth_operation' AND o.id::text=a.target_id
 UNION ALL SELECT s.title FROM private.site_settings s WHERE a.target_type='site' AND s.id=true
) object ON true`;

function id(req:FastifyRequest){return uuid.parse((req.params as any).id);}
// Zod 4 applies inner defaults even inside .partial(). A PATCH must keep
// omitted fields untouched, while still validating and rejecting unknown keys.
function patchBody<T extends Record<string,unknown>>(schema:z.ZodType<T>,raw:unknown):T{const parsed=schema.parse(raw);for(const key of Object.keys(parsed))if(!Object.prototype.hasOwnProperty.call(raw,key))delete parsed[key];return parsed;}
function checkRevision(row:any,wanted:number){if(!row)fail('NOT_FOUND',404);if(Number(row.revision)!==wanted)fail('CONFLICT',409);}
function dates(start:string|null,end:string|null){if(start&&end&&Date.parse(end)<=Date.parse(start))fail('INVALID_DATA',400);}
function conditions(req:FastifyRequest,qFields:string[],mapping:Record<string,string>={}){
 const f=filters.parse(req.query),params:unknown[]=[],where:string[]=[];
 const add=(expression:string,value:unknown)=>{params.push(value);where.push(expression.replace('?',`$${params.length}`));};
 if(f.q&&qFields.length){params.push(`%${f.q}%`);where.push(`(${qFields.map(column=>`${column} ILIKE $${params.length}`).join(' OR ')})`);}
 for(const key of ['course_id','group_id','user_id','role','status'] as const)if(f[key]!==undefined&&mapping[key])add(`${mapping[key]}=?`,f[key]);
 return {params,where};
}
async function log(db:PoolClient,ctx:Context,action:string,type:string,target:string|null,before:unknown=null,after:unknown=null,subject:string|null=null){
 await db.query('INSERT INTO private.audit_log(actor_id,subject_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[ctx.user_id,subject,action,type,target,JSON.stringify({before,after})]);
}
async function one(db:PoolClient|typeof pool,from:string,select:string,where:string,params:unknown[]){return (await db.query(`SELECT ${select} FROM ${from} WHERE ${where}`,params)).rows[0];}
async function scopedRevoke(db:PoolClient,user:string,course:string){await db.query('UPDATE private.playback_grants SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND lesson_id IN (SELECT id FROM private.lessons WHERE course_id=$2)',[user,course]);}
async function validateGroup(db:PoolClient,group:string|null,course:string,requireActive=false){
 if(!group)return;
 const row=(await db.query('SELECT id,course_id,active FROM private.groups WHERE id=$1 FOR UPDATE',[group])).rows[0];
 if(!row||row.course_id!==course||(requireActive&&!row.active))fail('INVALID_DATA',400);
}
async function validateEnrollment(db:PoolClient,row:any){
 dates(row.starts_at,row.expires_at);
 const student=(await db.query('SELECT id,role,active FROM private.app_users WHERE id=$1 FOR UPDATE',[row.user_id])).rows[0];
 if(!student||student.role!=='STUDENT'||(!student.active&&row.status==='active'))fail('INVALID_DATA',400);
 const course=(await db.query('SELECT active FROM private.courses WHERE id=$1',[row.course_id])).rows[0];
 if(!course||(!course.active&&row.status==='active'))fail('INVALID_DATA',400);
 await validateGroup(db,row.group_id,row.course_id,row.status==='active');
}
async function updateEnrollment(db:PoolClient,ctx:Context,enrollment:any,data:any){
 const merged={...enrollment,...data};await validateEnrollment(db,merged);
 const next=(await db.query(`UPDATE private.enrollments SET group_id=$2,status=$3,starts_at=$4,expires_at=$5,payment_status=$6,revoked_at=CASE WHEN $3='revoked' THEN COALESCE(revoked_at,now()) ELSE NULL END,revoked_by=CASE WHEN $3='revoked' THEN $7::uuid ELSE NULL END,revocation_reason=CASE WHEN $3='revoked' THEN $8 ELSE '' END,updated_at=now() WHERE id=$1 RETURNING *`,[enrollment.id,merged.group_id,merged.status,merged.starts_at,merged.expires_at,merged.payment_status,ctx.user_id,merged.revocation_reason||''])).rows[0];
 await scopedRevoke(db,enrollment.user_id,enrollment.course_id);
 const safe=(e:any)=>({group_id:e.group_id,status:e.status,starts_at:e.starts_at,expires_at:e.expires_at,payment_status:e.payment_status,revocation_reason:e.revocation_reason||''});
 await log(db,ctx,'enrollment.changed','enrollment',enrollment.id,safe(enrollment),safe(next),enrollment.user_id);
 return one(db,enrollmentFrom,ctx.user.role==='TEACHER'?teacherEnrollmentSelect:enrollmentSelect,'e.id=$1',[enrollment.id]);
}

async function enrollmentGroup(db:PoolClient|typeof pool,groupId:string,lock=false){
 const group=(await db.query(`SELECT ${groupSelect},c.active AS course_active,(g.ends_at IS NULL OR g.ends_at>now()) AS not_ended FROM private.groups g JOIN private.courses c ON c.id=g.course_id WHERE g.id=$1${lock?' FOR UPDATE OF g':''}`,[groupId])).rows[0];
 if(!group)fail('NOT_FOUND',404);
 return group;
}
function canAddGroupStudents(group:any){return Boolean(group.active&&group.course_active&&group.not_ended);}
function groupStudent(row:any,groupId:string,groupOpen:boolean){
 const eligibility=!row.active?'inactive':row.auth_pending?'access_review':!row.enrollment_id?'new':row.group_id===groupId?'member':row.group_id?'other_group':row.enrollment_current&&['active','pending'].includes(row.status)?'ungrouped':'access_review';
 return {
  id:row.id,user_id:row.id,name:row.name,phone:row.phone,active:row.active,
  enrollment_id:row.enrollment_id,enrollment_revision:row.enrollment_revision===null?null:Number(row.enrollment_revision),
  group_id:row.group_id,group_title:row.group_title,status:row.status,effective_status:row.effective_status,
  starts_at:row.starts_at,expires_at:row.expires_at,eligibility,
  selectable:groupOpen&&(eligibility==='new'||eligibility==='ungrouped'),
 };
}

export async function registerAcademicRoutes(app:FastifyInstance){
 app.get('/api/admin/courses',async req=>{await readAccess(req);const f=conditions(req,['c.title','c.slug']);return pageList(req,pool,'private.courses c',courseSelect,f.where.join(' AND '),f.params,'c.created_at DESC,c.id');});
 app.post('/api/admin/courses',async req=>{
  const data=courses.extend(operationSchema.shape).strict().parse(req.body);
  return managementMutation(req,'course.created',data,async(db,ctx)=>{
   const row=(await db.query(`INSERT INTO private.courses(slug,title,description,published,active,weeks,lessons_per_week,lesson_minutes,price_kzt,default_group_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[data.slug,data.title,data.description,data.published,data.active,data.weeks,data.lessons_per_week,data.lesson_minutes,data.price_kzt,data.default_group_size])).rows[0];
   await log(db,ctx,'course.created','course',row.id,null,{title:row.title,slug:row.slug});return row;
  });
 });
 app.patch('/api/admin/courses/:id',async req=>{
  const courseId=id(req),data=patchBody(courses.partial().extend({...operationSchema.shape,revision}).strict(),req.body);
  return managementMutation(req,`course.changed.${courseId}`,data,async(db,ctx)=>{
   const previous=(await db.query('SELECT * FROM private.courses WHERE id=$1 FOR UPDATE',[courseId])).rows[0];checkRevision(previous,data.revision);const next={...previous,...data};
   const row=(await db.query(`UPDATE private.courses SET slug=$2,title=$3,description=$4,published=$5,active=$6,weeks=$7,lessons_per_week=$8,lesson_minutes=$9,price_kzt=$10,default_group_size=$11,updated_at=now() WHERE id=$1 RETURNING *`,[courseId,next.slug,next.title,next.description,next.published,next.active,next.weeks,next.lessons_per_week,next.lesson_minutes,next.price_kzt,next.default_group_size])).rows[0];
   if(!row.active||!row.published)await db.query('UPDATE private.playback_grants SET revoked_at=now() WHERE revoked_at IS NULL AND lesson_id IN (SELECT id FROM private.lessons WHERE course_id=$1)',[courseId]);
   await log(db,ctx,'course.changed','course',courseId,{title:previous.title,active:previous.active,published:previous.published},{title:row.title,active:row.active,published:row.published});return row;
  });
 });

 app.get('/api/admin/groups',async req=>{await readAccess(req);const f=conditions(req,['g.title','c.title'],{course_id:'g.course_id'});return pageList(req,pool,'private.groups g JOIN private.courses c ON c.id=g.course_id',groupSelect,f.where.join(' AND '),f.params,'g.created_at DESC,g.id');});
 app.post('/api/admin/groups',async req=>{
  const data=groups.extend(operationSchema.shape).strict().parse(req.body);dates(data.starts_at,data.ends_at);
  return managementMutation(req,'group.created',data,async(db,ctx)=>{
   const row=(await db.query('INSERT INTO private.groups(course_id,title,capacity,active,starts_at,ends_at,schedule_description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[data.course_id,data.title,data.capacity,data.active,data.starts_at,data.ends_at,data.schedule_description])).rows[0];await log(db,ctx,'group.created','group',row.id,null,{course_id:row.course_id,title:row.title,capacity:row.capacity});return row;
  });
 });
 app.patch('/api/admin/groups/:id',async req=>{
  const groupId=id(req),data=patchBody(groups.partial().extend({...operationSchema.shape,revision}).strict(),req.body);
  return managementMutation(req,`group.changed.${groupId}`,data,async(db,ctx)=>{
   const previous=(await db.query('SELECT * FROM private.groups WHERE id=$1 FOR UPDATE',[groupId])).rows[0];checkRevision(previous,data.revision);if(data.course_id&&data.course_id!==previous.course_id)fail('INVALID_DATA',400);const next={...previous,...data};dates(next.starts_at,next.ends_at);
   const row=(await db.query('UPDATE private.groups SET title=$2,capacity=$3,active=$4,starts_at=$5,ends_at=$6,schedule_description=$7,updated_at=now() WHERE id=$1 RETURNING *',[groupId,next.title,next.capacity,next.active,next.starts_at,next.ends_at,next.schedule_description])).rows[0];
   if(!row.active)await db.query(`UPDATE private.playback_grants p SET revoked_at=now() WHERE p.revoked_at IS NULL AND (p.lesson_id IN (SELECT id FROM private.lessons WHERE group_id=$1) OR (p.lesson_id IN (SELECT id FROM private.lessons WHERE course_id=$2) AND p.user_id IN (SELECT user_id FROM private.enrollments WHERE group_id=$1)))`,[groupId,row.course_id]);
   await log(db,ctx,'group.changed','group',groupId,{title:previous.title,capacity:previous.capacity,active:previous.active},{title:row.title,capacity:row.capacity,active:row.active});return row;
  });
 });

 // Bulk selection is ADMIN-only. A student need not have logged in or registered
 // a browser yet; learning access still requires the existing browser/session proof.
 app.get('/api/admin/groups/:id/students',async req=>{
  await readAccess(req);const groupId=id(req),group=await enrollmentGroup(pool,groupId);
  const f=conditions(req,['u.name','u.phone']);f.params.unshift(group.course_id);
  // conditions() starts its search parameter at $1; the course occupies it here.
  const search=f.where.map(condition=>condition.replace(/\$(\d+)/g,(_match,n)=>`$${Number(n)+1}`));
  const from=`private.app_users u JOIN private.courses c ON c.id=$1 LEFT JOIN private.enrollments e ON e.user_id=u.id AND e.course_id=c.id LEFT JOIN private.groups g ON g.id=e.group_id`;
  const select=`u.id,u.name,u.phone,u.active,(u.auth_operation_id IS NOT NULL) AS auth_pending,e.id AS enrollment_id,e.revision AS enrollment_revision,e.group_id,g.title AS group_title,e.status,e.starts_at,e.expires_at,(e.expires_at>now()) AS enrollment_current,CASE WHEN e.id IS NULL THEN NULL ELSE ${effective} END AS effective_status`;
  const result=await pageList(req,pool,from,select,["u.role='STUDENT'",...search].join(' AND '),f.params,'u.name,u.id');
  const {course_active,not_ended,...safeGroup}=group;
  return {...result,group:{...safeGroup,can_add_students:canAddGroupStudents(group)},items:result.items.map((row:any)=>groupStudent(row,groupId,canAddGroupStudents(group)))};
 });
 app.post('/api/admin/groups/:id/students',async req=>{
  const groupId=id(req),data=groupStudents.parse(req.body);
  const result=await managementMutation(req,`group.students.added.${groupId}`,data,async(db,ctx)=>{
   const group=await enrollmentGroup(db,groupId,true);
   if(!canAddGroupStudents(group))fail('CONFLICT',409);
   const candidates:{user_id:string;enrollment:any|null}[]=[];
   // Validate the whole selection before applying any change. The existing
   // management lock and capacity triggers also protect concurrent admissions.
   for(const wanted of [...data.students].sort((a,b)=>a.user_id.localeCompare(b.user_id))){
    const student=(await db.query('SELECT id,role,active,auth_operation_id FROM private.app_users WHERE id=$1 FOR UPDATE',[wanted.user_id])).rows[0];
    if(!student||student.role!=='STUDENT'||!student.active||student.auth_operation_id)fail('INVALID_DATA',400);
    const enrollment=(await db.query('SELECT *,expires_at>now() AS enrollment_current FROM private.enrollments WHERE user_id=$1 AND course_id=$2 FOR UPDATE',[wanted.user_id,group.course_id])).rows[0];
    if(enrollment){
     if(wanted.enrollment_revision===null||Number(enrollment.revision)!==wanted.enrollment_revision)fail('CONFLICT',409);
     if(enrollment.group_id||!enrollment.enrollment_current||!['active','pending'].includes(enrollment.status))fail('CONFLICT',409);
     await validateEnrollment(db,{...enrollment,group_id:groupId});
    }else{
     if(wanted.enrollment_revision!==null)fail('CONFLICT',409);
     dates(data.starts_at,data.expires_at);
     if(Date.parse(data.expires_at)<=Date.now())fail('INVALID_DATA',400);
     await validateEnrollment(db,{user_id:wanted.user_id,course_id:group.course_id,group_id:groupId,status:data.status,starts_at:data.starts_at,expires_at:data.expires_at});
    }
    candidates.push({user_id:wanted.user_id,enrollment:enrollment??null});
   }
   if(Number(group.reserved_seats)+candidates.length>Number(group.capacity))fail('GROUP_FULL',409);
   for(const candidate of candidates){
    if(candidate.enrollment){
     // Attaching existing course-wide access never extends or reactivates it,
     // changes payment state, creates an account, or resets browser approval.
     await updateEnrollment(db,ctx,candidate.enrollment,{group_id:groupId});
    }else{
     const row=(await db.query(`INSERT INTO private.enrollments(user_id,course_id,group_id,status,starts_at,expires_at,payment_status,created_by) VALUES($1,$2,$3,$4,$5,$6,'unpaid',$7) RETURNING id`,[candidate.user_id,group.course_id,groupId,data.status,data.starts_at,data.expires_at,ctx.user_id])).rows[0];
     await log(db,ctx,'enrollment.created','enrollment',row.id,null,{course_id:group.course_id,group_id:groupId,status:data.status,starts_at:data.starts_at,expires_at:data.expires_at},candidate.user_id);
    }
   }
   return {ok:true,group_id:groupId,course_id:group.course_id,completed:true};
  });
  // Existing receipt constraints accept only boolean acknowledgements. Counts
  // follow from the exact hashed request after all students passed validation,
  // so a retry has the same response without adding receipt schema or user data.
  return {...result,created:data.students.filter(student=>student.enrollment_revision===null).length,completed:data.students.length};
 });

 app.get('/api/admin/teacher-assignments',async req=>{await readAccess(req);const f=conditions(req,['u.name','c.title','g.title'],{course_id:'t.course_id',group_id:'t.group_id',user_id:'t.teacher_id'});return pageList(req,pool,assignmentFrom,assignmentSelect,f.where.join(' AND '),f.params,'t.created_at DESC,t.id');});
 app.post('/api/admin/teacher-assignments',async req=>{
  const data=assignments.extend(operationSchema.shape).strict().parse(req.body);
  return managementMutation(req,'teacher.assigned',data,async(db,ctx)=>{
   if(!data.group_id&&data.can_manage_access)fail('INVALID_DATA',400);
   const teacher=(await db.query("SELECT id FROM private.app_users WHERE id=$1 AND role='TEACHER' AND active FOR UPDATE",[data.teacher_id])).rows[0];if(!teacher)fail('INVALID_DATA',400);await validateGroup(db,data.group_id,data.course_id);
   const row=(await db.query('INSERT INTO private.teacher_assignments(teacher_id,course_id,group_id,can_manage_access,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[data.teacher_id,data.course_id,data.group_id,data.can_manage_access,ctx.user_id])).rows[0];await log(db,ctx,'teacher.assigned','assignment',row.id,null,{teacher_id:row.teacher_id,course_id:row.course_id,group_id:row.group_id,can_manage_access:row.can_manage_access},row.teacher_id);return row;
  });
 });
 app.patch('/api/admin/teacher-assignments/:id',async req=>{
  const assignmentId=id(req),data=patchBody(assignments.partial().extend({...operationSchema.shape,revision}).strict(),req.body);
  return managementMutation(req,`teacher.assignment.changed.${assignmentId}`,data,async(db,ctx)=>{
   const previous=(await db.query('SELECT * FROM private.teacher_assignments WHERE id=$1 FOR UPDATE',[assignmentId])).rows[0];checkRevision(previous,data.revision);
   for(const field of ['teacher_id','course_id','group_id'] as const)if(data[field]!==undefined&&data[field]!==previous[field])fail('INVALID_DATA',400);
   const manage=data.can_manage_access??previous.can_manage_access;if(!previous.group_id&&manage)fail('INVALID_DATA',400);
   const row=(await db.query('UPDATE private.teacher_assignments SET can_manage_access=$2 WHERE id=$1 RETURNING *',[assignmentId,manage])).rows[0];await log(db,ctx,'teacher.assignment.changed','assignment',assignmentId,{can_manage_access:previous.can_manage_access},{can_manage_access:manage},row.teacher_id);return row;
  });
 });
 app.post('/api/admin/teacher-assignments/:id/remove',async req=>{
  const assignmentId=id(req),data=operationSchema.extend({revision}).strict().parse(req.body);
  return managementMutation(req,`teacher.assignment.removed.${assignmentId}`,data,async(db,ctx)=>{
   const previous=(await db.query('SELECT * FROM private.teacher_assignments WHERE id=$1 FOR UPDATE',[assignmentId])).rows[0];checkRevision(previous,data.revision);
   await db.query('DELETE FROM private.teacher_assignments WHERE id=$1',[assignmentId]);await scopedRevoke(db,previous.teacher_id,previous.course_id);await log(db,ctx,'teacher.assignment.removed','assignment',assignmentId,{teacher_id:previous.teacher_id,course_id:previous.course_id,group_id:previous.group_id},null,previous.teacher_id);return {id:assignmentId,ok:true};
  });
 });

 app.get('/api/admin/enrollments',async req=>{await readAccess(req);const f=conditions(req,['u.name','u.phone','c.title','g.title'],{course_id:'e.course_id',group_id:'e.group_id',user_id:'e.user_id',status:'e.status'});return pageList(req,pool,enrollmentFrom,enrollmentSelect,f.where.join(' AND '),f.params,'e.created_at DESC,e.id');});
 app.post('/api/admin/enrollments',async req=>{
  const data=enrollments.extend(operationSchema.shape).strict().parse(req.body);
  return managementMutation(req,'enrollment.created',data,async(db,ctx)=>{
   await validateEnrollment(db,data);
   const row=(await db.query(`INSERT INTO private.enrollments(user_id,course_id,group_id,status,starts_at,expires_at,payment_status,created_by,revoked_at,revoked_by,revocation_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $4='revoked' THEN now() ELSE NULL END,CASE WHEN $4='revoked' THEN $8::uuid ELSE NULL END,CASE WHEN $4='revoked' THEN $9 ELSE '' END) RETURNING *`,[data.user_id,data.course_id,data.group_id,data.status,data.starts_at,data.expires_at,data.payment_status,ctx.user_id,data.revocation_reason])).rows[0];await log(db,ctx,'enrollment.created','enrollment',row.id,null,{course_id:row.course_id,group_id:row.group_id,status:row.status,starts_at:row.starts_at,expires_at:row.expires_at},row.user_id);return one(db,enrollmentFrom,enrollmentSelect,'e.id=$1',[row.id]);
  });
 });
 app.patch('/api/admin/enrollments/:id',async req=>{
  const enrollmentId=id(req),data=patchBody(enrollments.partial().extend({...operationSchema.shape,revision}).strict(),req.body);
  return managementMutation(req,`enrollment.changed.${enrollmentId}`,data,async(db,ctx)=>{
   const previous=(await db.query('SELECT * FROM private.enrollments WHERE id=$1 FOR UPDATE',[enrollmentId])).rows[0];checkRevision(previous,data.revision);
   if((data.user_id&&data.user_id!==previous.user_id)||(data.course_id&&data.course_id!==previous.course_id))fail('INVALID_DATA',400);
   return updateEnrollment(db,ctx,previous,data);
  });
 });

 app.get('/api/admin/payments',async req=>{await readAccess(req);const f=conditions(req,['u.name','u.phone','c.title','p.note'],{course_id:'e.course_id',group_id:'e.group_id',user_id:'e.user_id',status:"COALESCE(pc.state,'posted')"});return pageList(req,pool,paymentFrom,paymentSelect,f.where.join(' AND '),f.params,'p.created_at DESC,p.id');});
 app.get('/api/admin/payments/:id/history',async req=>{
  await readAccess(req);const paymentId=id(req);
  if(!await one(pool,'private.payments','id','id=$1',[paymentId]))fail('NOT_FOUND',404);
  const from=`(SELECT p.id,p.id AS payment_id,0::integer AS revision,p.amount_kzt,p.paid_at,p.method,p.note,'posted'::text AS state,''::text AS reason,p.recorded_by,p.created_at FROM private.payments p WHERE p.id=$1 UNION ALL SELECT pc.id,pc.payment_id,pc.revision,pc.amount_kzt,pc.paid_at,pc.method,pc.note,pc.state,pc.reason,pc.recorded_by,pc.created_at FROM private.payment_corrections pc WHERE pc.payment_id=$1) history JOIN private.app_users recorder ON recorder.id=history.recorded_by`;
  const result=await pageList(req,pool,from,'history.id,history.payment_id,history.revision,history.amount_kzt,history.paid_at,history.method,history.note,history.state,history.reason,history.recorded_by,recorder.name AS recorded_by_name,history.created_at','',[paymentId],'history.revision DESC');
  return {...result,payment_id:paymentId};
 });
 app.post('/api/admin/payments',async req=>{
  const data=payments.extend(operationSchema.shape).strict().parse(req.body);
  return managementMutation(req,'payment.recorded',data,async(db,ctx)=>{
   const row=(await db.query('INSERT INTO private.payments(enrollment_id,amount_kzt,paid_at,method,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[data.enrollment_id,data.amount_kzt,data.paid_at,data.method,data.note,ctx.user_id])).rows[0];const enrollment=await one(db,'private.enrollments','user_id','id=$1',[row.enrollment_id]);await log(db,ctx,'payment.recorded','payment',row.id,null,{enrollment_id:row.enrollment_id,amount_kzt:row.amount_kzt,paid_at:row.paid_at,method:row.method},enrollment.user_id);return one(db,paymentFrom,paymentSelect,'p.id=$1',[row.id]);
  });
 });
 app.patch('/api/admin/payments/:id',async req=>{
  const paymentId=id(req),data=patchBody(payments.partial().extend({...operationSchema.shape,revision,state:z.enum(['posted','voided']).optional(),reason:z.string().trim().min(1).max(1000)}).strict(),req.body);
  return managementMutation(req,`payment.corrected.${paymentId}`,data,async(db,ctx)=>{
   const base=(await db.query('SELECT id FROM private.payments WHERE id=$1 FOR UPDATE',[paymentId])).rows[0];if(!base)fail('NOT_FOUND',404);
   const previous=await one(db,paymentFrom,paymentSelect,'p.id=$1',[paymentId]);checkRevision(previous,data.revision);if(data.enrollment_id&&data.enrollment_id!==previous.enrollment_id)fail('INVALID_DATA',400);const next={...previous,...data};
   await db.query('INSERT INTO private.payment_corrections(payment_id,revision,amount_kzt,paid_at,method,note,state,reason,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[paymentId,Number(previous.revision)+1,next.amount_kzt,next.paid_at,next.method,next.note,next.state,next.reason,ctx.user_id]);await log(db,ctx,'payment.corrected','payment',paymentId,{amount_kzt:previous.amount_kzt,state:previous.state,revision:previous.revision},{amount_kzt:next.amount_kzt,state:next.state,reason:next.reason,revision:Number(previous.revision)+1},previous.user_id);return one(db,paymentFrom,paymentSelect,'p.id=$1',[paymentId]);
  });
 });

 app.get('/api/admin/settings',async req=>{await readAccess(req);return {settings:(await pool.query('SELECT title,contacts,teachers_public,faq,revision,updated_at FROM private.site_settings WHERE id=true')).rows[0]};});
 const contacts=z.object({whatsapp:z.string().max(30).default(''),instagram:z.string().max(250).default(''),contact_email:z.string().max(254).optional(),email:z.string().max(254).optional()}).strict();
 const settings=z.object({operation_id:uuid,revision,title:text,contacts,teachers_public:z.array(z.object({name:text,subject:z.string().max(160),bio:z.string().max(2000)}).strict()).max(100),faq:z.array(z.object({question:text,answer:z.string().min(1).max(3000)}).strict()).max(100)}).strict();
 app.patch('/api/admin/settings',async req=>{
  const data=settings.parse(req.body),email=data.contacts.contact_email??data.contacts.email??'';
  if(email&&!z.email().safeParse(email).success)fail('INVALID_DATA',400);
  let instagram=data.contacts.instagram.trim();if(instagram&&!/^https:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]+\/?$/.test(instagram)){const handle=instagram.replace(/^@/,'');if(!/^[a-zA-Z0-9_.]{1,30}$/.test(handle))fail('INVALID_DATA',400);instagram=`https://www.instagram.com/${handle}/`;}
  const normalized={whatsapp:data.contacts.whatsapp?normalizePhone(data.contacts.whatsapp):'',instagram,contact_email:email};
  return managementMutation(req,'site.settings.changed',data,async(db,ctx)=>{
   const previous=(await db.query('SELECT revision FROM private.site_settings WHERE id=true FOR UPDATE')).rows[0];checkRevision(previous,data.revision);
   const row=(await db.query('UPDATE private.site_settings SET title=$1,contacts=$2,teachers_public=$3,faq=$4,updated_by=$5,updated_at=now() WHERE id=true RETURNING title,contacts,teachers_public,faq,revision,updated_at',[data.title,JSON.stringify(normalized),JSON.stringify(data.teachers_public),JSON.stringify(data.faq),ctx.user_id])).rows[0];await log(db,ctx,'site.settings.changed','site',null,{revision:previous.revision},{revision:row.revision});return {revision:row.revision,settings:row};
  });
 });

 app.get('/api/admin/devices',async req=>{
  await readAccess(req);const f=conditions(req,['u.name','u.phone','d.label'],{user_id:'d.user_id',status:'d.status',role:'u.role'});
  const result=await pageList(req,pool,'private.device_bindings d JOIN private.app_users u ON u.id=d.user_id','d.id,d.user_id,d.label,d.status,d.requested_at,d.requested_at AS created_at,d.approved_at,d.revoked_at,d.public_key,u.name AS user_name,u.phone AS user_phone,u.role,EXISTS(SELECT 1 FROM private.device_bindings old WHERE old.user_id=d.user_id AND old.id<>d.id AND old.status=\'approved\') AS replacement',f.where.join(' AND '),f.params,'d.requested_at DESC,d.id');
  return {...result,items:result.items.map(({public_key,...row}:any)=>({...row,key_fingerprint:hash(JSON.stringify(public_key)).slice(0,24)}))};
 });
 app.get('/api/admin/audit',async req=>{
  await readAccess(req);const f=conditions(req,['a.action','actor.name','subject.name','object.label'],{user_id:'a.subject_id'});
  return pageList(req,pool,auditFrom,'a.id,a.actor_id,a.subject_id,a.action,a.target_type,a.target_id,a.metadata,a.created_at,actor.name AS actor_name,subject.name AS subject_name,COALESCE(object.label,subject.name) AS object_label',f.where.join(' AND '),f.params,'a.created_at DESC,a.id DESC');
 });
 app.get('/api/admin/options',async req=>{
  await readAccess(req);const entity=z.enum(['users','courses','groups','enrollments']).parse((req.query as any).entity);const f=conditions(req,entity==='users'?['u.name','u.phone']:entity==='courses'?['c.title']:entity==='groups'?['g.title','c.title']:['u.name','u.phone','c.title','g.title'],entity==='users'?{role:'u.role'}:entity==='courses'?{}:entity==='groups'?{course_id:'g.course_id'}:{course_id:'e.course_id',group_id:'e.group_id',user_id:'e.user_id'});
  const defs={users:['private.app_users u',"u.id,u.name||' · '||u.phone AS label,u.name,u.phone,u.role,u.active",'u.name,u.id'],courses:['private.courses c','c.id,c.title AS label,c.title,c.active','c.title,c.id'],groups:['private.groups g JOIN private.courses c ON c.id=g.course_id',"g.id,c.title||' · '||g.title AS label,g.title,g.course_id,g.active",'g.title,g.id'],enrollments:[enrollmentFrom,"e.id,u.name||' · '||c.title||COALESCE(' · '||g.title,'') AS label,e.user_id,e.course_id,e.group_id,e.status",'u.name,e.id']} as const;
  const [from,select,order]=defs[entity];return {items:(await pool.query(`SELECT ${select} FROM ${from} ${f.where.length?'WHERE '+f.where.join(' AND '):''} ORDER BY ${order} LIMIT 50`,f.params)).rows};
 });

 app.get('/api/teacher/groups',async req=>{
  const ctx=await readAccess(req,['TEACHER']),f=conditions(req,['c.title','g.title'],{course_id:'t.course_id',group_id:'t.group_id'});f.params.push(ctx.user_id);f.where.push(`t.teacher_id=$${f.params.length}`);
  return pageList(req,pool,'private.teacher_assignments t JOIN private.courses c ON c.id=t.course_id LEFT JOIN private.groups g ON g.id=t.group_id',`t.id AS assignment_id,COALESCE(g.id,t.id) AS id,t.course_id,t.group_id,c.title AS course_title,g.title,g.title AS group_title,g.capacity,g.active,g.starts_at,g.ends_at,g.schedule_description,t.can_manage_access,(t.group_id IS NOT NULL) AS has_roster,CASE WHEN t.group_id IS NULL THEN 0 ELSE (SELECT count(*)::integer FROM private.enrollments e WHERE e.group_id=t.group_id) END AS student_count`,f.where.join(' AND '),f.params,'c.title,g.title,t.id');
 });
 app.get('/api/teacher/groups/:id/students',async req=>{
  const groupId=id(req),ctx=await readAccess(req,['TEACHER']);
  const assignment=await one(pool,'private.teacher_assignments t','t.can_manage_access','t.teacher_id=$1 AND t.group_id=$2',[ctx.user_id,groupId]);if(!assignment)fail('NOT_FOUND',404);
  const f=conditions(req,['u.name','u.phone'],{status:'e.status'});f.params.push(groupId,ctx.user_id);f.where.push(`e.group_id=$${f.params.length-1}`,`EXISTS(SELECT 1 FROM private.teacher_assignments ta WHERE ta.teacher_id=$${f.params.length} AND ta.group_id=e.group_id AND ta.course_id=e.course_id)`);
  const result=await pageList(req,pool,enrollmentFrom,teacherEnrollmentSelect,f.where.join(' AND '),f.params,'u.name,e.id');return {...result,can_manage_access:assignment.can_manage_access};
 });
 app.patch('/api/teacher/enrollments/:id',async req=>{
  const enrollmentId=id(req),data=studentChanges.parse(req.body);
  return managementMutation(req,`teacher.enrollment.changed.${enrollmentId}`,data,async(db,ctx)=>{
   const previous=(await db.query('SELECT * FROM private.enrollments WHERE id=$1 FOR UPDATE',[enrollmentId])).rows[0];if(!previous||!previous.group_id)fail('NOT_FOUND',404);
   const assignment=(await db.query('SELECT id FROM private.teacher_assignments WHERE teacher_id=$1 AND group_id=$2 AND course_id=$3 AND can_manage_access FOR UPDATE',[ctx.user_id,previous.group_id,previous.course_id])).rows[0];if(!assignment)fail('FORBIDDEN');checkRevision(previous,data.revision);return updateEnrollment(db,ctx,previous,data);
  },['TEACHER'],async(db,ctx)=>{
   // Replays still require current scope; an old success receipt cannot stand
   // in for access-management permission removed by the owner afterwards.
   const enrollment=(await db.query('SELECT group_id,course_id FROM private.enrollments WHERE id=$1 FOR UPDATE',[enrollmentId])).rows[0];if(!enrollment?.group_id)fail('NOT_FOUND',404);
   const assigned=(await db.query('SELECT id FROM private.teacher_assignments WHERE teacher_id=$1 AND group_id=$2 AND course_id=$3 AND can_manage_access FOR UPDATE',[ctx.user_id,enrollment.group_id,enrollment.course_id])).rows[0];if(!assigned)fail('FORBIDDEN');
  });
 });
}
