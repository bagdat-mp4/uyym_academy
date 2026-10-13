import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {existsSync,createReadStream,readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {config,ready,trustedOrigin} from './config.js';
import {pool,transaction,audit} from './db.js';
import {HttpError,hash,opaque,publicJwk,normalizePhone,challengePayload,decrypt,verifyTotp} from './security.js';
import {authenticate,setPassword} from './supabase.js';
import {context,csrf,setCookie,clearCookie,proof,requireLearning,lessonAllowed,admin,deniedBrowser} from './auth.js';
import {validateDriveFile,streamPart} from './drive.js';
import {registerAccountRoutes} from './accounts.js';
import {registerAcademicRoutes} from './academic.js';
import {freshManagement} from './management.js';
import {registerContentRoutes} from './content.js';
import {registerSubmissionRoutes} from './submissions.js';
import {registerEngagementRoutes} from './engagement.js';
const uuid=z.string().uuid();
// Five 5 MB files expand to roughly 33.4 MB in base64 JSON.
export const app=Fastify({logger:false,bodyLimit:40*1024*1024,trustProxy:config.trustProxy?['127.0.0.1','::1']:false});
await app.register(cookie);
await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],mediaSrc:["'self'","blob:"],objectSrc:["'none'"],frameAncestors:["'none'"]}},hsts:config.secure?{maxAge:31536000,includeSubDomains:true}:false});
await app.register(rateLimit,{max:3000,timeWindow:'1 minute'});
app.addHook('onRequest',async(req,reply)=>{
 if(req.url.startsWith('/api/'))reply.header('Cache-Control','private, no-store').header('Pragma','no-cache');
 if(req.url.startsWith('/api/')&&req.method!=='GET'&&req.method!=='HEAD') {
  if(!trustedOrigin(req.headers.origin)||!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(403,'Сұрау расталмады');
 }
 if(req.url.startsWith('/api/')&&!req.url.startsWith('/api/public')&&!req.url.startsWith('/api/health')&&!ready())throw new HttpError(503,'Сыртқы қызметтер әлі қосылмаған. Әкімшіге хабарласыңыз');
});
app.setErrorHandler((error,req,reply)=>{
 const status=error instanceof HttpError?error.statusCode:error instanceof z.ZodError?400:((error as any)?.statusCode===429?429:500);
 const ru=String(req.headers['accept-language']||'').startsWith('ru');
 const kkMessage=status===500?'Сервис уақытша қолжетімсіз':error instanceof z.ZodError?'Деректерді тексеріңіз':status===429?'Көп әрекет жасалды. Кейін қайталаңыз':(error as Error).message;
 const ruMessage=status===500?'Сервис временно недоступен':error instanceof z.ZodError?'Проверьте данные':status===429?'Слишком много попыток. Повторите позже':(error as any).message_ru||({401:'Сессия завершилась. Войдите снова',403:'Нет разрешения на действие',404:'Запись недоступна',400:'Проверьте данные',409:'Запись изменилась. Обновите список',503:'Внешние сервисы ещё не подключены. Обратитесь к администратору'} as Record<number,string>)[status]||'Запрос не выполнен';
 reply.code(status).send({error:ru?ruMessage:kkMessage,code:(error as any).code|| (error instanceof z.ZodError?'INVALID_DATA':undefined)});
});
app.get('/api/health',async(_req,reply)=>{
 if(!ready())return reply.code(503).send({ok:false});
 try{await pool.query('SELECT 1');return {ok:true};}catch{return reply.code(503).send({ok:false});}
});
const defaultCourses=[['calculus-i','Calculus I','Туындылар, интегралдар және есептер.'],['linear-algebra','Linear Algebra','Матрицалар, векторлар және сызықтық жүйелер.'],['pp1','PP1 / Principles of Programming I','C++ тіліндегі бағдарламалау негіздері.']].map(([id,title,summary])=>({id,title,summary,price_kzt:60000,weeks:6,lessons:12,hours:18,group_capacity:5}));
app.get('/api/public',async()=>{
 if(!ready()){
  if(config.production)throw new HttpError(503,'Сервис уақытша қолжетімсіз');
  return {courses:defaultCourses,settings:{whatsapp:'',contact_email:''},configured:false};
 }
 const {rows}=await pool.query('SELECT id,title,description AS summary,price_kzt,weeks,weeks*lessons_per_week AS lessons,weeks*lessons_per_week*lesson_minutes/60.0 AS hours,default_group_size AS group_capacity FROM private.courses WHERE active AND published ORDER BY created_at');
 const row=(await pool.query('SELECT title,contacts,teachers_public,faq FROM private.site_settings WHERE id=true')).rows[0];
 const settings={...row?.contacts,title:row?.title,teachers_public:row?.teachers_public||[],faq:row?.faq||[]};
 return {courses:rows,settings,configured:true};
});
async function status(req:any) {
 try {
  const ctx=await context(req);
  const {rows:devices}=await pool.query('SELECT id,label,status,requested_at,approved_at FROM private.device_bindings WHERE user_id=$1 ORDER BY requested_at DESC',[ctx.user_id]);
  return {authenticated:true,session_active:ctx.kind==='session',session_id:ctx.id,csrf_token:ctx.csrf_token,device_status:ctx.device.status,devices,user:{id:ctx.user_id,name:ctx.user.name,phone:ctx.user.phone,role:ctx.user.role,must_change_password:ctx.user.must_change_password,totp_required:ctx.user.role==='ADMIN'&&!ctx.mfa_verified}};
 } catch(e){if(e instanceof HttpError&&e.statusCode===401)return {authenticated:false};throw e;}
}
app.get('/api/auth/status',status);
app.post('/api/auth/login',{config:{rateLimit:{max:50,timeWindow:'15 minutes'}}},async(req,reply)=>{
 const data=z.object({phone:z.string().min(5).max(30),password:z.string().min(1).max(128),public_key:z.any(),label:z.string().min(1).max(120)}).parse(req.body);
 const phone=normalizePhone(data.phone),key=publicJwk(data.public_key);
 const attempt=(await pool.query(`INSERT INTO private.security_rate_limits(key_hash,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(key_hash) DO UPDATE SET window_start=CASE WHEN private.security_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE private.security_rate_limits.window_start END,attempts=CASE WHEN private.security_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE private.security_rate_limits.attempts+1 END RETURNING attempts`,[hash(phone)])).rows[0];
 if(attempt.attempts>8)throw new HttpError(429,'Көп әрекет жасалды. 15 минуттан кейін қайталаңыз');
 // No frontend Supabase access or token response. Password verification alone is pre-authentication.
 const userId=await authenticate(phone,data.password);
 const token=opaque(),csrfToken=opaque();
 await transaction(async db=>{
  const {rows}=await db.query('SELECT * FROM private.app_users WHERE id=$1 AND phone=$2 FOR UPDATE',[userId,phone]);const u=rows[0];if(!u?.active||u.auth_operation_id)throw new HttpError(401,'Кіру деректерін тексеріңіз немесе әкімшіге хабарласыңыз');
  let d=(await db.query("SELECT * FROM private.device_bindings WHERE user_id=$1 AND public_key=$2::jsonb AND status IN ('approved','pending') ORDER BY requested_at DESC LIMIT 1",[userId,JSON.stringify(key)])).rows[0];
  if(!d) {d=(await db.query('INSERT INTO private.device_bindings(user_id,public_key,label) VALUES($1,$2,$3) RETURNING *',[userId,JSON.stringify(key),data.label])).rows[0];await audit(db,userId,'device.requested','device',d.id);}
  await db.query('INSERT INTO private.login_tickets(user_id,device_id,token_hash,csrf_token,auth_epoch,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'15 minutes\')',[userId,d.id,hash(token),csrfToken,u.auth_epoch]);
 });
 setCookie(reply,'ticket',token,900);return status(reqWithCookie(req,'ticket',token));
});
function reqWithCookie(req:any,kind:'ticket'|'session',token:string) {return {...req,cookies:{...req.cookies,[`${config.secure?'__Host-':''}uyym_${kind}`]:token}};}
app.post('/api/auth/change-password',async(req)=>{
 const ctx=await context(req);csrf(req,ctx);const {password}=z.object({password:z.string().min(12).max(128)}).parse(req.body);
 if(ctx.kind!=='ticket'||!ctx.user.must_change_password)throw new HttpError(403,'Құпиясөзді өзгерту үшін әкімшіге хабарласыңыз');
 await transaction(async db=>{
  const u=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[ctx.user_id])).rows[0];
  const ticket=(await db.query('SELECT 1 FROM private.login_tickets WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() AND auth_epoch=$2',[ctx.id,ctx.auth_epoch])).rowCount;
  if(!u?.active||!u.must_change_password||String(u.auth_epoch)!==String(ctx.auth_epoch)||!ticket)throw new HttpError(401,'Сессия аяқталды');
  await setPassword(ctx.user_id,password);
  await db.query('UPDATE private.app_users SET must_change_password=false,updated_at=now() WHERE id=$1',[ctx.user_id]);await audit(db,ctx.user_id,'password.changed','user',ctx.user_id);
 });
 // Binding and auth_epoch remain intact; credentials never release the browser.
 return {ok:true};
});
app.post('/api/auth/totp',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async(req,reply)=>{
 const ctx=await context(req);csrf(req,ctx);const {code}=z.object({code:z.string().regex(/^\d{6}$/)}).parse(req.body);
 if(ctx.kind!=='ticket'||ctx.user.role!=='ADMIN'||ctx.user.must_change_password)throw new HttpError(403,'Рұқсат жоқ');
 const attempt=(await pool.query(`INSERT INTO private.security_rate_limits(key_hash,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(key_hash) DO UPDATE SET window_start=CASE WHEN private.security_rate_limits.window_start<now()-interval '5 minutes' THEN now() ELSE private.security_rate_limits.window_start END,attempts=CASE WHEN private.security_rate_limits.window_start<now()-interval '5 minutes' THEN 1 ELSE private.security_rate_limits.attempts+1 END RETURNING attempts`,[hash(`totp:${ctx.user_id}`)])).rows[0];if(attempt.attempts>5)throw new HttpError(429,'Кейін қайталаңыз');
 let replacementToken:string|undefined;
 await transaction(async db=>{
  const u=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[ctx.user_id])).rows[0];
  if(String(u.auth_epoch)!==String(ctx.auth_epoch)||!(await db.query('SELECT 1 FROM private.login_tickets WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()',[ctx.id])).rowCount)throw new HttpError(401,'Сессия аяқталды');
  if(!u.admin_totp_secret_encrypted)throw new HttpError(403,'Әкімші TOTP параметрлерін тексеріңіз');
  const c=verifyTotp(decrypt(u.admin_totp_secret_encrypted,config.encryptionKey),code,Number(u.admin_totp_last_counter??-1));if(c===null)throw new HttpError(403,'TOTP коды жарамсыз');
  await db.query('UPDATE private.app_users SET admin_totp_last_counter=$2 WHERE id=$1',[ctx.user_id,c]);
  // The owner's independent TOTP authorizes ONLY their own browser. Students are never auto-approved.
  if(ctx.device.status==='pending') {
   const epoch=(await db.query('SELECT * FROM private.approve_device($1,$2)',[ctx.user_id,ctx.device_id])).rows[0].auth_epoch;
   replacementToken=opaque();
   await db.query('INSERT INTO private.login_tickets(user_id,device_id,token_hash,csrf_token,auth_epoch,mfa_verified,expires_at) VALUES($1,$2,$3,$4,$5,true,now()+interval \'15 minutes\')',[ctx.user_id,ctx.device_id,hash(replacementToken),opaque(),epoch]);
   await audit(db,ctx.user_id,'admin.browser.authorized_by_totp','device',ctx.device_id);
  } else if(ctx.device.status==='approved') await db.query('UPDATE private.login_tickets SET mfa_verified=true WHERE id=$1',[ctx.id]);
  else throw new HttpError(403,'Браузерді қайта тіркеңіз');
 });
 if(replacementToken){setCookie(reply,'ticket',replacementToken,900);return status(reqWithCookie(req,'ticket',replacementToken));}
 return status(req);
});
app.post('/api/proof/challenge',async(req)=>{
 const ctx=await context(req);csrf(req,ctx);
 const data=z.object({method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD']),path:z.string().min(1).max(2048),purpose:z.enum(['api','login','media','file','playback','heartbeat','refresh']),body_hash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(req.body);
 if(!data.path.startsWith('/api/')||data.path.includes('#')||data.path.startsWith('//'))throw new HttpError(400,'Жол жарамсыз');
 if(ctx.kind==='ticket'&&(data.path!=='/api/auth/activate'||data.method!=='POST'||data.purpose!=='login'))throw new HttpError(403,'Алдымен браузерді растаңыз');
 if(ctx.device.status!=='approved')throw new HttpError(403,deniedBrowser);
 if(ctx.user.must_change_password||(ctx.user.role==='ADMIN'&&!ctx.mfa_verified))throw new HttpError(403,'Аккаунт баптауларын аяқтаңыз');
 const {rows}=await pool.query('INSERT INTO private.challenges(user_id,session_id,ticket_id,device_id,purpose,method,path,nonce,auth_epoch,body_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval \'45 seconds\') RETURNING *',[ctx.user_id,ctx.kind==='session'?ctx.id:null,ctx.kind==='ticket'?ctx.id:null,ctx.device_id,data.purpose,data.method,data.path,opaque(),ctx.auth_epoch,data.body_hash||hash('')]);
 return {id:rows[0].id,payload:challengePayload({...rows[0],scope:ctx.id}),expires_at:rows[0].expires_at};
});
app.post('/api/auth/activate',async(req,reply)=>{
 const ctx=await proof(req,'login');if(ctx.kind!=='ticket'||ctx.device.status!=='approved')throw new HttpError(403,deniedBrowser);
 const token=opaque(),csrfToken=opaque();
 await transaction(async db=>{
  const u=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[ctx.user_id])).rows[0];
  if(String(u.auth_epoch)!==String(ctx.auth_epoch)||u.must_change_password||!u.active)throw new HttpError(401,'Сессия аяқталды');
  if(!(await db.query('SELECT 1 FROM private.login_tickets WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() AND auth_epoch=$3',[ctx.id,ctx.user_id,ctx.auth_epoch])).rowCount)throw new HttpError(401,'Сессия аяқталды');
  if(u.role==='ADMIN'&&!ctx.mfa_verified)throw new HttpError(403,'TOTP қажет');
  // Rotation allowed only AFTER proof from the same approved browser, never on password login.
  await db.query('UPDATE private.playback_grants SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[ctx.user_id]);
  await db.query('UPDATE private.app_sessions SET revoked_at=now() WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL',[ctx.user_id,ctx.device_id]);
  await db.query('SELECT private.open_application_session($1,$2,$3,$4,$5,$6,$7)',[ctx.user_id,ctx.device_id,ctx.auth_epoch,hash(token),csrfToken,ctx.mfa_verified,1800]);
  await db.query('UPDATE private.login_tickets SET revoked_at=now() WHERE id=$1',[ctx.id]);await audit(db,ctx.user_id,'session.activated','user',ctx.user_id);
 });
 clearCookie(reply,'ticket');setCookie(reply,'session',token,1800);return status({...reqWithCookie(req,'session',token),cookies:{[`${config.secure?'__Host-':''}uyym_session`]:token}});
});
app.post('/api/auth/refresh',async(req,reply)=>{
 const ctx=await proof(req,'refresh');requireLearning(ctx);
 const changed=await pool.query('UPDATE private.app_sessions SET expires_at=least(created_at+interval \'8 hours\',now()+interval \'30 minutes\'),last_seen_at=now() WHERE id=$1 AND created_at>now()-interval \'8 hours\' AND revoked_at IS NULL RETURNING id',[ctx.id]);
 if(!changed.rowCount)throw new HttpError(401,'Сессия аяқталды');
 // Existing cookie token remains HttpOnly; only the approved key can extend its lifetime.
 const token=req.cookies[`${config.secure?'__Host-':''}uyym_session`]!;setCookie(reply,'session',token,1800);return {ok:true};
});
app.post('/api/auth/logout',async(req,reply)=>{
 const ctx=await context(req);csrf(req,ctx);
 await transaction(async db=>{
  // All per-user security mutations lock the user before sessions/grants. This
  // prevents logout racing an owner block/reset from locking those in reverse.
  await db.query('SELECT id FROM private.app_users WHERE id=$1 FOR UPDATE',[ctx.user_id]);
  await db.query(`UPDATE private.${ctx.kind==='session'?'app_sessions':'login_tickets'} SET revoked_at=now() WHERE id=$1`,[ctx.id]);
  if(ctx.kind==='session')await db.query('UPDATE private.playback_grants SET revoked_at=now() WHERE session_id=$1',[ctx.id]);
  await audit(db,ctx.user_id,'session.logout','user',ctx.user_id);
 });
 clearCookie(reply,'session');clearCookie(reply,'ticket');return {ok:true};
});
app.get('/api/lessons',async(req)=>{
 const ctx=await proof(req);requireLearning(ctx);
 const candidates=(await pool.query('SELECT l.id,l.title,l.description,l.scheduled_at AS starts_at,c.title AS course_title FROM private.lessons l JOIN private.courses c ON c.id=l.course_id WHERE l.published ORDER BY l.scheduled_at NULLS LAST')).rows;
 const lessons=[];for(const l of candidates){try{await lessonAllowed(ctx,l.id);lessons.push(l);}catch(e){if(!(e instanceof HttpError&&e.statusCode===404))throw e;}}
 return {lessons};
});
app.post('/api/lessons/:id/playback',async(req)=>{
 const ctx=await proof(req,'playback');const id=uuid.parse((req.params as any).id);const l=await lessonAllowed(ctx,id);
 const parts=(await pool.query('SELECT part_index,size_bytes,start_seconds,duration_seconds FROM private.lesson_video_parts WHERE lesson_id=$1 ORDER BY part_index',[id])).rows;
 if(!parts.length||parts[0].part_index!==-1||!l.video_duration_seconds)throw new HttpError(409,'Видео әлі дайын емес');
 const g=(await pool.query('INSERT INTO private.playback_grants(user_id,session_id,device_id,lesson_id,auth_epoch,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'10 minutes\') RETURNING id',[ctx.user_id,ctx.id,ctx.device_id,id,ctx.auth_epoch])).rows[0];
 return {grant_id:g.id,duration_seconds:Number(l.video_duration_seconds),mime:`video/mp4; codecs="${l.video_codec}"`,watermark:`${ctx.user.name} · ${ctx.user.phone.slice(0,3)}•••••${ctx.user.phone.slice(-4)}`,parts:parts.map(p=>({index:p.part_index,bytes:Number(p.size_bytes),start:Number(p.start_seconds),duration:Number(p.duration_seconds)}))};
});
async function playback(ctx:any,id:string) {
 const g=(await pool.query('SELECT * FROM private.playback_grants WHERE id=$1 AND user_id=$2 AND session_id=$3 AND device_id=$4 AND auth_epoch=$5 AND revoked_at IS NULL AND expires_at>now() AND heartbeat_at>now()-interval \'35 seconds\'',[id,ctx.user_id,ctx.id,ctx.device_id,ctx.auth_epoch])).rows[0];
 if(!g)throw Object.assign(new HttpError(403,'Видео рұқсаты аяқталды'),{code:'MEDIA_GRANT_EXPIRED',message_ru:'Разрешение на видео истекло. Запустите просмотр снова'});await lessonAllowed(ctx,g.lesson_id);return g;
}
app.post('/api/playback/:id/heartbeat',async(req)=>{
 const ctx=await proof(req,'heartbeat');const id=uuid.parse((req.params as any).id);await playback(ctx,id);
 await pool.query('UPDATE private.playback_grants SET heartbeat_at=now(),expires_at=now()+interval \'10 minutes\' WHERE id=$1 AND revoked_at IS NULL',[id]);return {ok:true};
});
app.get('/api/media/:id',async(req,reply)=>{
 const ctx=await proof(req,'media');const id=uuid.parse((req.params as any).id);const query=z.object({grant:uuid,part:z.coerce.number().int().min(-1)}).parse(req.query);
 const g=await playback(ctx,query.grant);if(g.lesson_id!==id)throw new HttpError(404,'Видео қолжетімсіз');
 const p=(await pool.query('SELECT * FROM private.lesson_video_parts WHERE lesson_id=$1 AND part_index=$2',[id,query.part])).rows[0];if(!p)throw new HttpError(404,'Видео бөлігі табылмады');
 await validateDriveFile(p.drive_file_id,p.drive_folder_id,'part',Number(p.size_bytes));
 // Recheck after external API calls, immediately before issuing a bounded new part.
 const fresh=await context(req);await playback(fresh,query.grant);
 const stream=await streamPart(p.drive_file_id,Number(p.size_bytes));
 try{const finalContext=await context(req);await playback(finalContext,query.grant);}catch(e){stream.destroy();throw e;}
 reply.header('Content-Type','video/mp4').header('Content-Length',String(p.size_bytes)).header('X-Content-Type-Options','nosniff');return reply.send(stream);
});
app.get('/api/admin/device-requests',async(req)=>{
 await admin(req);return {requests:(await pool.query("SELECT d.id,d.label,d.requested_at AS created_at,d.public_key,u.name,u.phone,u.role,EXISTS(SELECT 1 FROM private.device_bindings old WHERE old.user_id=d.user_id AND old.status='approved') AS replacement FROM private.device_bindings d JOIN private.app_users u ON u.id=d.user_id WHERE d.status='pending' ORDER BY d.requested_at")).rows.map(({public_key,...d})=>({...d,key_fingerprint:hash(JSON.stringify(publicJwk(public_key)))}))};
});
async function adminMutation(req:any,fn:(db:import('pg').PoolClient,ctx:any)=>Promise<void>) {
 const ctx=await admin(req);
 await transaction(async db=>{const fresh=await freshManagement(db,req,ctx);await fn(db,fresh);});
}
app.post('/api/admin/devices/:id/approve',async(req)=>{await adminMutation(req,async(db,ctx)=>{await db.query('SELECT * FROM private.approve_device($1,$2)',[ctx.user_id,uuid.parse((req.params as any).id)]);});return {ok:true,relogin_required:true};});
app.post('/api/admin/users/:id/revoke-device',async(req)=>{await adminMutation(req,async(db,ctx)=>{await db.query('SELECT private.revoke_device($1,$2)',[ctx.user_id,uuid.parse((req.params as any).id)]);});return {ok:true};});
registerAccountRoutes(app);
registerAcademicRoutes(app);
registerContentRoutes(app);
registerSubmissionRoutes(app);
registerEngagementRoutes(app);
// Serve only known build files; navigation fallback always returns the fixed index file.
const dist=resolve('dist/client');if(existsSync(dist)) {
 const files:[string,string,string][]=[['/','index.html','text/html; charset=utf-8'],['/brand.png','brand.png','image/png']];
 const assets=resolve(dist,'assets');if(existsSync(assets))for(const name of readdirSync(assets))if(/^[A-Za-z0-9_-]+\.(js|css)$/.test(name)&&statSync(resolve(assets,name)).isFile())files.push([`/assets/${name}`,`assets/${name}`,name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8']);
 for(const [url,file,mime] of files)if(existsSync(resolve(dist,file)))app.get(url,async(_req,reply)=>reply.type(mime).send(createReadStream(resolve(dist,file))));
}
app.setNotFoundHandler((req,reply)=>{
 const path=req.url.split('?')[0];
 if(existsSync(resolve(dist,'index.html'))&&req.method==='GET'&&req.headers.accept?.includes('text/html')&&!path.startsWith('/api/')&&!path.startsWith('/assets/')&&!path.includes('.')&&!path.includes('\\'))return reply.type('text/html; charset=utf-8').send(createReadStream(resolve(dist,'index.html')));
 return reply.code(404).send({error:'Endpoint табылмады'});
});
