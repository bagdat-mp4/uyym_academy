import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uploadAndPublish,validateVideo,validateTarget,matchingUploads,UploadProblem,UploadRequestFailure,type UploadRow} from '../client/src/teacher-upload-workflow.js';
const target={course_id:'course',group_id:'group',week:1,title:'Derivatives',description:''};
const bytes=new Uint8Array(1357138);bytes.set(new TextEncoder().encode('ftyp'),4);
const file=new File([bytes],'staging-test.mp4',{type:'video/mp4'});
function fixture(existing=false){
 const calls:string[]=[],stages:string[]=[],offsets:number[]=[];let pending=false,loseFinal=false,loseCreate=false,completeOnSync=false;
 const row:UploadRow={id:'upload',lesson_id:'lesson',...target,original_name:file.name,file_size:file.size,next_offset:0,status:'uploading',published:false,revision:1};
 let exists=existing;
 const request=async<T>(path:string,options?:any):Promise<T>=>{
  calls.push(`${options?.method??'GET'} ${path}`);
  if(path==='/api/teacher/video-uploads'&&!options?.method)return {uploads:exists?[{...row}]:[],enabled:true} as T;
  if(path==='/api/teacher/video-uploads'){exists=true;if(loseCreate)throw new Error('lost response');return {upload_id:row.id} as T;}
  if(path.endsWith('/sync')){if(completeOnSync){row.next_offset=file.size;row.status='completed';}return {offset:row.next_offset,status:row.status} as T;}
  if(path.endsWith('/chunk')){assert.equal(options.body.offset,row.next_offset);row.next_offset+=Buffer.from(options.body.data,'base64').length;offsets.push(row.next_offset);if(row.next_offset===file.size){row.status='completed';if(loseFinal)throw new Error('lost final response');}return {offset:row.next_offset,status:row.status} as T;}
  if(options?.method==='PATCH'){assert.equal(row.status,'completed');assert.equal(options.body.published,true);row.published=true;return {} as T;}
  throw new Error('Unexpected request');
 };
 const run=(source:File|null=file,existingId?:string)=>uploadAndPublish({request,file:source??undefined,target,existingId,creationPending:pending,markCreationPending:()=>{pending=true;},onProgress:stage=>{stages.push(stage);}});
 return {row,calls,stages,offsets,run,setCompleteOnSync:()=>{completeOnSync=true;},setLoseFinal:()=>{loseFinal=true;},setLoseCreate:()=>{loseCreate=true;},setAbsent:()=>{exists=false;}};
}
test('validates MP4 limits, class scope and required fields',()=>{
 validateVideo(file);validateTarget(target,['course'],['group'],false);
 for(const value of [{...target,title:' '},{...target,group_id:'foreign'},{...target,week:0},{...target,course_id:'foreign'}])assert.throws(()=>validateTarget(value,['course'],['group'],false),UploadProblem);
 for(const value of [{name:'x.exe',type:'video/mp4',size:12},{name:'x.mp4',type:'text/plain',size:12},{name:'x.mp4',type:'',size:20*1024**3+1}])assert.throws(()=>validateVideo(value));
});
test('one action uploads at the 1 MiB boundary, verifies, publishes and repeated action reuses the lesson',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.offsets,[1048576,1357138]);assert.equal(f.row.published,true);assert.ok(f.stages.includes('verifying'));assert.ok(f.stages.indexOf('publishing')>f.stages.indexOf('uploading'));await f.run();
 assert.equal(f.calls.filter(x=>x==='POST /api/teacher/video-uploads').length,1);assert.equal(f.calls.filter(x=>x.startsWith('PATCH')).length,1);
});
test('a lost final response reconciles and publishes without resending bytes',async()=>{const f=fixture();f.setLoseFinal();await f.run();assert.equal(f.row.published,true);assert.equal(f.offsets.length,2);assert.ok(!f.calls.some(x=>x.includes('/restart')));});
test('an existing completed file publishes with no local file and no chunk upload',async()=>{const f=fixture(true);f.row.status='completed';f.row.next_offset=file.size;await f.run(null,'upload');assert.equal(f.row.published,true);assert.deepEqual(f.offsets,[]);});
test('an incomplete existing upload requires the original file and stays unpublished',async()=>{const f=fixture(true);await assert.rejects(()=>f.run(null,'upload'),/same-file/);assert.equal(f.row.published,false);assert.deepEqual(f.offsets,[]);});
test('failed records and ambiguous matches never create replacement sessions',async()=>{const f=fixture(true);f.row.status='failed';await assert.rejects(()=>f.run(),/recovery/);assert.equal(f.calls.filter(x=>x==='POST /api/teacher/video-uploads').length,0);assert.equal(matchingUploads([f.row,{...f.row,id:'other'}],target,file).length,2);});
test('uncertain creation persists a hold; reconciliation can find the original row and never blindly repost',async()=>{const f=fixture();f.setLoseCreate();await assert.rejects(()=>f.run());await f.run();assert.equal(f.row.published,true);assert.equal(f.calls.filter(x=>x==='POST /api/teacher/video-uploads').length,1);f.setAbsent();await assert.rejects(()=>f.run(),/uncertain/);assert.equal(f.calls.filter(x=>x==='POST /api/teacher/video-uploads').length,1);});


test('a remotely complete upload reconciles and publishes without selecting or sending a file',async()=>{const f=fixture(true);f.row.next_offset=1048576;f.setCompleteOnSync();await f.run(null,'upload');assert.equal(f.row.published,true);assert.equal(f.calls.filter(x=>x.endsWith('/sync')).length,1);assert.deepEqual(f.offsets,[]);});
test('an interrupted upload resumes from its acknowledged first MiB',async()=>{const f=fixture(true);f.row.next_offset=1048576;await f.run(file,'upload');assert.deepEqual(f.offsets,[1357138]);assert.equal(f.row.published,true);assert.equal(f.calls.filter(x=>x==='POST /api/teacher/video-uploads').length,0);});
test('editing the title cannot silently create a duplicate for the same file and class',async()=>{const f=fixture(true);f.row.title='Earlier title';await assert.rejects(()=>f.run(),/ambiguous/);assert.equal(f.calls.filter(x=>x==='POST /api/teacher/video-uploads').length,0);});

// These failures are synthetic; no local staging or Google requests are made.
for(const failing of ['sync','chunk','publish'] as const)test(`reports ${failing} failure without creating another upload or losing the HTTP status`,async()=>{
 const calls:string[]=[];
 const row:UploadRow={id:'existing',lesson_id:'lesson',...target,original_name:file.name,file_size:file.size,next_offset:0,status:failing==='publish'?'completed':'uploading',published:false,revision:1};
 const request=async<T>(path:string,options?:any):Promise<T>=>{
  calls.push(`${options?.method??'GET'} ${path}`);
  if(path==='/api/teacher/video-uploads')return {uploads:[row],enabled:true} as T;
  if(path.endsWith('/'+failing)||failing==='publish'&&options?.method==='PATCH')throw Object.assign(new Error('Synthetic provider unavailable'),{status:503});
  if(path.endsWith('/sync'))return {offset:0,status:'uploading'} as T;
  throw new Error('Unexpected request');
 };
 await assert.rejects(()=>uploadAndPublish({request,file,existingId:row.id,creationPending:false,markCreationPending:()=>assert.fail('must reuse existing upload'),onProgress:()=>{}}),error=>{
  assert.ok(error instanceof UploadRequestFailure);assert.equal(error.operation,failing);assert.equal(error.status,503);assert.equal(error.message,'Synthetic provider unavailable');
  assert.ok(!JSON.stringify(error).includes('existing'));return true;
 });
 assert.equal(row.published,false);
 assert.ok(!calls.includes('POST /api/teacher/video-uploads'));
 assert.ok(!calls.some(call=>call.includes('/restart')));
 if(failing==='sync')assert.ok(!calls.some(call=>call.includes('/chunk')||call.startsWith('PATCH')));
});
