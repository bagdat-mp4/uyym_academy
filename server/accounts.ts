import type {FastifyInstance,FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction,audit} from './db.js';
import {normalizePhone,hash,opaque} from './security.js';
import {createAuthUser,getAuthUser,setPassword,AuthAdminError} from './supabase.js';
import {readAccess,freshManagement,managementMutation,pageList,pageParams,uuid,fail} from './management.js';
import type {Context} from './auth.js';

const userFields='u.id,u.name,u.phone,u.role,u.active,u.must_change_password,u.auth_operation_id,u.created_at,u.updated_at';
const createSchema=z.object({operation_id:uuid,name:z.string().trim().min(1).max(120),phone:z.string().min(5).max(30),role:z.enum(['STUDENT','TEACHER']),identity_verified:z.literal(true)}).strict();
const resetSchema=z.object({operation_id:uuid,identity_verified:z.literal(true)}).strict();
const applicationSchema=z.object({name:z.string().trim().min(1).max(120),phone:z.string().min(5).max(30),course_id:uuid}).strict();
const approvalSchema=z.object({operation_id:uuid,identity_verified:z.literal(true)}).strict();
export async function invalidateUser(db:any,userId:string){
 await db.query('UPDATE private.app_users SET auth_epoch=auth_epoch+1,updated_at=now() WHERE id=$1',[userId]);
 await db.query('UPDATE private.playback_grants SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',[userId]);
 await db.query('UPDATE private.login_tickets SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',[userId]);
 await db.query('UPDATE private.app_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',[userId]);
 await db.query('UPDATE private.challenges SET consumed_at=coalesce(consumed_at,now()) WHERE user_id=$1',[userId]);
}
async function safeUser(id:string){return (await pool.query(`SELECT ${userFields} FROM private.app_users u WHERE u.id=$1`,[id])).rows[0];}
async function operationResponse(op:any,password?:string){return {operation_id:op.id,status:op.state,user:op.target_user_id?await safeUser(op.target_user_id):undefined,...(password?{temporary_password:password}:{})};}
async function operationError(op:any,e:unknown){
 const code=e instanceof AuthAdminError?e.code:'DATABASE_FINALIZATION';
 // Even definitive rejection is retained; no compensation deletes an unrelated Auth account.
 return transaction(async db=>{
  await db.query('SELECT private.management_lock()');
  const current=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 FOR UPDATE',[op.id])).rows[0];
  // A delayed HTTP completion/error from an old attempt must not resurrect its
  // partial unique-index reservation or alter a newer reset's admission gate.
  if(current.state==='completed'||current.last_error_code==='OPERATION_SUPERSEDED'||Number(current.attempts)>Number(op.attempts))return current;
  return (await db.query("UPDATE private.auth_operations SET state=$2,last_error_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1 RETURNING *",[op.id,e instanceof AuthAdminError&&!e.uncertain?'failed':'reconcile_required',code])).rows[0];
 });
}
async function confirm(req:FastifyRequest,ctx:Context,op:any){
 return transaction(async db=>{
  await freshManagement(db,req,ctx);
  const current=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 FOR UPDATE',[op.id])).rows[0];
  if(current.state==='completed'||current.last_error_code==='OPERATION_SUPERSEDED')return current;
  if(current.action==='reset_password'){
   const target=(await db.query('SELECT auth_operation_id FROM private.app_users WHERE id=$1 FOR UPDATE',[current.target_user_id])).rows[0];
   if(target?.auth_operation_id!==current.id)fail('CONFLICT',409);
  }
  return (await db.query("UPDATE private.auth_operations SET state='auth_confirmed',updated_at=now(),lease_until=NULL WHERE id=$1 RETURNING *",[op.id])).rows[0];
 });
}
async function finish(req:FastifyRequest,ctx:Context,op:any){
 return transaction(async db=>{
  await freshManagement(db,req,ctx);
  const current=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 FOR UPDATE',[op.id])).rows[0];
  if(current.state==='completed')return current;
  if(current.last_error_code==='OPERATION_SUPERSEDED')return current;
  if(current.state!=='auth_confirmed')fail('AUTH_PENDING',409);
  if(current.action==='create_user'){
   await db.query('INSERT INTO private.app_users(id,phone,name,role) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[current.auth_user_id,current.phone,current.name,current.requested_role]);
   const target=(await db.query('SELECT id,phone,role FROM private.app_users WHERE id=$1',[current.auth_user_id])).rows[0];
   if(!target||target.phone!==current.phone||target.role!==current.requested_role)fail('CONFLICT',409);
   current.target_user_id=target.id;
   await audit(db,ctx.user_id,'user.created','user',target.id,{role:current.requested_role,operation_id:op.id});
  }else{
   const target=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[current.target_user_id])).rows[0];
   if(target?.auth_operation_id!==op.id)fail('CONFLICT',409);
   await db.query('UPDATE private.app_users SET auth_operation_id=NULL,must_change_password=true,updated_at=now() WHERE id=$1',[target.id]);
   await audit(db,ctx.user_id,'password.reset.completed','user',target.id,{operation_id:op.id});
  }
  return (await db.query("UPDATE private.auth_operations SET state='completed',target_user_id=$2,completed_at=now(),updated_at=now(),lease_until=NULL,last_error_code=NULL WHERE id=$1 RETURNING *",[op.id,current.target_user_id])).rows[0];
 });
}
// Reconciliation reads the preallocated Auth ID and operation marker. It never
// adopts an arbitrary phone match or replays a secret-changing remote request.
async function reconcile(req:FastifyRequest,ctx:Context,op:any){
 op=(await pool.query('SELECT * FROM private.auth_operations WHERE id=$1',[op.id])).rows[0];
 if(op.state==='completed'||op.last_error_code==='OPERATION_SUPERSEDED')return operationResponse(op);
 if(op.lease_until&&new Date(op.lease_until).getTime()>Date.now())return operationResponse(op);
 try{
  const u=await getAuthUser(op.auth_user_id);
  const marker=op.action==='create_user'?u.app_metadata?.uyym_operation:u.app_metadata?.uyym_password_operation;
  if(u.id!==op.auth_user_id||marker!==op.id||(op.action==='create_user'&&normalizePhone(u.phone)!==op.phone))return operationResponse(op);
  const confirmed=await confirm(req,ctx,op);
  return operationResponse(await finish(req,ctx,confirmed));
 }catch(e){if(e instanceof AuthAdminError&&e.code==='AUTH_NOT_FOUND')return operationResponse(op);return operationResponse(await operationError(op,e));}
}

async function finishApplication(req:FastifyRequest,ctx:Context,applicationId:string,operationId:string){
 return transaction(async db=>{
  await freshManagement(db,req,ctx);
  const application=(await db.query('SELECT * FROM private.registration_applications WHERE id=$1 FOR UPDATE',[applicationId])).rows[0];
  if(!application)fail('NOT_FOUND',404);
  if(application.status==='approved')return application;
  if(application.status!=='processing'||application.operation_id!==operationId)fail('CONFLICT',409);
  const op=(await db.query("SELECT * FROM private.auth_operations WHERE id=$1 AND action='create_user' FOR UPDATE",[operationId])).rows[0];
  if(!op||op.state!=='completed'||!op.target_user_id)fail('AUTH_PENDING',409);
  const student=(await db.query("SELECT id FROM private.app_users WHERE id=$1 AND phone=$2 AND role='STUDENT' AND active FOR UPDATE",[op.target_user_id,application.phone])).rows[0];
  if(!student)fail('CONFLICT',409);
  let enrollment=(await db.query('SELECT * FROM private.enrollments WHERE user_id=$1 AND course_id=$2 FOR UPDATE',[student.id,application.course_id])).rows[0];
  if(!enrollment){
   enrollment=(await db.query(`INSERT INTO private.enrollments(user_id,course_id,status,starts_at,expires_at,payment_status,created_by)
     SELECT $1,c.id,'active',now(),now()+make_interval(weeks=>c.weeks),'unpaid',$2
     FROM private.courses c WHERE c.id=$3 AND c.active AND c.published RETURNING *`,[student.id,ctx.user_id,application.course_id])).rows[0];
  }
  if(!enrollment)fail('INVALID_DATA',400);
  const approved=(await db.query("UPDATE private.registration_applications SET status='approved',student_id=$2,enrollment_id=$3,approved_by=$4,approved_at=now(),updated_at=now() WHERE id=$1 RETURNING *",[applicationId,student.id,enrollment.id,ctx.user_id])).rows[0];
  await audit(db,ctx.user_id,'application.approved','application',applicationId,{course_id:application.course_id,student_id:student.id,enrollment_id:enrollment.id});
  return approved;
 });
}
export function registerAccountRoutes(app:FastifyInstance){
 app.post('/api/applications',{config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async(req,reply)=>{
  const raw=applicationSchema.parse(req.body),data={...raw,phone:normalizePhone(raw.phone)};
  try{
   const application=await transaction(async db=>{
    const course=(await db.query('SELECT id FROM private.courses WHERE id=$1 AND active AND published FOR SHARE',[data.course_id])).rows[0];
    if(!course)fail('INVALID_DATA',400);
    const created=(await db.query('INSERT INTO private.registration_applications(name,phone,course_id) VALUES($1,$2,$3) RETURNING id,status,created_at',[data.name,data.phone,data.course_id])).rows[0];
    await audit(db,null,'application.submitted','application',created.id,{course_id:data.course_id});
    return created;
   });
   reply.code(201);return {application};
  }catch(error:any){if(error?.code==='23505')fail('DUPLICATE',409);throw error;}
 });

 app.get('/api/admin/applications',async req=>{
  await readAccess(req);const p=pageParams(req),query=req.query as any,params:unknown[]=[`%${p.q}%`],where=['(a.name ILIKE $1 OR a.phone ILIKE $1 OR c.title ILIKE $1)'];
  if(query.status)where.push(`a.status=$${params.push(z.enum(['pending','processing','approved','rejected']).parse(query.status))}`);
  return pageList(req,pool,'private.registration_applications a JOIN private.courses c ON c.id=a.course_id LEFT JOIN private.app_users u ON u.id=a.student_id','a.id,a.name,a.phone,a.course_id,a.status,a.operation_id,a.student_id,a.enrollment_id,a.revision,a.created_at,a.updated_at,a.approved_at,c.title AS course_title,u.name AS student_name',where.join(' AND '),params,'a.created_at DESC,a.id');
 });

 app.post('/api/admin/applications/:id/reject',async req=>{
  const applicationId=uuid.parse((req.params as any).id);
  const data=z.object({operation_id:uuid,revision:z.number().int().min(1)}).strict().parse(req.body);
  return managementMutation(req,'application.reject',{...data,application_id:applicationId},async(db,ctx)=>{
   const application=(await db.query('SELECT id,status,revision FROM private.registration_applications WHERE id=$1 FOR UPDATE',[applicationId])).rows[0];
   if(!application)fail('NOT_FOUND',404);
   if(application.status!=='pending'||Number(application.revision)!==data.revision)fail('CONFLICT',409);
   const rejected=(await db.query("UPDATE private.registration_applications SET status='rejected',updated_at=now() WHERE id=$1 RETURNING id,revision",[applicationId])).rows[0];
   await audit(db,ctx.user_id,'application.rejected','application',applicationId,{});
   return {id:rejected.id,ok:true,revision:Number(rejected.revision)};
  });
 });

 app.post('/api/admin/applications/:id/approve',async(req,reply)=>{
  const applicationId=uuid.parse((req.params as any).id),data=approvalSchema.parse(req.body),ctx=await readAccess(req);
  const prepared=await transaction(async db=>{
   await freshManagement(db,req,ctx);
   const application=(await db.query('SELECT * FROM private.registration_applications WHERE id=$1 FOR UPDATE',[applicationId])).rows[0];
   if(!application)fail('NOT_FOUND',404);
   if(application.status==='approved')return {application,op:null,created:false,approved:true};
   if(application.status==='rejected')fail('CONFLICT',409);
   const intent={operation_id:data.operation_id,application_id:applicationId,name:application.name,phone:application.phone,role:'STUDENT',course_id:application.course_id,identity_verified:true};
   const intentHash=hash(JSON.stringify(intent));
   if(application.operation_id&&application.operation_id!==data.operation_id)fail('OPERATION_CONFLICT',409);
   const old=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 FOR UPDATE',[data.operation_id])).rows[0];
   if(old){if(old.actor_id!==ctx.user_id||old.action!=='create_user'||old.request_hash!==intentHash)fail('OPERATION_CONFLICT',409);return {application,op:old,created:false,approved:false};}
   if((await db.query('SELECT 1 FROM private.app_users WHERE phone=$1',[application.phone])).rowCount)fail('DUPLICATE',409);
   if((await db.query("SELECT 1 FROM private.auth_operations WHERE phone=$1 AND action='create_user' AND state NOT IN ('failed','completed')",[application.phone])).rowCount)fail('AUTH_PENDING',409);
   const op=(await db.query("INSERT INTO private.auth_operations(id,actor_id,action,request_hash,phone,name,requested_role,auth_user_id,state,lease_until,attempts) VALUES($1,$2,'create_user',$3,$4,$5,'STUDENT',$6,'inflight',now()+interval '45 seconds',1) RETURNING *",[data.operation_id,ctx.user_id,intentHash,application.phone,application.name,randomUUID()])).rows[0];
   await db.query("UPDATE private.registration_applications SET status='processing',operation_id=$2,updated_at=now() WHERE id=$1",[applicationId,op.id]);
   await audit(db,ctx.user_id,'application.approval.started','application',applicationId,{course_id:application.course_id,operation_id:op.id});
   return {application,op,created:true,approved:false};
  });
  if(prepared.approved){reply.code(200);return {status:'completed',application:prepared.application,user:await safeUser(prepared.application.student_id)};}
  let op=prepared.op;
  if(!prepared.created){
   const reconciled=await reconcile(req,ctx,op);op=(await pool.query('SELECT * FROM private.auth_operations WHERE id=$1',[op.id])).rows[0];
   if(op.state!=='completed'){reply.code(202);return {...reconciled,application:{id:applicationId,status:'processing'}};}
   const application=await finishApplication(req,ctx,applicationId,op.id);reply.code(200);return {...reconciled,application,user:await safeUser(application.student_id)};
  }
  const password=opaque();
  try{
   const created=await createAuthUser(prepared.application.phone,password,op.auth_user_id,op.id);
   if(created.id!==op.auth_user_id)throw new AuthAdminError('AUTH_ID_MISMATCH',true);
   op=await confirm(req,ctx,op);op=await finish(req,ctx,op);
   if(op.state!=='completed'){reply.code(202);return {...await operationResponse(op),application:{id:applicationId,status:'processing'}};}
   const application=await finishApplication(req,ctx,applicationId,op.id);reply.code(201);return {...await operationResponse(op,password),application,user:await safeUser(application.student_id)};
  }catch(error){op=await operationError(op,error);reply.code(202);return {...await operationResponse(op),application:{id:applicationId,status:'processing'}};}
 });

 app.get('/api/admin/users',async req=>{
  await readAccess(req);const p=pageParams(req),q=req.query as any,params:unknown[]=[`%${p.q}%`],where=["(u.name ILIKE $1 OR u.phone ILIKE $1)"];
  if(q.role){where.push(`u.role=$${params.push(z.enum(['ADMIN','TEACHER','STUDENT']).parse(q.role))}`);}
  if(q.status==='active'||q.status==='blocked'){where.push(`u.active=$${params.push(q.status==='active')}`);}
  return pageList(req,pool,'private.app_users u',`${userFields},(SELECT status FROM private.device_bindings d WHERE d.user_id=u.id AND d.status='approved' LIMIT 1) AS device_status`,where.join(' AND '),params,'u.created_at DESC,u.id');
 });
 app.get('/api/admin/users/:id',async req=>{
  await readAccess(req);const id=uuid.parse((req.params as any).id),user=await safeUser(id);if(!user)fail('NOT_FOUND',404);
  const enrollments=(await pool.query('SELECT e.*,c.title AS course_title,g.title AS group_title FROM private.enrollments e JOIN private.courses c ON c.id=e.course_id LEFT JOIN private.groups g ON g.id=e.group_id WHERE e.user_id=$1 ORDER BY c.title',[id])).rows;
  const devices=(await pool.query('SELECT id,label,status,requested_at,approved_at,revoked_at FROM private.device_bindings WHERE user_id=$1 ORDER BY requested_at DESC',[id])).rows;
  return {user,enrollments,devices};
 });
 app.patch('/api/admin/users/:id',async req=>{
  const id=uuid.parse((req.params as any).id),data=z.object({operation_id:uuid,name:z.string().trim().min(1).max(120),phone:z.string().max(30).optional(),active:z.boolean()}).strict().parse(req.body);
  return managementMutation(req,'user.updated',{...data,target_id:id},async(db,ctx)=>{
   const target=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!target)fail('NOT_FOUND',404);
   if(target.role==='ADMIN'||id===ctx.user_id)fail('OWNER_PROTECTED');
   if(data.phone&&normalizePhone(data.phone)!==target.phone)fail('PHONE_IMMUTABLE',400);
   if(!data.active)await invalidateUser(db,id);
   await db.query('UPDATE private.app_users SET name=$2,active=$3,updated_at=now() WHERE id=$1',[id,data.name,data.active]);
   await audit(db,ctx.user_id,'user.updated','user',id,{active:data.active,previous_active:target.active,name_changed:target.name!==data.name});return {id,ok:true};
  });
 });
 app.post('/api/admin/users',async(req,reply)=>{
  const raw=createSchema.parse(req.body),data={...raw,phone:normalizePhone(raw.phone)},ctx=await readAccess(req),intentHash=hash(JSON.stringify(data));
  const prepared=await transaction(async db=>{
   await freshManagement(db,req,ctx);
   const old=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 FOR UPDATE',[data.operation_id])).rows[0];
   if(old){if(old.actor_id!==ctx.user_id||old.action!=='create_user'||old.request_hash!==intentHash)fail('OPERATION_CONFLICT',409);return {op:old,created:false};}
   if((await db.query('SELECT 1 FROM private.app_users WHERE phone=$1',[data.phone])).rowCount)fail('DUPLICATE',409);
   if((await db.query("SELECT 1 FROM private.auth_operations WHERE phone=$1 AND action='create_user' AND state NOT IN ('failed','completed')",[data.phone])).rowCount)fail('AUTH_PENDING',409);
   const op=(await db.query("INSERT INTO private.auth_operations(id,actor_id,action,request_hash,phone,name,requested_role,auth_user_id,state,lease_until,attempts) VALUES($1,$2,'create_user',$3,$4,$5,$6,$7,'inflight',now()+interval '45 seconds',1) RETURNING *",[data.operation_id,ctx.user_id,intentHash,data.phone,data.name,data.role,randomUUID()])).rows[0];
   return {op,created:true};
  });
  if(!prepared.created){const result=await reconcile(req,ctx,prepared.op);reply.code(result.status==='completed'?200:202);return result;}
  let op=prepared.op;const password=opaque();
  try{
   const created=await createAuthUser(data.phone,password,op.auth_user_id,op.id);
   if(created.id!==op.auth_user_id)throw new AuthAdminError('AUTH_ID_MISMATCH',true);
   op=await confirm(req,ctx,op);
   op=await finish(req,ctx,op);reply.code(op.state==='completed'?201:202);return operationResponse(op,op.state==='completed'?password:undefined);
  }catch(e){op=await operationError(op,e);reply.code(202);return operationResponse(op);}
 });
 app.post('/api/admin/users/:id/password-reset',async(req,reply)=>{
  const id=uuid.parse((req.params as any).id),data=resetSchema.parse(req.body),ctx=await readAccess(req),intentHash=hash(JSON.stringify({...data,target_id:id}));
  const prepared=await transaction(async db=>{
   await freshManagement(db,req,ctx);
   const old=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 FOR UPDATE',[data.operation_id])).rows[0];
   if(old){if(old.actor_id!==ctx.user_id||old.action!=='reset_password'||old.request_hash!==intentHash)fail('OPERATION_CONFLICT',409);return {op:old,created:false};}
   const target=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!target)fail('NOT_FOUND',404);if(target.role==='ADMIN')fail('OWNER_PROTECTED');
   if(target.auth_operation_id)fail('AUTH_PENDING',409);
   const op=(await db.query("INSERT INTO private.auth_operations(id,actor_id,action,request_hash,target_user_id,auth_user_id,state,lease_until,attempts) VALUES($1,$2,'reset_password',$3,$4,$4,'inflight',now()+interval '45 seconds',1) RETURNING *",[data.operation_id,ctx.user_id,intentHash,id])).rows[0];
   await invalidateUser(db,id);
   await db.query('UPDATE private.app_users SET must_change_password=true,auth_operation_id=$2 WHERE id=$1',[id,op.id]);
   await audit(db,ctx.user_id,'password.reset.started','user',id,{operation_id:op.id});return {op,created:true};
  });
  if(!prepared.created){const result=await reconcile(req,ctx,prepared.op);reply.code(result.status==='completed'?200:202);return result;}
  let op=prepared.op;const password=opaque();
  try{await setPassword(id,password,op.id);op=await confirm(req,ctx,op);op=await finish(req,ctx,op);if(op.state!=='completed')reply.code(202);return operationResponse(op,op.state==='completed'?password:undefined);}
  catch(e){op=await operationError(op,e);reply.code(202);return operationResponse(op);}
 });
 app.get('/api/admin/auth-operations',async req=>{await readAccess(req);return pageList(req,pool,'private.auth_operations o LEFT JOIN private.app_users u ON u.id=o.target_user_id','o.id,o.action,o.state,o.target_user_id,o.phone,o.name,o.last_error_code,o.created_at,o.updated_at,u.name AS user_name','',[],'o.created_at DESC,o.id');});
 app.post('/api/admin/auth-operations/:id/reconcile',async(req,reply)=>{z.object({}).strict().parse(req.body);const ctx=await readAccess(req),id=uuid.parse((req.params as any).id),op=(await pool.query('SELECT * FROM private.auth_operations WHERE id=$1 AND actor_id=$2',[id,ctx.user_id])).rows[0];if(!op)fail('NOT_FOUND',404);const result=await reconcile(req,ctx,op);reply.code(result.status==='completed'?200:202);return result;});
 app.post('/api/admin/auth-operations/:id/resume-create',async(req,reply)=>{
  z.object({identity_verified:z.literal(true)}).strict().parse(req.body);
  const operationId=uuid.parse((req.params as any).id),ctx=await readAccess(req);
  const prepared=await transaction(async db=>{
   await freshManagement(db,req,ctx);
   const current=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 AND actor_id=$2 FOR UPDATE',[operationId,ctx.user_id])).rows[0];if(!current)fail('NOT_FOUND',404);
   if(current.action!=='create_user')fail('INVALID_DATA',400);
   if(current.state==='completed')return {op:current,resumed:false};
   // A second click can read the lease but never starts another remote create.
   if(current.state==='inflight'&&current.lease_until&&new Date(current.lease_until).getTime()>Date.now())return {op:current,resumed:false};
   const timing=(await db.query("SELECT updated_at<=now()-interval '60 seconds' AND (lease_until IS NULL OR lease_until<=now()) AS ready FROM private.auth_operations WHERE id=$1",[operationId])).rows[0];
   if(!['failed','reconcile_required'].includes(current.state)||!timing.ready)fail('AUTH_PENDING',409);
   const op=(await db.query("UPDATE private.auth_operations SET state='inflight',lease_until=now()+interval '45 seconds',lease_owner=$2,attempts=attempts+1,last_error_code=NULL,updated_at=now() WHERE id=$1 RETURNING *",[operationId,randomUUID()])).rows[0];
   await audit(db,ctx.user_id,'user.create.resumed','auth_operation',op.id,{operation_id:op.id,attempt:op.attempts});return {op,resumed:true};
  });
  if(!prepared.resumed){reply.code(prepared.op.state==='completed'?200:202);return operationResponse(prepared.op);}
  let op=prepared.op;
  try{
   let existing:any;
   try{existing=await getAuthUser(op.auth_user_id);}catch(e){if(!(e instanceof AuthAdminError&&e.code==='AUTH_NOT_FOUND'))throw e;}
   if(existing){
    if(existing.id!==op.auth_user_id||existing.app_metadata?.uyym_operation!==op.id||normalizePhone(existing.phone)!==op.phone)throw new AuthAdminError('AUTH_ID_MISMATCH',false);
    op=await confirm(req,ctx,op);op=await finish(req,ctx,op);reply.code(op.state==='completed'?200:202);return operationResponse(op);
   }
   // Only a confirmed 404 permits a remote POST. Reuse the reserved identity
   // UUID and phone so a late original create cannot produce a second user.
   const password=opaque(),created=await createAuthUser(op.phone,password,op.auth_user_id,op.id);
   if(created.id!==op.auth_user_id||created.app_metadata?.uyym_operation!==op.id||normalizePhone(created.phone)!==op.phone)throw new AuthAdminError('AUTH_ID_MISMATCH',true);
   op=await confirm(req,ctx,op);op=await finish(req,ctx,op);reply.code(op.state==='completed'?201:202);return operationResponse(op,op.state==='completed'?password:undefined);
  }catch(e){op=await operationError(op,e);reply.code(op.state==='completed'?200:202);return operationResponse(op);}
 });
 app.post('/api/admin/auth-operations/:id/retry',async(req,reply)=>{
  const previousId=uuid.parse((req.params as any).id),data=resetSchema.parse(req.body),ctx=await readAccess(req);
  if(data.operation_id===previousId)fail('OPERATION_CONFLICT',409);
  const prepared=await transaction(async db=>{
   await freshManagement(db,req,ctx);
   const previous=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 AND actor_id=$2 FOR UPDATE',[previousId,ctx.user_id])).rows[0];if(!previous)fail('NOT_FOUND',404);
   if(previous.action!=='reset_password')fail('INVALID_DATA',400);
   const intentHash=hash(JSON.stringify({...data,previous_operation_id:previousId,target_id:previous.target_user_id}));
   const existing=(await db.query('SELECT * FROM private.auth_operations WHERE id=$1 FOR UPDATE',[data.operation_id])).rows[0];
   if(existing){if(existing.actor_id!==ctx.user_id||existing.action!=='reset_password'||existing.request_hash!==intentHash)fail('OPERATION_CONFLICT',409);return {op:existing,created:false};}
   const timing=(await db.query("SELECT updated_at<=now()-interval '60 seconds' AND (lease_until IS NULL OR lease_until<=now()) AS ready FROM private.auth_operations WHERE id=$1",[previousId])).rows[0];
   if(!['failed','reconcile_required'].includes(previous.state)||previous.last_error_code==='OPERATION_SUPERSEDED'||!timing.ready)fail('AUTH_PENDING',409);
   const target=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[previous.target_user_id])).rows[0];if(!target)fail('NOT_FOUND',404);if(target.role==='ADMIN')fail('OWNER_PROTECTED');if(target.auth_operation_id!==previousId)fail('CONFLICT',409);
   // Supersede and replace the blocker atomically. The same approved browser
   // remains reserved; no old marker can clear the new operation's gate.
   await db.query("UPDATE private.auth_operations SET state='failed',last_error_code='OPERATION_SUPERSEDED',lease_until=NULL,updated_at=now() WHERE id=$1",[previousId]);
   const op=(await db.query("INSERT INTO private.auth_operations(id,actor_id,action,request_hash,target_user_id,auth_user_id,state,lease_until,attempts) VALUES($1,$2,'reset_password',$3,$4,$4,'inflight',now()+interval '45 seconds',1) RETURNING *",[data.operation_id,ctx.user_id,intentHash,target.id])).rows[0];
   await invalidateUser(db,target.id);
   await db.query('UPDATE private.app_users SET must_change_password=true,auth_operation_id=$2 WHERE id=$1',[target.id,op.id]);
   await audit(db,ctx.user_id,'password.reset.retried','user',target.id,{previous_operation_id:previousId,operation_id:op.id});return {op,created:true};
  });
  if(!prepared.created){const result=await reconcile(req,ctx,prepared.op);reply.code(result.status==='completed'?200:202);return result;}
  let op=prepared.op;const password=opaque();
  try{await setPassword(op.target_user_id,password,op.id);op=await confirm(req,ctx,op);op=await finish(req,ctx,op);if(op.state!=='completed')reply.code(202);return operationResponse(op,op.state==='completed'?password:undefined);}
  catch(e){op=await operationError(op,e);reply.code(202);return operationResponse(op);}
 });
}
