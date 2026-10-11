import {Readable} from 'node:stream';
import {config} from './config.js';
import {HttpError} from './security.js';

const bucket='uyym-private';
function safePath(path:string){
 const learning=/^learning\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(path);
 const submission=/^submissions\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(path);
 if(!learning&&!submission)throw new HttpError(400,'Файл жолы жарамсыз');
 return path.split('/').map(encodeURIComponent).join('/');
}
function headers(extra:Record<string,string>={}){
 return {apikey:config.serviceKey,authorization:`Bearer ${config.serviceKey}`,...extra};
}
async function request(path:string,init:RequestInit){
 if(!config.supabase||!config.serviceKey)throw new HttpError(503,'Файл қоймасы қосылмаған');
 let response:Response;
 try{response=await fetch(`${config.supabase}/storage/v1/${path}`,{...init,signal:AbortSignal.timeout(30000)});}
 catch{throw new HttpError(503,'Файл қоймасы уақытша қолжетімсіз');}
 if(!response.ok){await response.body?.cancel();throw new HttpError(503,'Файл операциясы орындалмады');}
 return response;
}
export async function uploadPrivateObject(path:string,bytes:Buffer,mime:string){
 const response=await request(`object/${bucket}/${safePath(path)}`,{method:'POST',headers:headers({'content-type':mime,'x-upsert':'false'}),body:bytes as unknown as BodyInit});
 await response.body?.cancel();
}
export async function deletePrivateObject(path:string){
 try{const response=await request(`object/${bucket}/${safePath(path)}`,{method:'DELETE',headers:headers()});await response.body?.cancel();}catch{/* Failed mutations remain visible; cleanup can be retried by an operator. */}
}
export async function downloadPrivateObject(path:string){
 const response=await request(`object/${bucket}/${safePath(path)}`,{method:'GET',headers:headers()});
 if(!response.body)throw new HttpError(503,'Файл мазмұны алынбады');
 return Readable.fromWeb(response.body as any);
}
