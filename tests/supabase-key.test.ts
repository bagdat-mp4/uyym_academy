import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authHeaders} from '../server/supabase.js';

test('legacy Supabase JWT key retains Bearer authorization',()=>{
 const headers=authHeaders('legacy-jwt');
 assert.equal(headers.apikey,'legacy-jwt');
 assert.equal(headers.Authorization,'Bearer legacy-jwt');
});

test('new Supabase secret and publishable keys use apikey only',()=>{
 for(const key of ['sb_secret_example','sb_publishable_example']){
  const headers=authHeaders(key);
  assert.equal(headers.apikey,key);
  assert.equal('Authorization' in headers,false);
 }
});
