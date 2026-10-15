import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleAuth} from 'google-auth-library';
import {PlayerTiming} from '../server/player-timing.js';
import {resolve} from 'node:path';

let drive:typeof import('../server/drive.js'),calls:string[]=[],tokens=0;
const originalFetch=globalThis.fetch,originalClient=GoogleAuth.prototype.getClient;
const folder='LOCAL_TEST_FOLDER',file='LOCAL_TEST_FILE',size=16;
let mode='valid',gate:Promise<void>|undefined,entered:(()=>void)|undefined,cancelled=false;
before(async()=>{
 Object.assign(process.env,{DOTENV_CONFIG_PATH:resolve('work/nonexistent-drive-test.env'),GOOGLE_APPLICATION_CREDENTIALS_BASE64:'',DRIVE_ALLOWED_FOLDER_IDS:folder,DRIVE_ALLOWED_PERMISSION_EMAILS:'test@example.invalid'});
 (GoogleAuth.prototype as any).getClient=async()=>({getRequestHeaders:async()=>{tokens++;return new Headers({authorization:'Bearer TEST_ONLY'});}});
 globalThis.fetch=async(input,init)=>{
  const u=new URL(String(input));assert.equal(u.origin,'https://www.googleapis.com');const id=u.pathname.split('/')[4];
  const kind=u.searchParams.get('alt')==='media'?'media':u.pathname.endsWith('/permissions')?'permissions':'metadata';calls.push(`${id===folder?'folder':'file'}:${kind}`);
  if(kind!=='media'){if(calls.length===4)entered?.();await gate;}
  if(mode==='unavailable')return new Response(null,{status:503});
  if(kind==='permissions')return Response.json(mode==='pagination'?{permissions:[],nextPageToken:'test-page'}:{permissions:[mode==='public'&&id===file?{type:'anyone'}:{type:'user',emailAddress:'test@example.invalid'}]});
  if(kind==='media'){
   assert.equal(new Headers(init?.headers).get('Range'),`bytes=0-${size-1}`);
   return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(mode==='oversized'?size+1:mode==='truncated'?size-1:size));c.close();},cancel(){cancelled=true;}}),{status:mode==='whole-file'?200:206,headers:{'content-range':`bytes 0-${size-1}/${size}`}});
  }
  return Response.json(id===folder?{mimeType:'application/vnd.google-apps.folder',trashed:mode==='trashed'}:{mimeType:mode==='wrong-mime'?'text/html':'video/mp4',size:mode==='changed'?size+1:size,parents:[mode==='foreign'?'FOREIGN_FOLDER':folder],trashed:false});
 };
 drive=await import('../server/drive.js');
});
after(()=>{globalThis.fetch=originalFetch;GoogleAuth.prototype.getClient=originalClient;});

test('all four fresh Drive checks overlap, share one token acquisition and precede media',async()=>{
 let release!:()=>void;gate=new Promise(r=>release=r);const fourEntered=new Promise<void>(r=>entered=r);calls=[];tokens=0;mode='valid';
 const timing=new PlayerTiming();const validation=drive.validateDriveFile(file,folder,'part',size,timing);
 try{await Promise.race([fourEntered,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Drive checks are serialized')),1000))]);assert.equal(calls.length,4);assert.ok(!calls.some(x=>x.endsWith(':media')));assert.equal(tokens,1);}finally{release();gate=undefined;entered=undefined;}
 assert.deepEqual(await validation,{size,mime:'video/mp4'});
 assert.deepEqual(calls.sort(),['file:metadata','file:permissions','folder:metadata','folder:permissions']);
 assert.match(timing.header(),/drive_token;dur=\d/);assert.match(timing.header(),/drive_metadata;dur=\d/);assert.match(timing.header(),/drive_permissions;dur=\d/);
 calls=[];await drive.validateDriveFile(file,folder,'part',size);assert.equal(calls.length,4,'a second part must not reuse metadata or ACLs');
});

test('changed/public/foreign/unchecked Drive data fails closed without fetching any media',async()=>{
 for(mode of ['public','pagination','unavailable','trashed','foreign','changed','wrong-mime']){
  calls=[];await assert.rejects(drive.validateDriveFile(file,folder,'part',size));assert.equal(calls.length,4);assert.ok(!calls.some(x=>x.endsWith(':media')));
 }
 mode='valid';calls=[];await assert.rejects(drive.validateDriveFile(file,'UNLISTED_FOLDER','part',size));assert.equal(calls.length,0);
});

test('Drive part remains bounded and validates Range and exact body length',async()=>{
 mode='valid';const timing=new PlayerTiming(),stream=await drive.streamPart(file,size,timing);let bytes=0;for await(const chunk of stream)bytes+=chunk.length;assert.equal(bytes,size);assert.ok('drive_body' in timing.snapshot());
 for(mode of ['oversized','truncated']){const stream=await drive.streamPart(file,size);await assert.rejects(async()=>{for await(const _ of stream){/* Drain test body. */}});}
 mode='whole-file';cancelled=false;await assert.rejects(drive.streamPart(file,size));assert.equal(cancelled,true);
});

test('timing headers contain fixed numeric names only',async()=>{
 let now=0;const timing=new PlayerTiming(()=>now);await timing.measure('access',async()=>{now=12.34;});timing.add('access',2);timing.add('access',NaN);
 assert.equal(timing.header(),'access;dur=14.3');assert.deepEqual(timing.snapshot(),{access:14.3});
});
