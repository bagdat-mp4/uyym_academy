import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {ready,config} from '../server/config.js';
import {pool,transaction,audit} from '../server/db.js';
import {normalizePhone,decrypt,verifyTotp} from '../server/security.js';
import {listDriveFolder,validateDriveFile,validateListedDrivePart} from '../server/drive.js';
import {ask,hidden} from './cli.js';
if(!ready()||!process.stdin.isTTY)throw new Error('Configure server and run this locally in interactive terminal');
const manifestPath=process.argv[2];if(!manifestPath)throw new Error('npm run register-video -- "manifest.json"');
const schema=z.object({version:z.literal(1),codec:z.string().regex(/^avc1\.[0-9a-f]{6},mp4a\.40\.2$/),duration_seconds:z.number().positive(),parts:z.array(z.object({index:z.number().int().min(-1),file:z.string().regex(/^(init\.mp4|part\d{5}\.m4s)$/),drive_file_id:z.string().min(5).optional(),bytes:z.number().int().positive().max(1048576),start:z.number().nonnegative(),duration:z.number().nonnegative().max(4.2)})).min(2)});
const manifest=schema.parse(JSON.parse(readFileSync(manifestPath,'utf8')));
if(manifest.parts[0].index!==-1||manifest.parts[0].duration!==0||manifest.parts.some((p,i)=>i>0&&(p.index!==i-1||p.duration<=0)))throw new Error('Incomplete timeline');
let expected=0;for(const p of manifest.parts.slice(1)){if(Math.abs(p.start-expected)>.05)throw new Error('Timeline gap');expected+=p.duration;}if(Math.abs(expected-manifest.duration_seconds)>.05)throw new Error('Incorrect duration');
const phone=normalizePhone(await ask('Телефон владельца: '));const owner=(await pool.query("SELECT * FROM private.app_users WHERE phone=$1 AND role='ADMIN' AND active",[phone])).rows[0];if(!owner)throw new Error('Owner unavailable');
const code=await hidden('TOTP код: ');
await transaction(async db=>{const u=(await db.query('SELECT * FROM private.app_users WHERE id=$1 FOR UPDATE',[owner.id])).rows[0];const c=verifyTotp(decrypt(u.admin_totp_secret_encrypted,config.encryptionKey),code,Number(u.admin_totp_last_counter??-1));if(c===null)throw new Error('TOTP refused');await db.query('UPDATE private.app_users SET admin_totp_last_counter=$2 WHERE id=$1',[owner.id,c]);});
const course=await ask('course_id: '),group=(await ask('group_id (пусто — все группы этого курса): '))||null,title=await ask('Название реального урока: '),folder=await ask('Drive folder ID из серверного allowlist: '),source=await ask('Source MP4 file ID: ');
const original=await validateDriveFile(source,folder,'source');
const byName=manifest.parts.some(p=>!p.drive_file_id)?await listDriveFolder(folder):new Map<string,any>();
const resolved: Array<{index:number;file:string;drive_file_id:string;bytes:number;start:number;duration:number}>=[];for(const p of manifest.parts){const listed=p.drive_file_id?null:byName.get(p.file),drive_file_id=p.drive_file_id||listed?.id;if(!drive_file_id)throw new Error(`Drive file not found by name: ${p.file}`);if(listed)validateListedDrivePart(listed,folder,p.bytes);else await validateDriveFile(drive_file_id,folder,'part',p.bytes);resolved.push({...p,drive_file_id});}
const lesson=await transaction(async db=>{
 const l=(await db.query("INSERT INTO private.lessons(course_id,group_id,title,description,published,drive_file_id,drive_folder_id,video_mime,video_size,video_duration_seconds,video_codec,drive_checked_at) VALUES($1,$2,$3,'Техникалық POC сабағы',true,$4,$5,'video/mp4',$6,$7,$8,now()) RETURNING id",[course,group,title,source,folder,original.size,manifest.duration_seconds,manifest.codec])).rows[0];
 for(const p of resolved)await db.query('INSERT INTO private.lesson_video_parts(lesson_id,part_index,drive_file_id,drive_folder_id,size_bytes,start_seconds,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)',[l.id,p.index,p.drive_file_id,folder,p.bytes,p.start,p.duration]);
 await audit(db,owner.id,'lesson.published','lesson',l.id,{parts:resolved.length});return l.id;
});
console.info('Published lesson_id:',lesson);await pool.end();
