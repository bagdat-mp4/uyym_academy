import type {FastifyInstance} from 'fastify';
import type {PoolClient} from 'pg';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction,audit} from './db.js';
import {config} from './config.js';
import {clearCookie,context,requireLearning} from './auth.js';
import {readAccess,freshManagement,managementMutation,uuid,fail} from './management.js';
import {base32,encrypt,decrypt,verifyTotp,opaque,hash,HttpError} from './security.js';

// Invitations are immutable, non-secret management receipts. No schema change,
// Auth call or provisional ADMIN role is needed. A later cancellation supersedes
// an invitation; the receipt ID is bound into a short-lived encrypted setup token.
const invitationSql=`SELECT r.operation_id,r.actor_id,r.action,r.created_at,
 r.created_at>now()-interval '24 hours' AS timely,u.active AND u.role='ADMIN' AS issuer_active
 FROM private.mutation_receipts r JOIN private.app_users u ON u.id=r.actor_id
 WHERE r.action IN ('admin.invited','admin.invitation.cancelled') AND r.response->>'user_id'=$1
 ORDER BY r.created_at DESC,r.operation_id DESC LIMIT 1`;
async function invitation(db:any,userId:string){
 const row=(await db.query(invitationSql,[userId])).rows[0];
 return row?.action==='admin.invited'&&row.timely&&row.issuer_active?row:null;
}
async function limit(userId:string){
 const row=(await pool.query(`INSERT INTO private.security_rate_limits(key_hash,window_start,attempts)
 VALUES($1,now(),1) ON CONFLICT(key_hash) DO UPDATE SET
 window_start=CASE WHEN private.security_rate_limits.window_start<now()-interval '5 minutes' THEN now() ELSE private.security_rate_limits.window_start END,
 attempts=CASE WHEN private.security_rate_limits.window_start<now()-interval '5 minutes' THEN 1 ELSE private.security_rate_limits.attempts+1 END RETURNING attempts`,[hash(`admin-setup:${userId}`)])).rows[0];
 if(row.attempts>5)throw new HttpError(429,'Кейін қайталаңыз');
}
async function ownerCode(db:PoolClient,userId:string,code:string){
 const u=(await db.query('SELECT admin_totp_secret_encrypted,admin_totp_last_counter FROM private.app_users WHERE id=$1',[userId])).rows[0];
 const counter=u?.admin_totp_secret_encrypted?verifyTotp(decrypt(u.admin_totp_secret_encrypted,config.encryptionKey),code,Number(u.admin_totp_last_counter??-1)):null;
 if(counter===null)fail('FORBIDDEN');
 await db.query('UPDATE private.app_users SET admin_totp_last_counter=$2 WHERE id=$1',[userId,counter]);
}
const setupSchema=z.object({kind:z.literal('admin-setup-v1'),user_id:uuid,session_id:uuid,auth_epoch:z.string(),invitation_id:uuid,expires_at:z.number().int(),secret:z.string().regex(/^[A-Z2-7]{32}$/)}).strict();
export function registerAdminInvitationRoutes(app:FastifyInstance){
 app.get('/api/admin/users/:id/admin-invitation',async req=>{
  await readAccess(req);const id=uuid.parse((req.params as any).id);
  const row=await invitation(pool,id);return {pending:Boolean(row)};
 });
 app.post('/api/admin/users/:id/admin-invitation',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async req=>{
  const ctx=await context(req);requireLearning(ctx);if(ctx.user.role!=='ADMIN')fail('FORBIDDEN');await limit(ctx.user_id);
  const id=uuid.parse((req.params as any).id);
  const data=z.object({operation_id:uuid,identity_verified:z.literal(true),full_access_confirmed:z.literal(true),code:z.string().regex(/^\d{6}$/)}).strict().parse(req.body);
  // Do not include the short OTP in the persisted receipt hash or audit.
  return managementMutation(req,'admin.invited',{operation_id:data.operation_id,user_id:id,identity_verified:true,full_access_confirmed:true},async(db,fresh)=>{
   const target=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!target?.active||target.role==='ADMIN'||target.auth_operation_id||id===fresh.user_id)fail('FORBIDDEN');
   if(await invitation(db,id))fail('CONFLICT',409);
   await ownerCode(db,fresh.user_id,data.code);
   await audit(db,fresh.user_id,'admin.invited','user',id);
   return {id:data.operation_id,user_id:id,status:'pending'};
  });
 });
 app.post('/api/admin/users/:id/admin-invitation/cancel',async req=>{
  const id=uuid.parse((req.params as any).id);const data=z.object({operation_id:uuid}).strict().parse(req.body);
  return managementMutation(req,'admin.invitation.cancelled',{...data,user_id:id},async(db,ctx)=>{
   const target=(await db.query('SELECT role FROM private.app_users WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!target||target.role==='ADMIN')fail('FORBIDDEN');
   await audit(db,ctx.user_id,'admin.invitation.cancelled','user',id);
   return {id:data.operation_id,user_id:id,status:'revoked'};
  });
 });
 app.get('/api/account/admin-invitation',async req=>{
  const ctx=await readAccess(req,['STUDENT','TEACHER']);
  const row=await invitation(pool,ctx.user_id);return {pending:Boolean(row)};
 });
 app.post('/api/account/admin-invitation/setup',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async req=>{
  const ctx=await readAccess(req,['STUDENT','TEACHER']);
  z.object({}).strict().parse(req.body);
  const row=await invitation(pool,ctx.user_id);if(!row)fail('FORBIDDEN');
  const secret=base32(randomBytes(20));
  const payload={kind:'admin-setup-v1',user_id:ctx.user_id,session_id:ctx.id,auth_epoch:String(ctx.auth_epoch),invitation_id:row.operation_id,expires_at:Date.now()+10*60*1000,secret};
  return {secret,setup_token:encrypt(JSON.stringify(payload),config.encryptionKey)};
 });
 app.post('/api/account/admin-invitation/confirm',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async(req,reply)=>{
  const ctx=await readAccess(req,['STUDENT','TEACHER']);await limit(ctx.user_id);
  const data=z.object({setup_token:z.string().min(30).max(2000),code:z.string().regex(/^\d{6}$/),full_access_confirmed:z.literal(true)}).strict().parse(req.body);
  let payload:z.infer<typeof setupSchema>;
  try{payload=setupSchema.parse(JSON.parse(decrypt(data.setup_token,config.encryptionKey)));}catch{fail('FORBIDDEN');}
  if(payload.user_id!==ctx.user_id||payload.session_id!==ctx.id||payload.auth_epoch!==String(ctx.auth_epoch)||payload.expires_at<=Date.now())fail('FORBIDDEN');
  const codes=Array.from({length:10},()=>opaque());
  await transaction(async db=>{
   const fresh=await freshManagement(db,req,ctx,['STUDENT','TEACHER']);
   const row=await invitation(db,ctx.user_id);if(!row||row.operation_id!==payload.invitation_id)fail('FORBIDDEN');
   // Lock issuer and recheck inside the serialized promotion transaction.
   const issuer=(await db.query("SELECT id FROM private.app_users WHERE id=$1 AND active AND role='ADMIN' FOR UPDATE",[row.actor_id])).rows[0];if(!issuer)fail('FORBIDDEN');
   const counter=verifyTotp(payload.secret,data.code,-1);if(counter===null)fail('FORBIDDEN');
   await db.query(`UPDATE private.app_users SET role='ADMIN',admin_totp_secret_encrypted=$2,admin_totp_last_counter=$3,recovery_hashes=$4,auth_epoch=auth_epoch+1,updated_at=now() WHERE id=$1`,[fresh.user_id,encrypt(payload.secret,config.encryptionKey),counter,codes.map(hash)]);
   for(const table of ['app_sessions','login_tickets','playback_grants'])await db.query(`UPDATE private.${table} SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,[fresh.user_id]);
   await audit(db,ctx.user_id,'admin.accepted','user',ctx.user_id,{invited_by:row.actor_id,invitation_id:row.operation_id});
  });
  clearCookie(reply,'session');clearCookie(reply,'ticket');
  return {ok:true,relogin_required:true,recovery_codes:codes};
 });
}
