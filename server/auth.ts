import type { FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import {pool,transaction} from './db.js';
import {cookieName,config,trustedOrigin} from './config.js';
import {hash,HttpError,challengePayload,verifyProof} from './security.js';
export interface Context {
 id:string;user_id:string;device_id:string;auth_epoch:string;csrf_token:string;mfa_verified:boolean;
 kind:'session'|'ticket'; user:any; device:any;
}
export const deniedBrowser='Бұл аккаунт басқа құрылғыға тіркелген. Құрылғыны ауыстыру үшін әкімшіге хабарласыңыз';
export function setCookie(reply:FastifyReply,kind:'session'|'ticket',token:string,ttl:number) {
 reply.setCookie(cookieName(kind),token,{httpOnly:true,secure:config.secure,sameSite:'strict',path:'/',maxAge:ttl});
}
export function clearCookie(reply:FastifyReply,kind:'session'|'ticket') {reply.clearCookie(cookieName(kind),{path:'/',secure:config.secure,sameSite:'strict'});}
export async function context(req:FastifyRequest,db:pg.Pool|pg.PoolClient=pool):Promise<Context> {
 for(const kind of ['ticket','session'] as const) {
  const token=req.cookies[cookieName(kind)];if(!token)continue;
  const table=kind==='session'?'app_sessions':'login_tickets';
  const {rows}=await db.query(`SELECT s.*,to_jsonb(u) AS profile,to_jsonb(d) AS binding FROM private.${table} s JOIN private.app_users u ON u.id=s.user_id JOIN private.device_bindings d ON d.id=s.device_id AND d.user_id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active AND u.auth_operation_id IS NULL AND s.auth_epoch=u.auth_epoch`,[hash(token)]);
  const row=rows[0];if(!row)continue;
  return {...row,kind,user:row.profile,device:row.binding};
 }
 throw new HttpError(401,'Сессия аяқталды. Қайта кіріңіз');
}
export function csrf(req:FastifyRequest,ctx:Context) {
 if(!trustedOrigin(req.headers.origin) || req.headers['x-csrf-token']!==ctx.csrf_token)throw new HttpError(403,'Сұрау расталмады');
}
export function requireLearning(ctx:Context) {
 if(ctx.kind!=='session')throw new HttpError(403,'Алдымен браузерді растаңыз');
 if(ctx.user.must_change_password)throw new HttpError(403,'Уақытша құпиясөзді ауыстырыңыз');
 if(ctx.device.status!=='approved')throw new HttpError(403,deniedBrowser);
 if(ctx.user.role==='ADMIN'&&!ctx.mfa_verified)throw new HttpError(403,'TOTP растауы қажет');
}
export async function proof(req:FastifyRequest,purpose='api'):Promise<Context> {
 const ctx=await context(req);if(req.method!=='GET')csrf(req,ctx);
 const id=req.headers['x-proof-id'],signature=req.headers['x-device-proof'];
 if(typeof id!=='string'||typeof signature!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new HttpError(403,'Браузер қолтаңбасы қажет');
 await transaction(async db=>{
  // Lock the user first: replacement and proof validation use the same order.
  const {rows:users}=await db.query('SELECT auth_epoch,active FROM private.app_users WHERE id=$1 FOR UPDATE',[ctx.user_id]);
  if(!users[0]?.active||String(users[0].auth_epoch)!==String(ctx.auth_epoch))throw new HttpError(401,'Сессия аяқталды');
  const {rows}=await db.query('SELECT * FROM private.challenges WHERE id=$1 FOR UPDATE',[id]);const c=rows[0];
  const bodyHash=hash(req.body===undefined?'':JSON.stringify(req.body));
  if(!c||c.consumed_at||new Date(c.expires_at).getTime()<=Date.now()||c.user_id!==ctx.user_id||c.device_id!==ctx.device_id||c.purpose!==purpose||c.method!==req.method||c.path!==req.url||c.body_hash!==bodyHash||(ctx.kind==='session'?c.session_id!==ctx.id:c.ticket_id!==ctx.id))throw new HttpError(403,'Қолтаңба мерзімі аяқталған немесе жарамсыз');
  const payload=challengePayload({...c,scope:ctx.id});
  if(!verifyProof(ctx.device.public_key,payload,signature))throw new HttpError(403,'Браузер қолтаңбасы жарамсыз');
  const {rows:consumed}=await db.query('SELECT private.consume_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS ok',[c.id,ctx.user_id,ctx.device_id,ctx.kind==='session'?ctx.id:null,ctx.kind==='ticket'?ctx.id:null,c.purpose,c.method,c.path,c.nonce,ctx.auth_epoch,bodyHash]);
  if(!consumed[0].ok)throw new HttpError(403,'Қолтаңба бұрын қолданылған');
 });
 return ctx;
}
export async function lessonAllowed(ctx:Context,lessonId:string) {
 requireLearning(ctx);
 const {rows}=await pool.query(`SELECT l.* FROM private.lessons l JOIN private.courses c ON c.id=l.course_id LEFT JOIN private.groups g ON g.id=l.group_id WHERE l.id=$1 AND l.published AND c.active AND c.published AND (l.group_id IS NULL OR (g.active AND (g.starts_at IS NULL OR g.starts_at<=now()) AND (g.ends_at IS NULL OR g.ends_at>now()))) AND ($3='ADMIN' OR ($3='STUDENT' AND EXISTS(SELECT 1 FROM private.enrollments e WHERE e.user_id=$2 AND e.course_id=l.course_id AND (l.group_id IS NULL OR e.group_id=l.group_id) AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now() AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM private.groups eg WHERE eg.id=e.group_id AND eg.active AND (eg.starts_at IS NULL OR eg.starts_at<=now()) AND (eg.ends_at IS NULL OR eg.ends_at>now()))))) OR ($3='TEACHER' AND EXISTS(SELECT 1 FROM private.teacher_assignments t WHERE t.teacher_id=$2 AND t.course_id=l.course_id AND (t.group_id IS NULL OR t.group_id=l.group_id))))`,[lessonId,ctx.user_id,ctx.user.role]);
 if(!rows[0])throw new HttpError(404,'Сабақ қолжетімсіз');return rows[0];
}
export async function admin(req:FastifyRequest) {const ctx=await proof(req);requireLearning(ctx);if(ctx.user.role!=='ADMIN')throw new HttpError(403,'Рұқсат жоқ');return ctx;}
