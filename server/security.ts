import { createHash, randomBytes, createPublicKey, verify, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
export class HttpError extends Error { constructor(public statusCode:number, message:string) {super(message);} }
export const opaque = () => randomBytes(32).toString('base64url');
export const hash = (value:string|Buffer) => createHash('sha256').update(value).digest('hex');
export function normalizePhone(value:string) {
 const phone = parsePhoneNumberFromString(value, 'KZ');
 if (!phone?.isValid()) throw new HttpError(400,'Телефон нөмірін тексеріңіз');
 return phone.number;
}
export function publicJwk(value:any) {
 if (!value || value.kty !== 'EC' || value.crv !== 'P-256' || typeof value.x !== 'string' || typeof value.y !== 'string' || value.d || Buffer.from(value.x,'base64url').length !==32 || Buffer.from(value.y,'base64url').length !==32) throw new HttpError(400,'Қолдау көрсетілмейтін браузер кілті');
 const jwk = {kty:'EC',crv:'P-256',x:value.x,y:value.y};
 try {createPublicKey({key:jwk,format:'jwk'});} catch {throw new HttpError(400,'Браузер кілті жарамсыз');}
 return jwk;
}
export function verifyProof(jwk:any,payload:string,signature:string) {
 if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
 try {return verify('sha256',Buffer.from(payload),{key:createPublicKey({key:publicJwk(jwk),format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url'));} catch {return false;}
}
export interface ChallengeData {id:string; scope:string; device_id:string; auth_epoch:number|string; purpose:string; method:string; path:string; body_hash:string; nonce:string; issued_at:Date|string; expires_at:Date|string}
export const challengePayload = (c:ChallengeData) => JSON.stringify({v:1,id:c.id,session_id:c.scope,device_id:c.device_id,auth_epoch:String(c.auth_epoch),purpose:c.purpose,method:c.method,path:c.path,body_hash:c.body_hash,nonce:c.nonce,issued_at:new Date(c.issued_at).toISOString(),expires_at:new Date(c.expires_at).toISOString()});
export function encrypt(value:string,keyHex:string) {
 const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);
 return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function decrypt(value:string,keyHex:string) {
 const data=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),data.subarray(0,12));decipher.setAuthTag(data.subarray(-16));
 return Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]).toString('utf8');
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes:Buffer) {let bits=0,v=0,out='';for(const b of bytes){v=(v<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(v >>> (bits-5))&31];bits-=5;}} if(bits)out+=alphabet[(v<<(5-bits))&31];return out;}
function decode32(secret:string) {let bits=0,v=0,out:number[]=[];for(const ch of secret){v=(v<<5)|alphabet.indexOf(ch);bits+=5;if(bits>=8){out.push((v>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function totp(secret:string,counter:number) {const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(counter));const digest=createHmac('sha1',decode32(secret)).update(bytes).digest();const n=digest[digest.length-1]&15;return ((digest.readUInt32BE(n)&0x7fffffff)%1000000).toString().padStart(6,'0');}
export function verifyTotp(secret:string,code:string,lastCounter:number,now=Date.now()) {if(!/^\d{6}$/.test(code))return null;const current=Math.floor(now/30000);for(const c of [current-1,current,current+1])if(c>lastCounter && timingSafeEqual(Buffer.from(totp(secret,c)),Buffer.from(code)))return c;return null;}
export function assertPartSize(size:number) {if(!Number.isSafeInteger(size)||size<1||size>1048576)throw new HttpError(400,'Видео бөлігі 1 MiB шегінен асады');}
export function enrollmentActive(row:{status:string;starts_at:string|Date;expires_at:string|Date},now=Date.now()) {return row.status==='active' && new Date(row.starts_at).getTime()<=now && new Date(row.expires_at).getTime()>now;}
