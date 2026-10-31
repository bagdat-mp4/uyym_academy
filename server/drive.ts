import {GoogleAuth} from 'google-auth-library';
import {Readable} from 'node:stream';
import {config} from './config.js';
import {HttpError,assertPartSize} from './security.js';
import type {PlayerTiming} from './player-timing.js';
import {validateOwnerPermissions} from './drive-permissions.js';
const driveCredentials=process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
const auth=new GoogleAuth({
 scopes:['https://www.googleapis.com/auth/drive.readonly'],
 ...(driveCredentials?{credentials:JSON.parse(Buffer.from(driveCredentials,'base64').toString('utf8'))}:{})
});
async function authorization(timing?:PlayerTiming) {
 const get=async()=>{const client=await auth.getClient();const h=await client.getRequestHeaders();const token=h.get('authorization');if(!token)throw new HttpError(503,'Drive қосылмаған');return token;};
 return timing?timing.measure('drive_token',get):get();
}
async function request(path:string,extra:Record<string,string>={},token?:string) {
 token??=await authorization();
 const response=await fetch(`https://www.googleapis.com/drive/v3/${path}`,{headers:{authorization:token,...extra},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new HttpError(503,'Приват видео уақытша қолжетімсіз');return response;
}
function safeId(id:string) {if(!/^[A-Za-z0-9_-]{5,200}$/.test(id))throw new HttpError(400,'Drive файлы жарамсыз');return id;}
export function validatePermissions(permissions:any[]) {
 if(!Array.isArray(permissions)||!permissions.length||permissions.some(p=>p.type!=='user'||!p.emailAddress||!config.permissionEmails.includes(p.emailAddress.toLowerCase())||p.allowFileDiscovery))throw new HttpError(403,'Drive рұқсаттары Restricted болуы керек');
}
export async function validateDriveFile(fileId:string,folderId:string,kind:'source'|'part'|'owner_source'='part',expectedSize?:number,timing?:PlayerTiming) {
 const managed=kind==='owner_source';
 if(!(config.folders.includes(folderId)||managed)||!config.permissionEmails.length)throw new HttpError(403,'Drive папкасы рұқсат етілмеген');
 safeId(fileId);safeId(folderId);
 // Resolve one request-local credential before fan-out (including a cold token
 // refresh). No metadata/permission cache: all four reads run for EVERY part.
 const token=await authorization(timing);
 const fields=kind!=='part'?'id,mimeType,size,parents,trashed,ownedByMe':'id,mimeType,size,parents,trashed';
 const json=async(path:string)=>await(await request(path,{},token)).json() as any;
 const metadata=()=>Promise.all([
  json(`files/${fileId}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`),
  json(`files/${folderId}?fields=id,mimeType,trashed&supportsAllDrives=true`)
 ]);
 const permissions=()=>Promise.all([folderId,fileId].map(id=>json(`files/${id}/permissions?fields=permissions(type,emailAddress,role,allowFileDiscovery),nextPageToken&pageSize=100&supportsAllDrives=true`)));
 const [[file,folder],perms]=await Promise.all([
  timing?timing.measure('drive_metadata',metadata):metadata(),
  timing?timing.measure('drive_permissions',permissions):permissions()
 ]);
 if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||file.trashed||!file.parents?.includes(folderId))throw new HttpError(403,'Видео рұқсат етілген папкада емес');
 for(const result of perms){if(result.nextPageToken)throw new HttpError(403,'Drive рұқсаттары тексерілмеді');if(managed)validateOwnerPermissions(result.permissions,config.driveOwnerEmail);else validatePermissions(result.permissions);}
 const size=Number(file.size);if(!Number.isSafeInteger(size)||size<1)throw new HttpError(403,'Видео көлемі жарамсыз');
 if(kind!=='part'&&file.mimeType!=='video/mp4')throw new HttpError(403,'MP4 қажет');
 if(managed&&!file.ownedByMe)throw new HttpError(403,'Видео иесінің Drive аккаунтына тиесілі емес');
 if(kind==='part'&&!['video/mp4','video/iso.segment','application/octet-stream'].includes(file.mimeType))throw new HttpError(403,'fMP4 бөлігі қажет');
 if(expectedSize!==undefined&&size!==expectedSize)throw new HttpError(403,'Видео өзгерген. Қайта тексеріңіз');
 if(kind==='part')assertPartSize(size);return {size,mime:file.mimeType};
}
export async function listDriveFolder(folderId:string) {
 safeId(folderId);
 if(!config.folders.includes(folderId)||!config.permissionEmails.length)throw new HttpError(403,'Drive папкасы рұқсат етілмеген');
 const folder=await (await request(`files/${folderId}?fields=id,mimeType,trashed&supportsAllDrives=true`)).json() as any;
 if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder')throw new HttpError(403,'Drive папкасы жарамсыз');
 const permissions=await(await request(`files/${folderId}/permissions?fields=permissions(type,emailAddress,role,allowFileDiscovery),nextPageToken&pageSize=100&supportsAllDrives=true`)).json() as any;
 if(permissions.nextPageToken)throw new HttpError(403,'Drive рұқсаттары тексерілмеді');
 validatePermissions(permissions.permissions);
 const q=encodeURIComponent(`'${folderId}' in parents and trashed=false`),byName=new Map<string,any>(),seenTokens=new Set<string>();
 let pageToken='';
 do{
  const suffix=pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:'';
  const result=await(await request(`files?q=${q}&fields=files(id,name,mimeType,size,parents,trashed,permissions(type,emailAddress,role,allowFileDiscovery)),nextPageToken&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${suffix}`)).json() as any;
  for(const file of result.files||[]){if(byName.has(file.name))throw new HttpError(409,'Drive папкасында атауы бірдей файлдар бар');byName.set(file.name,file);if(byName.size>5000)throw new HttpError(409,'Drive папкасында файл тым көп. Арнайы папка қолданыңыз');}
  pageToken=String(result.nextPageToken||'');if(pageToken&&seenTokens.has(pageToken))throw new HttpError(503,'Drive тізімі аяқталмады');if(pageToken)seenTokens.add(pageToken);
 }while(pageToken);
 return byName;
}
export function validateListedDrivePart(file:any,folderId:string,expectedSize:number){
 if(!file||safeId(String(file.id))!==file.id||file.trashed||!file.parents?.includes(folderId))throw new HttpError(403,'Видео рұқсат етілген папкада емес');
 validatePermissions(file.permissions);
 if(!['video/mp4','video/iso.segment','application/octet-stream'].includes(file.mimeType))throw new HttpError(403,'fMP4 бөлігі қажет');
 const size=Number(file.size);if(!Number.isSafeInteger(size)||size!==expectedSize)throw new HttpError(403,'Видео өзгерген. Қайта тексеріңіз');assertPartSize(size);
 return {id:file.id,size,mime:file.mimeType};
}
export async function streamPart(fileId:string,size:number,timing?:PlayerTiming) {
 assertPartSize(size);
 const token=await authorization(timing);
 const get=()=>request(`files/${safeId(fileId)}?alt=media&supportsAllDrives=true`,{Range:`bytes=0-${size-1}`},token);
 const response=await(timing?timing.measure('drive_headers',get):get());
 if(response.status!==206||response.headers.get('content-range')!==`bytes 0-${size-1}/${size}`||!response.body){await response.body?.cancel();throw new HttpError(503,'Drive Range жауабы жарамсыз');}
 const reader=response.body.getReader();
 async function* bounded() {let received=0;const start=performance.now();try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>size)throw new Error('Drive range exceeded');yield value;}if(received!==size)throw new Error('Truncated Drive range');}finally{timing?.add('drive_body',performance.now()-start);await reader.cancel().catch(()=>{});}}
 const stream=Readable.from(bounded());stream.once('close',()=>{reader.cancel().catch(()=>{});});return stream;
}

// Native MP4 requests are always capped to one MiB and individually proved.
export async function streamSourceRange(fileId:string,start:number,end:number,total:number,timing?:PlayerTiming){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!Number.isSafeInteger(total)||start<0||end<start||end>=total)throw new HttpError(416,'Видео ауқымы жарамсыз');
 const size=end-start+1;assertPartSize(size);
 const token=await authorization(timing);
 const response=await request(`files/${safeId(fileId)}?alt=media&supportsAllDrives=true`,{Range:`bytes=${start}-${end}`},token);
 if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${total}`||!response.body){await response.body?.cancel();throw new HttpError(503,'Drive Range жауабы жарамсыз');}
 const reader=response.body.getReader();
 async function* bounded(){let received=0;try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>size)throw new Error('Drive range exceeded');yield value;}if(received!==size)throw new Error('Truncated Drive range');}finally{await reader.cancel().catch(()=>{});}}
 const stream=Readable.from(bounded());stream.once('close',()=>{reader.cancel().catch(()=>{});});return stream;
}
