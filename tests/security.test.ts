import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {hash,publicJwk,verifyProof,challengePayload,encrypt,decrypt,totp,verifyTotp,enrollmentActive,normalizePhone,assertPartSize} from '../server/security.js';
test('WebCrypto nonextractable P-256 proof verifies in Node and binds endpoint/body/session/nonce',async()=>{
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 await assert.rejects(()=>webcrypto.subtle.exportKey('jwk',keys.privateKey));
 const jwk=publicJwk(await webcrypto.subtle.exportKey('jwk',keys.publicKey));
 const c={id:'a',scope:'session1',device_id:'device1',auth_epoch:1,purpose:'media',method:'GET',path:'/api/media/lesson?grant=x&part=1',body_hash:hash(''),nonce:'nonce1',issued_at:new Date(),expires_at:new Date(Date.now()+45000)};
 const payload=challengePayload(c),sig=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,Buffer.from(payload))).toString('base64url');
 assert.equal(verifyProof(jwk,payload,sig),true);
 for(const field of ['path','scope','purpose','nonce','body_hash'] as const)assert.equal(verifyProof(jwk,challengePayload({...c,[field]:c[field]+'changed'}),sig),false);
 const foreign=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);assert.equal(verifyProof(await webcrypto.subtle.exportKey('jwk',foreign.publicKey),payload,sig),false);
 assert.equal(verifyProof(jwk,payload,sig.slice(0,-1)),false);
});
test('Reject private/wrong curve/malformed supplied keys',()=>{assert.throws(()=>publicJwk({kty:'EC',crv:'P-384',x:'a',y:'b'}));assert.throws(()=>publicJwk({kty:'EC',crv:'P-256',x:'a',y:'b',d:'secret'}));});
test('TOTP RFC6238 vector, replay counter and authenticated encryption',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';assert.equal(totp(secret,1),'287082');assert.equal(verifyTotp(secret,'287082',0,59000),1);assert.equal(verifyTotp(secret,'287082',1,59000),null);
 const key='ab'.repeat(32),encrypted=encrypt(secret,key);assert.equal(decrypt(encrypted,key),secret);const corrupt=Buffer.from(encrypted,'base64url');corrupt[20]^=1;assert.throws(()=>decrypt(corrupt.toString('base64url'),key));
});
test('Enrollment interval is checked server-side independent of stale page; E.164 and size bounds',()=>{
 const row={status:'active',starts_at:'2026-10-10T00:00:00Z',expires_at:'2026-10-11T00:00:00Z'};assert.equal(enrollmentActive(row,Date.parse('2026-10-10T01:00:00Z')),true);assert.equal(enrollmentActive(row,Date.parse(row.expires_at)),false);assert.equal(enrollmentActive({...row,status:'paused'},Date.parse('2026-10-10T01:00:00Z')),false);
 assert.equal(normalizePhone('8 (701) 123-45-67'),'+77011234567');assert.throws(()=>normalizePhone('123'));assertPartSize(1048576);assert.throws(()=>assertPartSize(1048577));
});
