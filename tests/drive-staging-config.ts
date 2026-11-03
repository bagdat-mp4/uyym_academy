export const STAGING_ORIGIN='http://localhost:5174';
export const STAGING_DATABASE_URL='postgresql://unused@127.0.0.1:1/postgres';
export const STAGING_ROOT_NAME='UYYM Academy STAGING - Teacher MP4 Test';
export const STAGING_SERVICE_ACCOUNT_EMAIL='uyym-staging-reader@uyym-academy-drive.iam.gserviceaccount.com';

export type DriveStagingInput={
 enabled:string|undefined;
 nodeEnv:string|undefined;
 ownerEmail:string|undefined;
 clientId:string|undefined;
 clientSecret:string|undefined;
 encryptionKey:string|undefined;
 serviceAccountBase64:string|undefined;
};

export function validateStagingServiceAccount(text:string){
 let value:any;
 try{value=JSON.parse(text);}catch{throw new Error('STAGING_SERVICE_ACCOUNT_JSON_INVALID');}
 if(value?.type!=='service_account'||typeof value.client_email!=='string'||value.client_email.trim().toLowerCase()!==STAGING_SERVICE_ACCOUNT_EMAIL||value.token_uri!=='https://oauth2.googleapis.com/token'||typeof value.private_key!=='string'||!value.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))throw new Error('STAGING_SERVICE_ACCOUNT_REJECTED');
 return value.client_email.toLowerCase() as string;
}

export function validateDriveStagingInput(input:DriveStagingInput){
 if(input.enabled!=='1'||input.nodeEnv==='production')throw new Error('STAGING_MODE_REQUIRED');
 if(!input.ownerEmail||!/^\S+@\S+\.\S+$/.test(input.ownerEmail))throw new Error('STAGING_OWNER_EMAIL_INVALID');
 if(!input.clientId||!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(input.clientId))throw new Error('STAGING_OAUTH_CLIENT_ID_INVALID');
 if(!input.clientSecret||input.clientSecret.length>512||/[\r\n\0]/.test(input.clientSecret))throw new Error('STAGING_OAUTH_CLIENT_SECRET_INVALID');
 if(!input.encryptionKey||!/^[a-f0-9]{64}$/i.test(input.encryptionKey))throw new Error('STAGING_OAUTH_ENCRYPTION_KEY_INVALID');
 if(!input.serviceAccountBase64||input.serviceAccountBase64.length>32768||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.serviceAccountBase64))throw new Error('STAGING_SERVICE_ACCOUNT_ENCODING_REJECTED');
 const serviceAccountJson=Buffer.from(input.serviceAccountBase64,'base64').toString('utf8');
 if(Buffer.from(serviceAccountJson,'utf8').toString('base64')!==input.serviceAccountBase64)throw new Error('STAGING_SERVICE_ACCOUNT_ENCODING_REJECTED');
 const serviceAccountEmail=validateStagingServiceAccount(serviceAccountJson);
 return {ownerEmail:input.ownerEmail.trim().toLowerCase(),clientId:input.clientId.trim(),clientSecret:input.clientSecret,serviceAccountBase64:input.serviceAccountBase64,serviceAccountEmail};
}

export function allowedStagingDriveUrl(value:string){
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&url.origin==='https://www.googleapis.com'&&(url.pathname.startsWith('/drive/v3/')||url.pathname==='/upload/drive/v3/files')&&!url.username&&!url.password&&!url.hash;
 }catch{return false;}
}

export function allowedStagingDriveRedirectUrl(value:string){
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.hash)return false;
  if(url.origin==='https://www.googleapis.com')return url.pathname.startsWith('/download/drive/v3/');
  if(url.origin==='https://drive.usercontent.google.com')return url.pathname==='/download';
  if(url.origin==='https://drive.google.com')return url.pathname==='/uc';
  return /^[a-z0-9-]+\.googleusercontent\.com$/i.test(url.hostname);
 }catch{return false;}
}

export function allowedStagingGoogleAuthUrl(value:string,method:string){
 try{
  const url=new URL(value),verb=method.toUpperCase();
  if(url.protocol!=='https:'||url.username||url.password||url.hash)return false;
  if(url.origin==='https://oauth2.googleapis.com')return url.pathname==='/token'&&verb==='POST';
  return url.origin==='https://www.googleapis.com'&&['/oauth2/v1/certs','/oauth2/v3/certs'].includes(url.pathname)&&verb==='GET';
 }catch{return false;}
}
