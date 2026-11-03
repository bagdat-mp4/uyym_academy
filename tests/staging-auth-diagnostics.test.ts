import {test} from 'node:test';
import assert from 'node:assert/strict';
import {logStagingAuthFailure,stagingAuthFailureChecks} from '../server/staging-auth-diagnostics.js';

test('staging auth diagnostics are gated to the synthetic test fixture',()=>{
 const lines:string[]=[];
 logStagingAuthFailure('totp_login_ticket_required',{NODE_ENV:'production',UYYM_UI_DRIVE_STAGING:'1'},line=>lines.push(line));
 logStagingAuthFailure('totp_login_ticket_required',{NODE_ENV:'test',UYYM_UI_DRIVE_STAGING:'0'},line=>lines.push(line));
 assert.equal(lines.length,0);
 logStagingAuthFailure('totp_login_ticket_required',{NODE_ENV:'test',UYYM_UI_DRIVE_STAGING:'1'},line=>lines.push(line));
 assert.deepEqual(lines.map(line=>JSON.parse(line)),[{event:'staging_auth_check_failed',check:'totp_login_ticket_required'}]);
});

test('staging auth diagnostics emit only allowlisted check names and fixed metadata',()=>{
 for(const check of stagingAuthFailureChecks){
  const lines:string[]=[];
  logStagingAuthFailure(check,{NODE_ENV:'test',UYYM_UI_DRIVE_STAGING:'1'},line=>lines.push(line));
  const event=JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(event).sort(),['check','event']);
  assert.equal(event.check,check);
  assert.equal(event.event,'staging_auth_check_failed');
 }
});
