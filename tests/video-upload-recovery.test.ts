import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideUploadRecovery} from '../client/src/video-upload-recovery.js';

test('an uploading lesson only resumes or finalizes the original Drive session',()=>{
 assert.equal(decideUploadRecovery('uploading','uploading'),'resume-session');
 assert.equal(decideUploadRecovery('uploading','completed'),'completed');
 assert.equal(decideUploadRecovery('uploading','failed'),'stop');
 assert.equal(decideUploadRecovery('uploading'),'stop');
});

test('a new Drive session is possible only from an explicitly failed or cancelled row',()=>{
 assert.equal(decideUploadRecovery('failed'),'start-new-session');
 assert.equal(decideUploadRecovery('cancelled'),'start-new-session');
});
