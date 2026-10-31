import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api} from './api';
import {Notice,message,type Lang} from './management';
import type {Course,Group,Content} from './learning-model';

type Upload={id:string;lesson_id:string;course_id:string;group_id:string|null;week:number;original_name:string;file_size:number;next_offset:number;status:'uploading'|'completed'|'failed'|'cancelled';title:string;published:boolean;revision:number};
const copy=(lang:Lang,en:string,kk:string,ru:string)=>lang==='en'?en:lang==='kk'?kk:ru;
function encoded(bytes:ArrayBuffer){const view=new Uint8Array(bytes);let binary='';for(let i=0;i<view.length;i+=32768)binary+=String.fromCharCode(...view.subarray(i,i+32768));return btoa(binary);}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export default function TeacherVideoUpload({lang}:{lang:Lang}){
 const [courses,setCourses]=useState<Course[]>([]),[course,setCourse]=useState(''),[groups,setGroups]=useState<Group[]>([]),[group,setGroup]=useState('');
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[week,setWeek]=useState(1),[file,setFile]=useState<File|null>(null);
 const [uploads,setUploads]=useState<Upload[]>([]),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[percent,setPercent]=useState(0),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const uploadAbort=useRef<AbortController|null>(null),activeUpload=useRef('');
 const refresh=()=>api<{uploads:Upload[];enabled:boolean}>('/api/teacher/video-uploads',{proof:'api'}).then(data=>{setUploads(data.uploads);setEnabled(data.enabled);});
 useEffect(()=>{void Promise.all([api<{courses:Course[]}>('/api/courses',{proof:'api'}),refresh()]).then(([data])=>{setCourses(data.courses);setCourse(data.courses[0]?.id??'');}).catch(reason=>setError(message(reason)));},[]);
 const courseWide=courses.find(item=>item.id===course)?.group_ids?.some(id=>id===null)??false;
 useEffect(()=>{if(!course)return;let active=true;void api<Content>(`/api/courses/${course}/content`,{proof:'api'}).then(data=>{if(active){setGroups(data.groups);setGroup(courses.find(item=>item.id===course)?.group_ids?.includes(null)?'':data.groups[0]?.id??'');}}).catch(reason=>{if(active)setError(message(reason));});return()=>{active=false;};},[course,courses]);
 const send=async(uploadId:string,source:File,initial:number,signal:AbortSignal)=>{
  let offset=initial,completed=false;setPercent(Math.round(offset/source.size*100));
  while(offset<source.size){
   const end=Math.min(offset+1048576,source.size),data=encoded(await source.slice(offset,end).arrayBuffer());
   let result:{offset:number;status:string}|undefined;
   for(let attempt=0;attempt<3;attempt++){
    try{result=await api(`/api/teacher/video-uploads/${uploadId}/chunk`,{method:'PUT',proof:'api',body:{offset,data},timeoutMs:90000,signal});break;}
    catch(reason){
     if(signal.aborted)throw reason;
     if(attempt===2)throw reason;
     await pause(750*(attempt+1));
     const synced=await api<{offset:number;status:string}>(`/api/teacher/video-uploads/${uploadId}/sync`,{method:'POST',proof:'api',body:{},timeoutMs:90000,signal});
     if(synced.status==='completed'){offset=source.size;result=synced;break;}
     if(synced.status==='failed')throw new Error(copy(lang,'The Drive upload expired. Use Restart to begin a fresh upload.','Drive жүктеу сессиясы аяқталды. Жаңадан бастау үшін «Қайта бастау» түймесін басыңыз.','Сессия Drive истекла. Нажмите «Начать заново» для новой загрузки.'));
     if(synced.offset!==offset){offset=synced.offset;break;}
    }
   }
   if(result?.status==='failed')throw new Error(copy(lang,'The Drive upload expired. Use Restart to begin a fresh upload.','Drive жүктеу сессиясы аяқталды. Жаңадан бастау үшін «Қайта бастау» түймесін басыңыз.','Сессия Drive истекла. Нажмите «Начать заново» для новой загрузки.'));
   if(result){offset=result.offset;completed=result.status==='completed';}
   if(offset<0||offset>source.size)throw new Error('Invalid upload progress');
   setPercent(Math.round(offset/source.size*100));
  }
  if(!completed){
   const checked=await api<{offset:number;status:string}>(`/api/teacher/video-uploads/${uploadId}/sync`,{method:'POST',proof:'api',body:{},timeoutMs:90000,signal});
   if(checked.status!=='completed')throw new Error(copy(lang,'Drive has not confirmed the final upload. Use Resume after a moment.','Drive соңғы жүктеуді әлі растаған жоқ. Біраздан кейін «Жалғастыру» басыңыз.','Drive ещё не подтвердил завершение загрузки. Немного позже нажмите «Продолжить».'));
  }
  await refresh();setSuccess(copy(lang,'The MP4 is in the owner’s Drive. The lesson is a draft; publish it when ready.','MP4 иесінің Drive аккаунтында. Сабақ draft күйінде, дайын болғанда жариялаңыз.','MP4 загружен в Drive владельца. Урок пока черновик; опубликуйте его, когда он готов.'));
 };
 const start=async(event:FormEvent)=>{
  event.preventDefault();if(!file||busy)return;
  setError('');setSuccess('');setBusy(true);
  const controller=new AbortController();uploadAbort.current=controller;
  try{
   if(!/\.mp4$/i.test(file.name)||file.type&&file.type!=='video/mp4'||file.size<12||file.size>20*1024*1024*1024)throw new Error(copy(lang,'Select an MP4 file up to 20 GB.','20 GB дейін MP4 файлын таңдаңыз.','Выберите MP4 до 20 ГБ.'));
   const result=await api<{upload_id:string;offset:number}>('/api/teacher/video-uploads',{method:'POST',proof:'api',body:{course_id:course,group_id:group||null,week,title,description,name:file.name,size:file.size},timeoutMs:90000});
   activeUpload.current=result.upload_id;await refresh();await send(result.upload_id,file,result.offset,controller.signal);
  }catch(reason){if(!controller.signal.aborted)setError(message(reason));await refresh().catch(()=>{});}finally{if(uploadAbort.current===controller)uploadAbort.current=null;activeUpload.current='';setBusy(false);}
 };
 const resume=async(row:Upload)=>{
  if(!file||file.name!==row.original_name||file.size!==Number(row.file_size)){setError(copy(lang,'Select the same MP4 file to resume.','Жалғастыру үшін сол MP4 файлын таңдаңыз.','Для продолжения выберите тот же MP4.'));return;}
  setBusy(true);setError('');const controller=new AbortController();uploadAbort.current=controller;activeUpload.current=row.id;
  try{let synced:{offset:number;status:string};
   if(row.status==='uploading')synced=await api(`/api/teacher/video-uploads/${row.id}/sync`,{method:'POST',proof:'api',body:{},timeoutMs:90000,signal:controller.signal});
   else synced=await api(`/api/teacher/video-uploads/${row.id}/restart`,{method:'POST',proof:'api',body:{},timeoutMs:90000,signal:controller.signal});
   if(synced.status==='failed')synced=await api(`/api/teacher/video-uploads/${row.id}/restart`,{method:'POST',proof:'api',body:{},timeoutMs:90000,signal:controller.signal});
   if(synced.status==='uploading')await send(row.id,file,synced.offset,controller.signal);else await refresh();
  }catch(reason){if(!controller.signal.aborted)setError(message(reason));}finally{if(uploadAbort.current===controller)uploadAbort.current=null;activeUpload.current='';setBusy(false);}
 };
 const cancel=async(id:string)=>{
  uploadAbort.current?.abort();setBusy(true);setError('');
  try{await api(`/api/teacher/video-uploads/${id}`,{method:'DELETE',proof:'api'});await refresh();setSuccess(copy(lang,'Upload cancelled. The incomplete private Google session will expire automatically.','Жүктеу тоқтатылды. Аяқталмаған жеке Google сессиясы мерзімі біткенде жойылады.','Загрузка отменена. Незавершённая приватная сессия Google истечёт автоматически.'));}
  catch(reason){setError(message(reason));}finally{activeUpload.current='';uploadAbort.current=null;setBusy(false);}
 };
 const publish=async(row:Upload)=>{setBusy(true);setError('');try{await api(`/api/content/lessons/${row.lesson_id}`,{method:'PATCH',proof:'api',body:{operation_id:crypto.randomUUID(),revision:Number(row.revision),published:true}});await refresh();setSuccess(copy(lang,'Lesson published to its authorized course.','Сабақ өз курсының оқушыларына жарияланды.','Урок опубликован для своего курса.'));}catch(reason){setError(message(reason));}finally{setBusy(false);}};
 return <section className="dashboard-panel manage-panel video-upload-panel"><div className="panel-heading"><div><div className="eyebrow">UYYM ACADEMY · DRIVE</div><h2>{copy(lang,'Upload video lessons','Бейнесабақ жүктеу','Загрузка видеоуроков')}</h2></div></div>
  <p className="panel-description">{copy(lang,'Upload Microsoft Teams MP4 recordings here. They are stored in the academy owner’s private Drive, not in your Google account. Only your assigned courses are available.','Teams MP4 жазбаларын осы жерге жүктеңіз. Олар сіздің Google аккаунтыңызға емес, академия иесінің жабық Drive аккаунтына сақталады. Тек тағайындалған курстар ашық.','Загружайте записи Teams в MP4 сюда. Они хранятся в закрытом Drive владельца академии, а не в вашем Google аккаунте. Доступны только назначенные курсы.')}</p>
  {!enabled&&<div className="alert alert-error" role="status">{copy(lang,'The administrator has not enabled video upload for your account.','Әкімші сіздің аккаунтыңызға видео жүктеу рұқсатын әлі берген жоқ.','Администратор ещё не разрешил вашему аккаунту загружать видео.')}</div>}
  <Notice error={error} success={success}/>
  <form className="manage-form" onSubmit={event=>void start(event)}><div className="manage-form-grid">
   <label>{copy(lang,'Course','Курс','Курс')}<select value={course} onChange={event=>setCourse(event.target.value)} required>{courses.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
   <label>{copy(lang,'Group','Топ','Группа')}<select value={group} onChange={event=>setGroup(event.target.value)} required={!courseWide}>{courseWide&&<option value="">{copy(lang,'All course groups','Курстың барлық топтары','Все группы курса')}</option>}{groups.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
   <label>{copy(lang,'Week','Апта','Неделя')}<input type="number" min={1} max={104} value={week} onChange={event=>setWeek(Number(event.target.value))} required/></label>
   <label>{copy(lang,'Lesson title','Сабақ атауы','Название урока')}<input value={title} onChange={event=>setTitle(event.target.value)} required maxLength={300}/></label>
  </div><label>{copy(lang,'Description','Сипаттама','Описание')}<textarea value={description} onChange={event=>setDescription(event.target.value)} maxLength={10000}/></label>
  <label>{copy(lang,'Teams recording · MP4','Teams жазбасы · MP4','Запись Teams · MP4')}<input type="file" accept="video/mp4,.mp4" onChange={event=>setFile(event.target.files?.[0]??null)} required/></label>
  <p className="form-help">{copy(lang,'Keep this tab open during upload. If it fails, select the same file and use Resume. Uploads are private drafts until you publish them.','Жүктеу кезінде бұл бетті ашық қалдырыңыз. Үзілсе, сол файлды таңдап «Жалғастыру» басыңыз. Жариялағанға дейін сабақ жабық draft болып қалады.','Во время загрузки держите вкладку открытой. При сбое выберите тот же файл и нажмите «Продолжить». До публикации урок остаётся закрытым черновиком.')}</p>
  {busy&&<div role="status"><progress value={percent} max={100} aria-label={copy(lang,'Upload progress','Жүктеу барысы','Прогресс загрузки')}/><span> {percent}%</span>{activeUpload.current&&<button type="button" className="button button-outline" onClick={()=>void cancel(activeUpload.current)}>{copy(lang,'Cancel upload','Жүктеуді тоқтату','Отменить загрузку')}</button>}</div>}
  <button className="button button-yellow" disabled={!enabled||busy||!course||!file}>{copy(lang,'Start upload','Жүктеуді бастау','Начать загрузку')}</button></form>
  <div className="manage-subheading"><h3>{copy(lang,'Recent uploads','Соңғы жүктеулер','Последние загрузки')}</h3></div>
  <div className="manage-records">{uploads.map(row=><article className="manage-record" key={row.id}><div className="manage-record-info"><h4>{row.title}</h4><p>{row.original_name} · {copy(lang,'Week','Апта','Неделя')} {row.week} · {row.status==='completed'?copy(lang,'Stored in owner Drive','Иесінің Drive аккаунтында','В Drive владельца'):row.status==='failed'?copy(lang,'Upload failed; restart available','Жүктеу аяқталмады; қайта бастауға болады','Загрузка прервана; можно начать заново'):row.status==='cancelled'?copy(lang,'Cancelled','Тоқтатылған','Отменена'):copy(lang,'Uploading','Жүктелуде','Загружается')} · {row.published?copy(lang,'Published','Жарияланған','Опубликован'):copy(lang,'Draft','Жоба','Черновик')}</p></div><div className="manage-record-actions">{row.status==='uploading'&&<><button className="button button-outline" disabled={!enabled||busy} onClick={()=>void resume(row)}>{copy(lang,'Resume','Жалғастыру','Продолжить')}</button><button className="button button-outline" disabled={busy} onClick={()=>void cancel(row.id)}>{copy(lang,'Cancel','Тоқтату','Отменить')}</button></>}{['failed','cancelled'].includes(row.status)&&<button className="button button-outline" disabled={!enabled||busy} onClick={()=>void resume(row)}>{copy(lang,'Restart','Қайта бастау','Начать заново')}</button>}{row.status==='completed'&&!row.published&&<button className="button button-yellow" disabled={busy} onClick={()=>void publish(row)}>{copy(lang,'Publish lesson','Сабақты жариялау','Опубликовать урок')}</button>}</div></article>)}</div>
 </section>;
}
