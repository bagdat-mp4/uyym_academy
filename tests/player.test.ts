import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ProtectedPlayer from '../client/src/ProtectedPlayer';
import {observePlayer,watchStudentProgress} from '../client/src/player-observation';

test('staff previews register no pause/interval progress work and render no completion action',()=>{
 const timers=mock.method(globalThis,'setInterval',()=>{throw new Error('Staff must not start progress timer');});
 try{
  for(const role of ['ADMIN','TEACHER'] as const){
   const video=Object.assign(new EventTarget(),{paused:false});let saves=0;const cleanup=watchStudentProgress(role,video,()=>saves++);video.dispatchEvent(new Event('pause'));cleanup();assert.equal(saves,0);
   const html=renderToStaticMarkup(createElement(ProtectedPlayer,{role,lang:'en',lesson:{id:'fixture',title:'Preview',description:'',course_title:'Fixture',starts_at:''}}));assert.ok(!html.includes('complete-button'));
  }
  assert.equal(timers.mock.callCount(),0);
 }finally{timers.mock.restore();}
});

test('student progress saves on pause/playing interval and cleans up listeners/timer',()=>{
 let tick!:()=>void;const timers=mock.method(globalThis,'setInterval',(fn:any)=>{tick=fn;return 1 as any;}),clear=mock.method(globalThis,'clearInterval',()=>{});
 try{
  const video=Object.assign(new EventTarget(),{paused:true});let saves=0;
  const cleanup=watchStudentProgress('STUDENT',video,()=>saves++);tick();assert.equal(saves,0);video.paused=false;tick();video.dispatchEvent(new Event('pause'));assert.equal(saves,2);
  cleanup();video.dispatchEvent(new Event('pause'));assert.equal(saves,2);assert.equal(clear.mock.callCount(),1);
 }finally{timers.mock.restore();clear.mock.restore();}
});

test('player measurements stay opt-in and contain only fixed labels and numeric times',async()=>{
 const rows:{event:string;ms:number}[]=[];const record=(event:any,ms:number)=>rows.push({event,ms});
 const silent=observePlayer(false,0,record);silent.mark('first_frame');await silent.measure('playback',async()=>42);assert.equal(rows.length,0);
 const active=observePlayer(true,performance.now(),record);await active.measure('media_init',async()=>42);active.mark('first_frame');assert.deepEqual(rows.map(r=>r.event),['media_init','first_frame']);assert.ok(rows.every(r=>Number.isFinite(r.ms)&&r.ms>=0));
});
