import {GoogleAuth} from 'google-auth-library';
import {Readable} from 'node:stream';
import {config} from './config.js';
import {HttpError,assertPartSize} from './security.js';
const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/drive.readonly']});
async function headers() {const client=await auth.getClient();return await client.getRequestHeaders();}
async function request(path:string,extra:Record<string,string>={}) {
 const h=await headers();const token=h.get('authorization');if(!token)throw new HttpError(503,'Drive қосылмаған');
 const response=await fetch(`https://www.googleapis.com/drive/v3/${path}`,{headers:{authorization:token,...extra},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new HttpError(503,'Приват видео уақытша қолжетімсіз');return response;
}
function safeId(id:string) {if(!/^[A-Za-z0-9_-]{5,200}$/.test(id))throw new HttpError(400,'Drive файлы жарамсыз');return id;}
export function validatePermissions(permissions:any[]) {
 if(!Array.isArray(permissions)||!permissions.length||permissions.some(p=>p.type!=='user'||!p.emailAddress||!config.permissionEmails.includes(p.emailAddress.toLowerCase())||p.allowFileDiscovery))throw new HttpError(403,'Drive рұқсаттары Restricted болуы керек');
}
export async function validateDriveFile(fileId:string,folderId:string,kind:'source'|'part'='part',expectedSize?:number) {
 if(!config.folders.includes(folderId)||!config.permissionEmails.length)throw new HttpError(403,'Drive папкасы рұқсат етілмеген');
 const fields='id,mimeType,size,parents,trashed';
 const file=await (await request(`files/${safeId(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`)).json() as any;
 const folder=await (await request(`files/${safeId(folderId)}?fields=id,mimeType,trashed&supportsAllDrives=true`)).json() as any;
 if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||file.trashed||!file.parents?.includes(folderId))throw new HttpError(403,'Видео рұқсат етілген папкада емес');
 for(const id of [folderId,fileId]) {const perms=await(await request(`files/${id}/permissions?fields=permissions(type,emailAddress,role,allowFileDiscovery),nextPageToken&pageSize=100&supportsAllDrives=true`)).json() as any;if(perms.nextPageToken)throw new HttpError(403,'Drive рұқсаттары тексерілмеді');validatePermissions(perms.permissions);}
 const size=Number(file.size);if(!Number.isSafeInteger(size)||size<1)throw new HttpError(403,'Видео көлемі жарамсыз');
 if(kind==='source'&&file.mimeType!=='video/mp4')throw new HttpError(403,'MP4 қажет');
 if(kind==='part'&&!['video/mp4','video/iso.segment','application/octet-stream'].includes(file.mimeType))throw new HttpError(403,'fMP4 бөлігі қажет');
 if(expectedSize!==undefined&&size!==expectedSize)throw new HttpError(403,'Видео өзгерген. Қайта тексеріңіз');
 if(kind==='part')assertPartSize(size);return {size,mime:file.mimeType};
}
export async function streamPart(fileId:string,size:number) {
 assertPartSize(size);
 const response=await request(`files/${safeId(fileId)}?alt=media&supportsAllDrives=true`,{Range:`bytes=0-${size-1}`});
 if(response.status!==206||response.headers.get('content-range')!==`bytes 0-${size-1}/${size}`||!response.body){await response.body?.cancel();throw new HttpError(503,'Drive Range жауабы жарамсыз');}
 const reader=response.body.getReader();
 async function* bounded() {let received=0;try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>size)throw new Error('Drive range exceeded');yield value;}if(received!==size)throw new Error('Truncated Drive range');}finally{await reader.cancel().catch(()=>{});}}
 const stream=Readable.from(bounded());stream.once('close',()=>{reader.cancel().catch(()=>{});});return stream;
}
