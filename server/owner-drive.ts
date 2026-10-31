import {OAuth2Client} from 'google-auth-library';
import {readFileSync} from 'node:fs';
import {pool,transaction} from './db.js';
import {config} from './config.js';
import {decrypt,encrypt,hash,HttpError} from './security.js';

const scope=['openid','email','https://www.googleapis.com/auth/drive.file'];
const folderMime='application/vnd.google-apps.folder';
const apiRoot='https://www.googleapis.com/drive/v3/';
const uploadRoot='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,parents,owners(emailAddress),trashed';
const credentialJson=process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

export function ownerDriveConfigured(){
 return Boolean(/^[0-9a-f-]{36}$/i.test(config.driveOwnerUserId)&&config.driveOwnerEmail&&config.driveOAuthClientId&&config.driveOAuthClientSecret&&/^[a-f0-9]{64}$/i.test(config.driveOAuthEncryptionKey)&&(credentialJson||process.env.GOOGLE_APPLICATION_CREDENTIALS));
}
function requireConfigured(){if(!ownerDriveConfigured())throw new HttpError(503,'Drive upload әлі бапталмаған');}
function oauth(){requireConfigured();return new OAuth2Client(config.driveOAuthClientId,config.driveOAuthClientSecret,`${config.origin}/api/drive/oauth/callback`);}
function serviceEmail(){
 try{const raw=credentialJson?Buffer.from(credentialJson,'base64').toString('utf8'):readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','utf8');const email=JSON.parse(raw).client_email;
  if(typeof email!=='string'||!email.endsWith('.gserviceaccount.com'))throw new Error();return email.toLowerCase();
 }catch{throw new HttpError(503,'Drive backend identity қате');}
}
export function authorizationUrl(state:string){return oauth().generateAuthUrl({access_type:'offline',prompt:'consent',scope,state,include_granted_scopes:false});}
export function encryptOAuth(value:string){requireConfigured();return encrypt(value,config.driveOAuthEncryptionKey);}
export function decryptOAuth(value:string){requireConfigured();return decrypt(value,config.driveOAuthEncryptionKey);}

let cachedToken:{key:string;value:string;until:number}|undefined;
async function ownerToken(refreshToken:string){
 const key=hash(refreshToken);
 if(cachedToken?.key===key&&cachedToken.until>Date.now())return cachedToken.value;
 const client=oauth();client.setCredentials({refresh_token:refreshToken});
 try{const result=await client.getAccessToken();if(!result.token)throw new Error();cachedToken={key,value:result.token,until:Math.min(Date.now()+45*60_000,(client.credentials.expiry_date??Date.now()+45*60_000)-60_000)};return result.token;}
 catch{throw new HttpError(503,'Drive байланысы қолжетімсіз');}
}
export async function currentOwnerToken(){
 const row=(await pool.query('SELECT refresh_token_encrypted FROM private.owner_drive_connection WHERE id=true')).rows[0];
 if(!row)throw new HttpError(503,'Drive иесі қосылмаған');return ownerToken(decryptOAuth(row.refresh_token_encrypted));
}
async function driveResponse(path:string,token:string,init:RequestInit={}){
 const response=await fetch(`${apiRoot}${path}`,{...init,headers:{authorization:`Bearer ${token}`,...init.headers},redirect:'manual',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new HttpError(503,'Drive әрекеті орындалмады');return response;
}
async function driveJson(path:string,token:string,init:RequestInit={}){return await(await driveResponse(path,token,init)).json() as any;}
function id(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(value))throw new HttpError(503,'Drive жауабы жарамсыз');return value;}
function safeFolderName(value:string){return value.replace(/[^\p{L}\p{N} ._-]/gu,' ').trim().slice(0,80)||'Course';}

export async function connectOwner(code:string){
 requireConfigured();const client=oauth();let result;
 try{result=await client.getToken(code);}catch{throw new HttpError(503,'Google рұқсатын аяқтау мүмкін болмады');}
 const refresh=result.tokens.refresh_token,idToken=result.tokens.id_token;
 if(!refresh||!idToken)throw new HttpError(503,'Google refresh рұқсаты берілмеді');
 let email='';
 try{const ticket=await client.verifyIdToken({idToken,audience:config.driveOAuthClientId});const payload=ticket.getPayload();if(!payload?.email_verified)throw new Error();email=String(payload.email).toLowerCase();}
 catch{throw new HttpError(403,'Google аккаунтын растау мүмкін болмады');}
 if(email!==config.driveOwnerEmail)throw new HttpError(403,'Бұл иесінің Google аккаунты емес');
 const token=await ownerToken(refresh);
 const backendEmail=serviceEmail();
 if(!config.permissionEmails.includes(email)||!config.permissionEmails.includes(backendEmail))throw new HttpError(503,'Drive рұқсаттар тізімі толық емес');
 const current=(await pool.query('SELECT google_email,root_folder_id FROM private.owner_drive_connection WHERE id=true')).rows[0];
 let root:string;
 if(current){
  if(current.google_email!==email)throw new HttpError(409,'Drive аккаунты бұрын қосылған');
  root=id(current.root_folder_id);
  await checkFolder(root,null,token);
 }else{
  const folder=await driveJson('files?fields=id,mimeType,ownedByMe',token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'UYYM Academy private lessons',mimeType:folderMime})});
  root=id(folder.id);if(!folder.ownedByMe)throw new HttpError(403,'Drive папкасы иесіне тиесілі емес');
  await driveResponse(`files/${root}/permissions?sendNotificationEmail=false&fields=id`,token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'user',role:'reader',emailAddress:backendEmail})});
 }
 await transaction(async db=>{
  await db.query(`INSERT INTO private.owner_drive_connection(id,owner_user_id,google_email,refresh_token_encrypted,root_folder_id)
   VALUES(true,$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET refresh_token_encrypted=excluded.refresh_token_encrypted,updated_at=now()`,[config.driveOwnerUserId,email,encryptOAuth(refresh),root]);
  await db.query(`INSERT INTO private.owner_drive_folders(id,kind) VALUES($1,'root') ON CONFLICT(id) DO NOTHING`,[root]);
 });
 return {connected:true,email};
}

export async function ownerDriveStatus(){
 const row=(await pool.query('SELECT google_email,connected_at,root_folder_id FROM private.owner_drive_connection WHERE id=true')).rows[0];
 if(!row)return {configured:ownerDriveConfigured(),connected:false};
 let quota:Record<string,string>|undefined;
 try{const token=await currentOwnerToken();const about=await driveJson('about?fields=storageQuota(limit,usage,usageInDrive)',token);quota=about.storageQuota;}
 catch{ /* The connection remains recorded; report the status without leaking provider details. */ }
 return {configured:ownerDriveConfigured(),connected:true,email:row.google_email,connected_at:row.connected_at,quota_available:Boolean(quota),quota};
}

async function checkFolder(folderId:string,parentId:string|null,token:string){
 const file=await driveJson(`files/${id(folderId)}?fields=id,mimeType,trashed,parents,ownedByMe`,token);
 if(file.trashed||file.mimeType!==folderMime||!file.ownedByMe||(parentId&&!file.parents?.includes(parentId)))throw new HttpError(403,'Drive папкасы жарамсыз');
}
export async function courseWeekFolder(courseId:string,courseSlug:string,week:number){
 const token=await currentOwnerToken();
 return transaction(async db=>{
  // Serialize folder creation across workers without a global management lock.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('uyym:drive-folders')::bigint)");
  const rootRow=(await db.query("SELECT id FROM private.owner_drive_folders WHERE kind='root'")).rows[0];if(!rootRow)throw new HttpError(503,'Drive папкасы қосылмаған');
  const root=id(rootRow.id);await checkFolder(root,null,token);
  let course=(await db.query("SELECT id FROM private.owner_drive_folders WHERE kind='course' AND course_id=$1",[courseId])).rows[0]?.id as string|undefined;
  if(!course){const created=await driveJson('files?fields=id,mimeType,ownedByMe,parents',token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:safeFolderName(courseSlug),mimeType:folderMime,parents:[root]})});course=id(created.id);if(created.mimeType!==folderMime||!created.ownedByMe||!created.parents?.includes(root))throw new HttpError(403,'Drive папкасы жарамсыз');await db.query("INSERT INTO private.owner_drive_folders(id,parent_id,course_id,kind) VALUES($1,$2,$3,'course')",[course,root,courseId]);}
  else await checkFolder(course,root,token);
  let folder=(await db.query("SELECT id FROM private.owner_drive_folders WHERE kind='week' AND course_id=$1 AND week=$2",[courseId,week])).rows[0]?.id as string|undefined;
  if(!folder){const created=await driveJson('files?fields=id,mimeType,ownedByMe,parents',token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:`Week ${String(week).padStart(2,'0')}`,mimeType:folderMime,parents:[course]})});folder=id(created.id);if(created.mimeType!==folderMime||!created.ownedByMe||!created.parents?.includes(course))throw new HttpError(403,'Drive папкасы жарамсыз');await db.query("INSERT INTO private.owner_drive_folders(id,parent_id,course_id,week,kind) VALUES($1,$2,$3,$4,'week')",[folder,course,courseId,week]);}
  else await checkFolder(folder,course,token);
  return folder;
 });
}

function sessionUrl(value:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.hostname!=='www.googleapis.com'||url.pathname!=='/upload/drive/v3/files'||url.username||url.password||url.hash)throw new HttpError(503,'Drive upload session жарамсыз');
 return url.href;
}
export async function startResumable(folderId:string,name:string,size:number){
 const token=await currentOwnerToken();
 const response=await fetch(uploadRoot,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-upload-content-type':'video/mp4','x-upload-content-length':String(size)},body:JSON.stringify({name,mimeType:'video/mp4',parents:[id(folderId)]}),redirect:'manual',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new HttpError(503,'Drive жүктеуін бастау мүмкін болмады');
 const location=response.headers.get('location');if(!location)throw new HttpError(503,'Drive жүктеу сілтемесі жоқ');
 return sessionUrl(location);
}
export function resumableOffset(range:string|null,size:number){
 if(!range)return 0;const match=/^bytes=0-(\d+)$/.exec(range);if(!match)throw new HttpError(503,'Drive upload range жарамсыз');
 const next=Number(match[1])+1;if(!Number.isSafeInteger(next)||next>=size)throw new HttpError(503,'Drive upload offset жарамсыз');return next;
}
async function sessionRequest(uri:string,size:number,bytes?:Buffer,start?:number){
 const url=sessionUrl(uri),token=await currentOwnerToken();
 const headers:Record<string,string>={authorization:`Bearer ${token}`,'content-range':bytes?`bytes ${start}-${start!+bytes.length-1}/${size}`:`bytes */${size}`};
 if(bytes)headers['content-type']='video/mp4';
 const response=await fetch(url,{method:'PUT',headers,body:bytes?new Uint8Array(bytes):undefined,redirect:'manual',signal:AbortSignal.timeout(60000)});
 if(response.status===308)return {offset:resumableOffset(response.headers.get('range'),size),complete:false as const};
 if(response.status===200||response.status===201){const file=await response.json() as any;return {offset:size,complete:true as const,file_id:id(file.id)};}
 if(response.status===404||response.status===410)throw new HttpError(409,'Drive жүктеу мерзімі аяқталды. Қайта бастаңыз');
 throw new HttpError(503,'Drive жүктеу уақытша қолжетімсіз');
}
export async function uploadChunk(uri:string,size:number,bytes:Buffer,start:number){return sessionRequest(uri,size,bytes,start);}
export async function queryUpload(uri:string,size:number){return sessionRequest(uri,size);}
export async function verifyOwnerFile(fileId:string,folderId:string,size:number){
 const token=await currentOwnerToken();
 const file=await driveJson(`files/${id(fileId)}?fields=id,mimeType,size,parents,trashed,ownedByMe,permissions(type,emailAddress,allowFileDiscovery)&supportsAllDrives=true`,token);
 if(file.trashed||file.mimeType!=='video/mp4'||Number(file.size)!==size||!file.parents?.includes(folderId)||!file.ownedByMe)throw new HttpError(403,'Drive видео тексерілмеді');
 const permissions=await driveJson(`files/${id(fileId)}/permissions?fields=permissions(type,emailAddress,allowFileDiscovery),nextPageToken&pageSize=100`,token);
 if(permissions.nextPageToken||!Array.isArray(permissions.permissions)||permissions.permissions.some((p:any)=>p.type!=='user'||!p.emailAddress||p.allowFileDiscovery||!config.permissionEmails.includes(String(p.emailAddress).toLowerCase())))throw new HttpError(403,'Drive рұқсаты қауіпсіз емес');
 return file;
}
