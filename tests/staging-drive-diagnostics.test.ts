import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stagingDriveDiagnostic,safeStagingProviderReason} from '../server/staging-drive-diagnostics.js';
const env={NODE_ENV:'test',UYYM_UI_DRIVE_STAGING:'1'};
test('Drive diagnostics expose only fixed checks, route templates and numeric status',()=>{
 const lines:string[]=[];const write=(line:string)=>lines.push(line);
 stagingDriveDiagnostic('api',503,new Error('Drive upload session жарамсыз'),'/api/teacher/video-uploads/:id/sync',env,write);
 assert.deepEqual(JSON.parse(lines[0]),{event:'staging_drive_diagnostic',operation:'api',check:'session_url_rejected',status:503,route:'upload_sync'});
 stagingDriveDiagnostic('upload_sync',308,undefined,undefined,env,write);
 assert.equal(JSON.parse(lines[1]).status,308);
 const secret='synthetic-secret-token-and-private-file-id';
 stagingDriveDiagnostic('api',503,Object.assign(new Error(secret),{url:secret,headers:{authorization:secret},body:secret}),'/api/'+secret,env,write);
 assert.ok(!lines.join('').includes(secret));assert.equal(JSON.parse(lines[2]).check,'unclassified_failure');
 stagingDriveDiagnostic(secret as any,503,undefined,undefined,env,write);
 assert.equal(lines.length,3);
});
test('Drive diagnostics are disabled outside explicit staging and cannot break requests',()=>{
 const lines:string[]=[];
 for(const disabled of [{NODE_ENV:'production',UYYM_UI_DRIVE_STAGING:'1'},{NODE_ENV:'test'},{NODE_ENV:'development',UYYM_UI_DRIVE_STAGING:'1'}])stagingDriveDiagnostic('api',503,undefined,undefined,disabled,line=>lines.push(line));
 assert.equal(lines.length,0);
 assert.doesNotThrow(()=>stagingDriveDiagnostic('api',503,undefined,undefined,env,()=>{throw new Error('disk unavailable');}));
 stagingDriveDiagnostic('api',NaN,new DOMException('sensitive','TimeoutError'),undefined,env,line=>lines.push(line));
 assert.equal(JSON.parse(lines[0]).check,'request_timeout');assert.ok(!('status' in JSON.parse(lines[0])));
});

test('provider reasons are strictly allowlisted and arbitrary provider text is rejected',()=>{assert.equal(safeStagingProviderReason('insufficientFilePermissions'),'insufficientFilePermissions');assert.equal(safeStagingProviderReason('private file id token'),undefined);assert.equal(safeStagingProviderReason({reason:'accessNotConfigured'}),undefined);});
