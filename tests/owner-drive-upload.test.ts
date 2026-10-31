import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resumableOffset} from '../server/owner-drive.js';
import {readFileSync} from 'node:fs';

test('Drive resumable upload offset only accepts contiguous acknowledged byte ranges',()=>{
 assert.equal(resumableOffset(null,1048576),0);
 assert.equal(resumableOffset('bytes=0-262143',1048576),262144);
 for(const value of ['bytes=0-1048575','bytes=100-200','bytes=0-1048576','bytes=0-nope','0-100'])assert.throws(()=>resumableOffset(value,1048576));
});

test('native media path signs each bounded request; uploaded data stays server-owned',()=>{
 const sw=readFileSync(new URL('../client/public/native-video-sw.js',import.meta.url),'utf8');
 const routes=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
 assert.match(sw,/start\+MAX_PART-1/);assert.match(sw,/crypto\.subtle\.sign/);
 assert.match(sw,/purpose:'media'/);assert.match(routes,/proof\(req,'media'\)/);
 assert.match(routes,/await validateDriveFile\(l\.drive_file_id,l\.drive_folder_id,'source',size\)/);
 assert.match(routes,/await playback\(final,query\.grant\)/);
 assert.doesNotMatch(sw,/drive\.google\.com|www\.googleapis\.com|refresh_token/);
});
