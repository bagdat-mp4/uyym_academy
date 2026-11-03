import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleAuth} from 'google-auth-library';
const previousFetch=globalThis.fetch,previousClient=GoogleAuth.prototype.getClient;
Object.assign(process.env,{NODE_ENV:'test',UYYM_UI_DRIVE_STAGING:'1',DRIVE_OWNER_EMAIL:'owner@example.invalid',DRIVE_ALLOWED_PERMISSION_EMAILS:'owner@example.invalid,reader@fixture.gserviceaccount.com',DRIVE_ALLOWED_FOLDER_IDS:'FOLDER_12345'});
(GoogleAuth.prototype as any).getClient=async()=>({getRequestHeaders:async()=>new Headers({authorization:'Bearer SERVICE_FIXTURE'})});
const {validateDriveFile}=await import('../server/drive.js');
const {setStagingDriveDiagnosticSink}=await import('../server/staging-drive-diagnostics.js');
const seen:string[]=[],diagnostics:string[]=[];let fail='';
setStagingDriveDiagnosticSink(line=>diagnostics.push(line));
globalThis.fetch=async(input,init)=>{
 const url=new URL(String(input)),auth=new Headers(init?.headers).get('authorization');assert.equal(auth,'Bearer SERVICE_FIXTURE');
 const isFile=url.pathname.includes('/FILE_12345'),isFolder=url.pathname.includes('/FOLDER_12345');
 const isAcl=url.pathname.endsWith('/permissions'),isMedia=url.searchParams.get('alt')==='media';
 const operation=isMedia?'reader_media':isAcl?(isFile?'reader_file_acl':'reader_folder_acl'):(isFile?'reader_file_metadata':'reader_folder_metadata');
 seen.push(operation);
 if(operation===fail)return Response.json({error:{errors:[{reason:'insufficientFilePermissions'}]}},{status:403});
 if(isMedia){assert.equal(new Headers(init?.headers).get('range'),'bytes=0-0');return new Response(new Uint8Array([0]),{status:206,headers:{'content-range':'bytes 0-0/123'}});}
 if(isAcl)return Response.json({permissions:[{type:'user',emailAddress:'owner@example.invalid',role:'owner'},{type:'user',emailAddress:'reader@fixture.gserviceaccount.com',role:'reader'}]});
 if(isFile)return Response.json({id:'FILE_12345',mimeType:'video/mp4',size:'123',parents:['FOLDER_12345'],owners:[{emailAddress:'owner@example.invalid'}],trashed:false});
 if(isFolder)return Response.json({id:'FOLDER_12345',mimeType:'application/vnd.google-apps.folder',trashed:false});
 throw Error('unexpected Drive request');
};
test('owner-managed file requires reader metadata and one media byte without reader ACL enumeration',async()=>{
 try{
  await validateDriveFile('FILE_12345','FOLDER_12345','owner_source',123);
  assert.deepEqual(seen.sort(),['reader_file_metadata','reader_folder_metadata','reader_media']);
  for(const operation of ['reader_file_metadata','reader_folder_metadata','reader_media']){
   seen.length=0;diagnostics.length=0;fail=operation;
   await assert.rejects(validateDriveFile('FILE_12345','FOLDER_12345','owner_source',123),(error:any)=>error.statusCode===503);
   assert.ok(diagnostics.some(line=>JSON.parse(line).operation===operation&&JSON.parse(line).status===403&&JSON.parse(line).provider_reason==='insufficientFilePermissions'));
   assert.ok(!seen.includes('reader_file_acl')&&!seen.includes('reader_folder_acl'));
  }
  for(const operation of ['reader_file_acl','reader_folder_acl']){
   seen.length=0;diagnostics.length=0;fail=operation;
   await assert.rejects(validateDriveFile('FILE_12345','FOLDER_12345','source',123),(error:any)=>error.statusCode===503);
   assert.ok(diagnostics.some(line=>JSON.parse(line).operation===operation&&JSON.parse(line).status===403));
  }
 }finally{globalThis.fetch=previousFetch;GoogleAuth.prototype.getClient=previousClient;}
});
