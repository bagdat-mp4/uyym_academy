import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../server/index.js';

after(async()=>{await app.close();});

test('direct legal page requests and refreshes return the production SPA shell',async()=>{
 const home=await app.inject({method:'GET',url:'/',headers:{accept:'text/html'}});
 assert.equal(home.statusCode,200);
 for(const path of ['/privacy','/terms']){
  for(let refresh=0;refresh<2;refresh++){
   const response=await app.inject({method:'GET',url:path});
   assert.equal(response.statusCode,200,`${path} refresh ${refresh+1}`);
   assert.match(response.headers['content-type']||'',/^text\/html;\s*charset=utf-8/);
   assert.equal(response.body,home.body);
  }
 }
});

test('missing assets and unknown API routes remain JSON 404 responses',async()=>{
 for(const url of ['/assets/does-not-exist.js','/api/does-not-exist']){
  const response=await app.inject({method:'GET',url,headers:{accept:'text/html'}});
  assert.equal(response.statusCode,404,url);
  assert.match(response.headers['content-type']||'',/^application\/json;/);
  assert.doesNotMatch(response.body,/<!doctype html>/i);
 }
 const unknownPost=await app.inject({method:'POST',url:'/api/does-not-exist',headers:{accept:'text/html'}});
 assert.equal(unknownPost.statusCode,404);
});
