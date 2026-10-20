import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ProtectedPlayer from '../client/src/ProtectedPlayer';
import {ApiError} from '../client/src/api';
import {playerFailure,UnsupportedPlayerError} from '../client/src/player-error';
import VideoStatusOverlay from '../client/src/VideoStatusOverlay';

test('private player starts with one video and one play action without public sources or external controls',()=>{
 for(const lang of ['en','kk','ru'] as const){
  const html=renderToStaticMarkup(createElement(ProtectedPlayer,{lang,role:'STUDENT',lesson:{id:'local-test',title:'Author <lesson>',description:'',course_title:'Course',starts_at:''}}));
  assert.equal((html.match(/<video\b/g)||[]).length,1);
  assert.ok(!/<video\b[^>]*\scontrols=/.test(html));
  assert.ok(html.includes('controlsList="nodownload nofullscreen noremoteplayback"'));
  assert.ok(html.includes('disablePictureInPicture=""')&&html.includes('disableRemotePlayback=""'));
  assert.ok(!/<video\b[^>]*\ssrc=/.test(html));
  assert.ok(!html.includes('speed-control')&&!html.includes('fullscreen-button')&&!html.includes('Начать просмотр'));
  assert.equal((html.match(/class="uyym-player-start"/g)||[]).length,1);
  assert.ok(!html.includes('uyym-control-bar'),'Only one prominent initial Play action');
  assert.ok(html.includes('Author &lt;lesson&gt;'));
 }
});

test('player errors are localized, distinguish access from expired grants and never echo provider details',()=>{
 const details='PRIVATE_PROVIDER_DIAGNOSTIC';
 for(const lang of ['en','kk','ru'] as const){
  for(const status of [401,403,404,408,429,500]){
   const error=playerFailure(new ApiError(details,status),lang);
   assert.ok(error.message&&!error.message.includes(details));
   assert.equal(error.retry,![401,403,404].includes(status));
  }
  assert.equal(playerFailure(new ApiError(details,403,'MEDIA_GRANT_EXPIRED'),lang).retry,true);
  assert.equal(playerFailure(new UnsupportedPlayerError(),lang).retry,false);
  assert.ok(!playerFailure(new Error(details),lang).message.includes(details));
 }
 assert.notEqual(playerFailure(new Error(details),'en').message,playerFailure(new Error(details),'ru').message);
});

test('an access failure or loading state in fullscreen retains an exit even when transport controls are unavailable',()=>{
 for(const state of ['loading','error'] as const){
  const html=renderToStaticMarkup(createElement(VideoStatusOverlay,{state,lang:'en',failure:new ApiError('PRIVATE_DETAIL',403),fullscreen:true,onStart(){},onRetry(){throw new Error('No retry for denied access');},onExit(){}}));
  assert.ok(html.includes('class="uyym-player-exit"')&&html.includes('aria-label="Exit fullscreen"'));
  assert.ok(!html.includes('uyym-player-retry')&&!html.includes('PRIVATE_DETAIL'));
 }
});
