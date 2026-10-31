import {readFileSync} from 'node:fs';
import {HttpError} from './security.js';

export function backendServiceEmail(){
 try{
  const raw=process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
   ?Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,'base64').toString('utf8')
   :readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','utf8');
  const email=JSON.parse(raw).client_email;
  if(typeof email!=='string'||!email.endsWith('.gserviceaccount.com'))throw new Error();
  return email.toLowerCase();
 }catch{throw new HttpError(503,'Drive backend identity қате');}
}

export function validateOwnerPermissions(permissions:any[],ownerEmail:string){
 const owner=ownerEmail.toLowerCase(),backend=backendServiceEmail();
 if(!Array.isArray(permissions)||permissions.length!==2)throw new HttpError(403,'Drive рұқсаттары қауіпсіз емес');
 let ownerFound=false,backendFound=false;
 for(const permission of permissions){
  const email=typeof permission.emailAddress==='string'?permission.emailAddress.toLowerCase():'';
  if(permission.type!=='user'||permission.allowFileDiscovery||!email)throw new HttpError(403,'Drive рұқсаттары қауіпсіз емес');
  if(email===owner&&permission.role==='owner'&&!ownerFound){ownerFound=true;continue;}
  if(email===backend&&permission.role==='reader'&&!backendFound){backendFound=true;continue;}
  throw new HttpError(403,'Drive рұқсаттары қауіпсіз емес');
 }
 if(!ownerFound||!backendFound)throw new HttpError(403,'Drive backend reader рұқсаты жоқ');
}
