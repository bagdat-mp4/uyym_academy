import { config } from './config.js';
import { HttpError } from './security.js';
async function auth(path:string,method:string,body?:unknown,admin=false) {
 const key=admin?config.serviceKey:config.anonKey;
 const response=await fetch(`${config.supabase}/auth/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new HttpError(401,'Кіру деректерін тексеріңіз немесе әкімшіге хабарласыңыз');
 return response.status===204?{}:response.json();
}
export async function authenticate(phone:string,password:string) {
 const result=await auth('token?grant_type=password','POST',{phone,password});
 // Supabase tokens remain within this server call, are never persisted or returned.
 return result.user?.id as string;
}
export async function createAuthUser(phone:string,password:string) {return auth('admin/users','POST',{phone,password,phone_confirm:true},true);}
export async function setPassword(id:string,password:string) {await auth(`admin/users/${id}`,'PUT',{password},true);}
export async function deleteAuthUser(id:string) {await auth(`admin/users/${id}`,'DELETE',undefined,true);}
