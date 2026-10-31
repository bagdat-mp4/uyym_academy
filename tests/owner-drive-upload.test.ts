import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let ownerDrive:typeof import('../server/owner-drive.js');

before(async()=>{
 Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://owner-drive-fixture.example',DRIVE_OWNER_EMAIL:'owner@example.invalid',DRIVE_OWNER_USER_ID:'123e4567-e89b-42d3-a456-426614174000',DRIVE_OAUTH_CLIENT_ID:'fixture-client',DRIVE_OAUTH_CLIENT_SECRET:'fixture-secret',DRIVE_OAUTH_ENCRYPTION_KEY:'cd'.repeat(32),DRIVE_ALLOWED_PERMISSION_EMAILS:'owner@example.invalid,reader@fixture.gserviceaccount.com',GOOGLE_APPLICATION_CREDENTIALS_BASE64:Buffer.from(JSON.stringify({client_email:'reader@fixture.gserviceaccount.com'})).toString('base64')});
 ownerDrive=await import('../server/owner-drive.js');
});

test('Drive resumable upload offset only accepts contiguous acknowledged byte ranges',()=>{
 assert.equal(ownerDrive.resumableOffset(null,1048576),0);
 assert.equal(ownerDrive.resumableOffset('bytes=0-262143',1048576),262144);
 for(const value of ['bytes=0-1048575','bytes=100-200','bytes=0-1048576','bytes=0-nope','0-100'])assert.throws(()=>ownerDrive.resumableOffset(value,1048576));
});

test('owner-managed Drive permissions require the exact owner and backend-reader roles',()=>{
 const owner='owner@example.invalid',reader='reader@fixture.gserviceaccount.com';
 assert.doesNotThrow(()=>ownerDrive.validateOwnerPermissions([{type:'user',emailAddress:owner,role:'owner'},{type:'user',emailAddress:reader,role:'reader'}]));
 for(const permissions of [
  [{type:'user',emailAddress:owner,role:'owner'}],
  [{type:'user',emailAddress:owner,role:'owner'},{type:'user',emailAddress:reader,role:'writer'}],
  [{type:'user',emailAddress:owner,role:'reader'},{type:'user',emailAddress:reader,role:'reader'}],
  [{type:'user',emailAddress:owner,role:'owner'},{type:'anyone',role:'reader'}],
  [{type:'user',emailAddress:owner,role:'owner'},{type:'user',emailAddress:reader,role:'reader'},{type:'user',emailAddress:'other@example.invalid',role:'reader'}],
 ])assert.throws(()=>ownerDrive.validateOwnerPermissions(permissions));
});

test('native media path signs each bounded request; uploaded data stays server-owned',()=>{
 const sw=readFileSync(new URL('../client/public/native-video-sw.js',import.meta.url),'utf8');
 const routes=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
 assert.match(sw,/start\+MAX_PART-1/);assert.match(sw,/crypto\.subtle\.sign/);
 assert.match(sw,/purpose:'media'/);assert.match(routes,/proof\(req,'media'\)/);
 assert.match(routes,/await validateDriveFile\(l\.drive_file_id,l\.drive_folder_id,'owner_source',size\)/);
 assert.match(routes,/await playback\(final,query\.grant\)/);
 assert.doesNotMatch(sw,/drive\.google\.com|www\.googleapis\.com|refresh_token/);
});
