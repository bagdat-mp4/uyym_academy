import { config } from './config.js';
import { HttpError } from './security.js';
export class AuthAdminError extends Error {constructor(public code:string,public uncertain:boolean){super(code);}}
export function authHeaders(key:string):Record<string,string> {
 const headers:Record<string,string>={apikey:key,'Content-Type':'application/json'};
 // New Supabase sb_* API keys are not JWTs. The legacy keys still need Bearer.
 if(!/^sb_(?:secret|publishable)_/.test(key))headers.Authorization=`Bearer ${key}`;
 return headers;
}
async function auth(path:string,method:string,body?:unknown,admin=false) {
 const key=admin?config.serviceKey:config.anonKey;
 const headers=authHeaders(key);
 let response:Response;
 try {response=await fetch(`${config.supabase}/auth/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch {if(admin)throw new AuthAdminError('AUTH_NETWORK',true);throw new HttpError(503,'Auth қызметі уақытша қолжетімсіз');}
 if(!response.ok){if(admin)throw new AuthAdminError(response.status===404?'AUTH_NOT_FOUND':response.status===422||response.status===409?'AUTH_CONFLICT':response.status===429?'AUTH_RATE_LIMIT':'AUTH_REJECTED',response.status>=500);throw new HttpError(401,'Кіру деректерін тексеріңіз немесе әкімшіге хабарласыңыз');}
 return response.status===204?{}:response.json();
}
export async function authenticate(phone:string,password:string) {
 const result=await auth('token?grant_type=password','POST',{phone,password});
 // Supabase tokens remain within this server call, are never persisted or returned.
 return result.user?.id as string;
}
export async function createAuthUser(phone:string,password:string,id?:string,operationId?:string) {return auth('admin/users','POST',{phone,password,phone_confirm:true,...(id?{id}:{}),...(operationId?{app_metadata:{uyym_operation:operationId}}:{})},true);}
export async function getAuthUser(id:string){return auth(`admin/users/${id}`,'GET',undefined,true);}
export async function setPassword(id:string,password:string,operationId?:string) {await auth(`admin/users/${id}`,'PUT',{password,...(operationId?{app_metadata:{uyym_password_operation:operationId}}:{})},true);}
export async function deleteAuthUser(id:string) {await auth(`admin/users/${id}`,'DELETE',undefined,true);}
