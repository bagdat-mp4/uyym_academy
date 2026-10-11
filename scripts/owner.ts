import {config,ready} from '../server/config.js';
import {pool,transaction as dbTransaction,audit} from '../server/db.js';
import {normalizePhone,opaque,hash,verifyTotp,decrypt,encrypt,base32} from '../server/security.js';
import {setPassword} from '../server/supabase.js';
import type {PoolClient} from 'pg';
import {randomBytes} from 'node:crypto';
import {ask,hidden} from './cli.js';
const command=process.argv[2];
if(command==='create-user'||command==='reset-password'){
 console.error(`Команда ${command} отключена. Используйте веб-панель ADMIN → Пользователи. Создание аккаунта и сброс пароля выполняются через журнал операций Auth с проверкой повторов и неопределённых результатов. Восстановление владельца: npm run owner -- recover-admin.`);
 await pool.end();process.exit(1);
}
if(!ready()||!process.stdin.isTTY)throw new Error('Use interactive owner terminal with server .env');
const allowed=['create-group','assign-teacher','enroll','pause','revoke-device','settings','recover-admin'];if(!allowed.includes(command))throw new Error(`Commands: ${allowed.join(', ')}`);
const phone=normalizePhone(await ask('Телефон владельца: '));
const owner=(await pool.query("SELECT * FROM private.app_users WHERE phone=$1 AND role='ADMIN' AND active",[phone])).rows[0];if(!owner)throw new Error('Owner unavailable');
async function ownerTransaction<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T>{
 return dbTransaction(async db=>{
  // Match web management writes: the global lock always precedes actor and
  // target row locks, including offline recovery and TOTP counter updates.
  await db.query('SELECT private.management_lock()');
  const actor=(await db.query("SELECT id FROM private.app_users WHERE id=$1 AND role='ADMIN' AND active FOR UPDATE",[owner.id])).rows[0];if(!actor)throw new Error('Owner unavailable');
  return fn(db);
 });
}
if(command==='recover-admin') {
 const recovery=await hidden('Офлайн recovery code: ');const secret=base32(randomBytes(20));
 console.info('Новый TOTP secret (локально):',secret);
 const counter=verifyTotp(secret,await hidden('Проверьте новый TOTP код: '),-1);if(counter===null)throw new Error('Invalid new TOTP');
 const codes=Array.from({length:10},opaque),password=opaque();
 await ownerTransaction(async db=>{const u=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[owner.id])).rows[0];if(!u.recovery_hashes.includes(hash(recovery)))throw new Error('Recovery refused');await db.query('UPDATE private.app_users SET recovery_hashes=array_remove(recovery_hashes,$2) WHERE id=$1',[owner.id,hash(recovery)]);await db.query('SELECT private.revoke_device($1,$1)',[owner.id]);await setPassword(owner.id,password);await db.query('UPDATE private.app_users SET admin_totp_secret_encrypted=$2,admin_totp_last_counter=$3,recovery_hashes=$4,must_change_password=true WHERE id=$1',[owner.id,encrypt(secret,config.encryptionKey),counter,codes.map(hash)]);await audit(db,owner.id,'admin.recovered','user',owner.id);});
 console.info('Новый временный пароль:',password);console.info('Новые recovery codes (старые отозваны):');codes.forEach(x=>console.info(x));await pool.end();process.exit(0);
}
const code=await hidden('TOTP код владельца: ');
await ownerTransaction(async db=>{const u=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[owner.id])).rows[0];const c=verifyTotp(decrypt(u.admin_totp_secret_encrypted,config.encryptionKey),code,Number(u.admin_totp_last_counter??-1));if(c===null)throw new Error('TOTP refused');await db.query('UPDATE private.app_users SET admin_totp_last_counter=$2 WHERE id=$1',[owner.id,c]);});
try {
 if(command==='create-group') {
  const course=await ask('course_id: '),title=await ask('Название группы: ');await ownerTransaction(async db=>{const g=(await db.query('INSERT INTO private.groups(course_id,title) VALUES($1,$2) RETURNING id',[course,title])).rows[0];await audit(db,owner.id,'group.created','group',g.id);console.info('group_id:',g.id);});
 }else if(command==='assign-teacher') {
  const teacher=await ask('teacher_id: '),group=await ask('group_id: '),manage=(await ask('Разрешить управление доступом группы? yes / no: '))==='yes';
  await ownerTransaction(async db=>{if(!(await db.query("SELECT 1 FROM private.app_users WHERE id=$1 AND role='TEACHER' AND active FOR UPDATE",[teacher])).rowCount)throw new Error('Teacher unavailable');const g=(await db.query('SELECT course_id FROM private.groups WHERE id=$1 FOR UPDATE',[group])).rows[0];if(!g)throw new Error('Group unavailable');await db.query('INSERT INTO private.teacher_assignments(teacher_id,course_id,group_id,can_manage_access,created_by) VALUES($1,$2,$3,$4,$5)',[teacher,g.course_id,group,manage,owner.id]);await audit(db,owner.id,'teacher.assigned','group',group,{teacher_id:teacher,can_manage_access:manage});});
 }else if(command==='enroll') {
  const user=await ask('student user_id: '),group=await ask('group_id: '),start=await ask('Начало ISO UTC (например 2026-10-12T00:00:00Z): '),end=await ask('Окончание ISO UTC: ');if(!Number.isFinite(Date.parse(start))||Date.parse(end)<=Date.parse(start))throw new Error('Invalid dates');
  await ownerTransaction(async db=>{if(!(await db.query("SELECT 1 FROM private.app_users WHERE id=$1 AND role='STUDENT' AND active FOR UPDATE",[user])).rowCount)throw new Error('Student unavailable');const g=(await db.query('SELECT g.course_id FROM private.groups g JOIN private.courses c ON c.id=g.course_id WHERE g.id=$1 AND g.active AND c.active FOR UPDATE OF g',[group])).rows[0];if(!g)throw new Error('Group unavailable');const e=(await db.query("INSERT INTO private.enrollments(user_id,course_id,group_id,status,starts_at,expires_at,created_by) VALUES($1,$2,$3,'active',$4,$5,$6) ON CONFLICT(user_id,course_id) DO UPDATE SET group_id=excluded.group_id,status='active',starts_at=excluded.starts_at,expires_at=excluded.expires_at,revoked_at=NULL,revoked_by=NULL,revocation_reason='',updated_at=now() RETURNING id",[user,g.course_id,group,start,end,owner.id])).rows[0];await db.query('UPDATE private.playback_grants SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND lesson_id IN (SELECT id FROM private.lessons WHERE course_id=$2)',[user,g.course_id]);await audit(db,owner.id,'enrollment.activated','enrollment',e.id,{starts_at:start,expires_at:end});});
 }else if(command==='pause') {
  const enrollment=await ask('enrollment_id: ');await ownerTransaction(async db=>{const e=(await db.query("UPDATE private.enrollments SET status='paused',updated_at=now() WHERE id=$1 RETURNING user_id,course_id",[enrollment])).rows[0];if(!e)throw new Error('Enrollment unavailable');await db.query('UPDATE private.playback_grants SET revoked_at=now() WHERE user_id=$1 AND lesson_id IN (SELECT id FROM private.lessons WHERE course_id=$2)',[e.user_id,e.course_id]);await audit(db,owner.id,'enrollment.paused','enrollment',enrollment);});
 }else if(command==='revoke-device') {
  const user=await ask('user_id: ');await ownerTransaction(async db=>{await db.query('SELECT private.revoke_device($1,$2)',[owner.id,user]);});
 }else if(command==='settings') {
  const whatsapp=await ask('WhatsApp E.164 (пусто — скрыть): '),email=await ask('Настоящий контактный email (пусто — скрыть): ');if(whatsapp)normalizePhone(whatsapp);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Invalid email');await ownerTransaction(async db=>{await db.query('UPDATE private.site_settings SET contacts=contacts||$1::jsonb,updated_at=now(),updated_by=$2 WHERE id=true',[{whatsapp:whatsapp?normalizePhone(whatsapp):'',contact_email:email},owner.id]);await audit(db,owner.id,'site.settings.changed','site',null);});
 }
}finally{await pool.end();}
