export type UploadRow={id:string;lesson_id:string;course_id:string;group_id:string|null;week:number;original_name:string;file_size:number;next_offset:number;status:string;title:string;published:boolean;revision:number;created_at?:string};
export type UploadTarget={course_id:string;group_id:string|null;week:number;title:string;description:string};
export type Stage='preparing'|'uploading'|'verifying'|'publishing'|'published';
type Request=<T>(path:string,options?:{method?:string;body?:unknown;proof?:string;timeoutMs?:number})=>Promise<T>;
type Result={offset:number;status:string};
export class UploadProblem extends Error{}
export type UploadOperation='list'|'create'|'sync'|'chunk'|'verify'|'publish'|'confirm';
export class UploadRequestFailure extends Error {
 readonly status?:number;
 constructor(readonly operation:UploadOperation,error:unknown){
  super(error instanceof Error?error.message:'Upload request failed');
  const status=(error as {status?:unknown}|null)?.status;
  if(typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<=599)this.status=status;
 }
}
export function validateVideo(file:Pick<File,'name'|'size'|'type'>){
 if(!/\.mp4$/i.test(file.name)||(file.type&&file.type!=='video/mp4')||file.size<12||file.size>20*1024**3)throw new UploadProblem('file');
}
export function validateTarget(target:UploadTarget,courseIds:string[],groupIds:string[],courseWide:boolean){
 if(!courseIds.includes(target.course_id)||(!target.group_id&&!courseWide)||(target.group_id&&!groupIds.includes(target.group_id))||!target.title.trim()||target.title.trim().length>300||!Number.isInteger(target.week)||target.week<1||target.week>104)throw new UploadProblem('selection');
}
export function matchingUploads(rows:UploadRow[],target:UploadTarget,file:Pick<File,'name'|'size'>){return rows.filter(row=>row.course_id===target.course_id&&row.group_id===target.group_id&&Number(row.week)===target.week&&row.original_name===file.name&&Number(row.file_size)===file.size);}
function base64(bytes:ArrayBuffer){let value='';const view=new Uint8Array(bytes);for(let i=0;i<view.length;i+=32768)value+=String.fromCharCode(...view.subarray(i,i+32768));return btoa(value);}
// Uses existing authenticated endpoints. No restart, delete or direct Drive calls.
export async function uploadAndPublish({request,file,target,existingId,creationPending,markCreationPending,onProgress}:{request:Request;file?:File;target?:UploadTarget;existingId?:string;creationPending:boolean;markCreationPending:()=>void;onProgress:(stage:Stage,bytes:number,total:number)=>void}){
 const requestAt=async<T>(operation:UploadOperation,path:string,options?:Parameters<Request>[1]):Promise<T>=>{try{return await request<T>(path,options);}catch(error){throw new UploadRequestFailure(operation,error);}};
 const list=async(operation:UploadOperation='list')=>{const result=await requestAt<{uploads:UploadRow[];enabled:boolean}>(operation,'/api/teacher/video-uploads',{proof:'api'});return result;};
 const post=<T>(operation:UploadOperation,path:string,body:unknown={})=>requestAt<T>(operation,path,{method:'POST',proof:'api',body,timeoutMs:90000});
 onProgress('preparing',0,file?.size??0);
 if(file){validateVideo(file);const header=new Uint8Array(await file.slice(4,8).arrayBuffer());if(String.fromCharCode(...header)!=='ftyp')throw new UploadProblem('file');}
 const initial=await list();
 let row:UploadRow|undefined;
 if(existingId)row=initial.uploads.find(item=>item.id===existingId);
 else if(target&&file){const matches=matchingUploads(initial.uploads,target,file);if(matches.length>1||(matches[0]&&matches[0].title!==target.title.trim()))throw new UploadProblem('ambiguous');row=matches[0];}
 else throw new UploadProblem('selection');
 if(existingId&&!row)throw new UploadProblem('missing');
 if(!row){
  if(creationPending)throw new UploadProblem('uncertain');
  if(!initial.enabled)throw new UploadProblem('permission');
  // Persist BEFORE creation. A lost response must never trigger blind creation.
  markCreationPending();
  const created=await post<{upload_id:string}>('create','/api/teacher/video-uploads',{...target!,title:target!.title.trim(),name:file!.name,size:file!.size});
  row=(await list()).uploads.find(item=>item.id===created.upload_id);if(!row)throw new UploadProblem('uncertain');
 }
 const total=Number(row.file_size),path=`/api/teacher/video-uploads/${row.id}`;
 if(row.published&&row.status==='completed'){onProgress('published',total,total);return;}
 if(!['uploading','completed'].includes(row.status))throw new UploadProblem('recovery');
 let state:Result={offset:Number(row.next_offset),status:row.status};
 const sync=async()=>{onProgress('verifying',state.offset,total);return post<Result>('sync',`${path}/sync`);};
 if(state.status!=='completed')state=await sync();
 if(state.status==='failed')throw new UploadProblem('recovery');
 if(state.status!=='completed'){
  if(!file||file.name!==row.original_name||file.size!==total)throw new UploadProblem('same-file');
  while(state.offset<total&&state.status!=='completed'){
   const start=state.offset;if(!Number.isSafeInteger(start)||start<0)throw new UploadProblem('progress');
   const end=Math.min(start+1048576,total),data=base64(await file.slice(start,end).arrayBuffer());
   onProgress('uploading',start,total);
   try{state=await requestAt<Result>('chunk',`${path}/chunk`,{method:'PUT',proof:'api',body:{offset:start,data},timeoutMs:90000});}
   catch(error){state=await sync();if(state.status!=='completed'&&state.offset===start)throw error;}
   if(state.status==='failed')throw new UploadProblem('recovery');
   if(!Number.isSafeInteger(state.offset)||state.offset<=start||state.offset>total||(state.status!=='completed'&&state.offset>end))throw new UploadProblem('progress');
   onProgress(state.status==='completed'?'verifying':'uploading',state.offset,total);
  }
  if(state.status!=='completed')state=await sync();
 }
 if(state.status!=='completed')throw new UploadProblem('interrupted');
 onProgress('verifying',total,total);
 const verified=(await list('verify')).uploads.find(item=>item.id===row!.id);
 if(!verified||verified.status!=='completed')throw new UploadProblem('recovery');
 if(!verified.published){
  onProgress('publishing',total,total);
  await requestAt('publish',`/api/content/lessons/${verified.lesson_id}`,{method:'PATCH',proof:'api',body:{operation_id:crypto.randomUUID(),revision:Number(verified.revision),published:true},timeoutMs:90000});
 }
 const published=(await list('confirm')).uploads.find(item=>item.id===row!.id);
 if(!published?.published||published.status!=='completed')throw new UploadProblem('publication');
 onProgress('published',total,total);
}
