import {randomBytes} from 'node:crypto';
import {config,ready} from '../server/config.js';
import {pool,transaction,audit} from '../server/db.js';
import {normalizePhone,opaque,hash,base32,encrypt,verifyTotp} from '../server/security.js';
import {createAuthUser,deleteAuthUser} from '../server/supabase.js';
import {ask,hidden} from './cli.js';
if(!ready()||!process.stdin.isTTY)throw new Error('Configure server .env then run bootstrap in interactive terminal. No HTTP bootstrap endpoint.');
const phone=normalizePhone(await ask('Номер владельца (проверенный): '));const name=await ask('Имя владельца: ');if(!name||name.length>120)throw new Error('Invalid name');
const password=opaque(),secret=base32(randomBytes(20)),codes=Array.from({length:10},()=>opaque());
console.info('Добавьте в локальный authenticator этот TOTP secret (не сохраняйте в лог):',secret);
console.info(`otpauth://totp/UYYM:${encodeURIComponent(phone)}?secret=${secret}&issuer=UYYM&algorithm=SHA1&digits=6&period=30`);
const c=verifyTotp(secret,await hidden('TOTP код из приложения: '),-1);if(c===null)throw new Error('TOTP verification failed; nothing created');
let authId:string|undefined;
try {
 await transaction(async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtext('uyym-bootstrap'))");
  if((await db.query("SELECT 1 FROM private.app_users WHERE role='ADMIN'")).rowCount)throw new Error('An admin already exists; bootstrap refused');
  const auth=await createAuthUser(phone,password);authId=auth.id;if(!authId)throw new Error('Auth identity not created');
  await db.query("INSERT INTO private.app_users(id,phone,name,role,admin_totp_secret_encrypted,admin_totp_last_counter,recovery_hashes) VALUES($1,$2,$3,'ADMIN',$4,$5,$6)",[authId,phone,name,encrypt(secret,config.encryptionKey),c,codes.map(hash)]);
  await audit(db,authId,'admin.bootstrap','user',authId);
 });
 console.info('Создан первый администратор. Одноразовый временный пароль (поменяйте при первом входе):',password);
 console.info('Одноразовые recovery codes. Сохраните офлайн отдельно от .env и БД:');codes.forEach(x=>console.info(x));
 console.info('Секреты показаны один раз. Терминал/скриншоты не публиковать. В БД нет пароля и plaintext recovery codes.');
}catch(e){if(authId)await deleteAuthUser(authId).catch(()=>{});throw e;}finally{await pool.end();}
