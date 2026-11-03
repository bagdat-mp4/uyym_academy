import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api} from './api';
import {Notice,message,dateLabel,type Lang} from './management';
import type {Course,Group,Content} from './learning-model';
import {uploadAndPublish,validateVideo,validateTarget,UploadProblem,UploadRequestFailure,type UploadRow,type Stage} from './teacher-upload-workflow';

const copy=(lang:Lang,en:string,kk:string,ru:string)=>lang==='en'?en:lang==='kk'?kk:ru;
const size=(bytes:number)=>`${(bytes/1024/1024).toFixed(2)} MB`;
export default function TeacherVideoUpload({lang}:{lang:Lang}){
 const t=(en:string,kk:string,ru:string)=>copy(lang,en,kk,ru);
 const [courses,setCourses]=useState<Course[]>([]),[course,setCourse]=useState(''),[groups,setGroups]=useState<Group[]>([]),[group,setGroup]=useState(''),[scopeReady,setScopeReady]=useState(false);
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[week,setWeek]=useState(1),[file,setFile]=useState<File|null>(null),[dragging,setDragging]=useState(false);
 const [uploads,setUploads]=useState<UploadRow[]>([]),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [progress,setProgress]=useState<{stage:Stage;bytes:number;total:number}>({stage:'preparing',bytes:0,total:0});
 const running=useRef(false),input=useRef<HTMLInputElement>(null);
 const refresh=async()=>{const data=await api<{uploads:UploadRow[];enabled:boolean}>('/api/teacher/video-uploads',{proof:'api'});setUploads(data.uploads);setEnabled(data.enabled);return data;};
 useEffect(()=>{void Promise.all([api<{courses:Course[]}>('/api/courses',{proof:'api'}),refresh()]).then(([data])=>{setCourses(data.courses);setCourse(data.courses[0]?.id??'');}).catch(reason=>setError(message(reason)));},[]);
 const courseWide=courses.find(item=>item.id===course)?.group_ids?.includes(null)??false;
 useEffect(()=>{let active=true;setScopeReady(false);setGroups([]);setGroup('');if(course)void api<Content>(`/api/courses/${course}/content`,{proof:'api'}).then(data=>{if(active){setGroups(data.groups);setGroup(data.groups.length===1?data.groups[0].id:courseWide?'':data.groups[0]?.id??'');setScopeReady(true);}}).catch(reason=>{if(active)setError(message(reason));});return()=>{active=false;};},[course,courseWide]);
 useEffect(()=>{const start=groups.find(item=>item.id===group)?.starts_at;const elapsed=start?Date.now()-Date.parse(start):NaN;setWeek(Number.isFinite(elapsed)?Math.max(1,Math.min(104,Math.floor(elapsed/(7*86400000))+1)):1);},[group,groups]);
 const problem=(reason:unknown)=>{
  if(reason instanceof UploadRequestFailure)return `${message(reason)} [${reason.operation}${reason.status?` · HTTP ${reason.status}`:''}]`;
  if(!(reason instanceof UploadProblem))return message(reason);
  switch(reason.message){
   case 'file':return t('Choose a valid MP4 up to 20 GB.','20 GB дейін жарамды MP4 таңдаңыз.','Выберите корректный MP4 до 20 ГБ.');
   case 'selection':return t('Check the title, course, group and week.','Атауын, курсты, топты және аптаны тексеріңіз.','Проверьте название, курс, группу и неделю.');
   case 'same-file':return t('Select the original MP4, then continue this upload below.','Бастапқы MP4 файлын таңдап, төмендегі жүктеуді жалғастырыңыз.','Выберите исходный MP4 и продолжите эту загрузку ниже.');
   case 'ambiguous':return t('More than one matching upload exists. Choose the lesson below.','Бірнеше сәйкес жүктеу бар. Төменнен сабақты таңдаңыз.','Найдено несколько загрузок. Выберите нужный урок ниже.');
   case 'uncertain':return t('The previous request is still unresolved. Check unfinished uploads before trying again.','Алдыңғы сұрау әлі расталмады. Аяқталмаған жүктеулерді тексеріңіз.','Предыдущий запрос ещё не подтверждён. Проверьте незавершённые загрузки.');
   case 'recovery':case 'missing':return t('This upload needs administrator review. Your existing file has been kept.','Бұл жүктеуді әкімші тексеруі керек. Файлыңыз сақталды.','Эту загрузку должен проверить администратор. Существующий файл сохранён.');
   case 'permission':return t('Ask your administrator to enable video uploads.','Әкімшіден бейне жүктеу рұқсатын сұраңыз.','Попросите администратора разрешить загрузку видео.');
   case 'publication':return t('The video is verified. Try publishing it again below.','Бейне тексерілді. Төменнен қайта жариялап көріңіз.','Видео проверено. Попробуйте опубликовать его ниже.');
   default:return t('Upload paused. Continue below using the same MP4.','Жүктеу тоқтады. Сол MP4 арқылы төменнен жалғастырыңыз.','Загрузка приостановлена. Продолжите ниже с тем же MP4.');
  }
 };
 const choose=(next?:File)=>{if(!next||running.current)return;try{validateVideo(next);setFile(next);setError('');if(!title.trim())setTitle(next.name.replace(/\.mp4$/i,'').replace(/[_-]+/g,' ').slice(0,300));}catch(reason){setError(problem(reason));}};
 const run=async(row?:UploadRow)=>{
  if(running.current)return;running.current=true;setBusy(true);setError('');setSuccess('');
  try{
   if(!navigator.locks)throw new UploadProblem('uncertain');
   await navigator.locks.request('uyym-teacher-video-upload',{ifAvailable:true},async lock=>{
    if(!lock)throw new UploadProblem('interrupted');
    const target={course_id:course,group_id:group||null,week,title:title.trim(),description};
    if(!row){if(!file)throw new UploadProblem('file');validateTarget(target,courses.map(item=>item.id),groups.map(item=>item.id),courseWide);if(!scopeReady)throw new UploadProblem('selection');}
    // Hash non-secret selection metadata; no credentials or Drive URLs are persisted.
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([course,group,week,file?.name,file?.size])));
    const intent='uyym-upload-intent-'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    await uploadAndPublish({request:api,file:file??undefined,target:row?undefined:target,existingId:row?.id,creationPending:localStorage.getItem(intent)==='pending',markCreationPending:()=>localStorage.setItem(intent,'pending'),onProgress:(stage,bytes,total)=>setProgress({stage,bytes,total})});
    setSuccess(t('Published. Enrolled students can now watch this lesson.','Жарияланды. Курсқа тіркелген оқушылар сабақты көре алады.','Опубликовано. Ученики курса могут смотреть этот урок.'));
   });
  }catch(reason){setError(problem(reason));}
  finally{await refresh().catch(()=>{});running.current=false;setBusy(false);}
 };
 const submit=(event:FormEvent)=>{event.preventDefault();void run();};
 const stages:Record<Stage,string>={preparing:t('Preparing','Дайындау','Подготовка'),uploading:t('Uploading','Жүктелуде','Загрузка'),verifying:t('Verifying video','Бейне тексерілуде','Проверка видео'),publishing:t('Publishing','Жариялануда','Публикация'),published:t('Published','Жарияланды','Опубликовано')};
 const completed=uploads.filter(row=>row.status==='completed'),unfinished=uploads.filter(row=>row.status!=='completed');
 const history=(rows:UploadRow[])=> <ul className="upload-history">{rows.map(row=><li key={row.id}><div><strong>{row.title}</strong><small>{row.original_name} · {size(Number(row.file_size))}{row.created_at?` · ${dateLabel(row.created_at,lang)}`:''}</small></div><span className={`upload-state ${row.published?'is-published':''}`}>{row.published?stages.published:row.status==='completed'?t('Ready to publish','Жариялауға дайын','Готово к публикации'):row.status==='uploading'?t('Not finished','Аяқталмаған','Не завершено'):t('Review required','Тексеру қажет','Требует проверки')}</span>{!row.published&&['completed','uploading'].includes(row.status)&&<button type="button" className="button button-outline" disabled={busy} onClick={()=>void run(row)}>{row.status==='completed'?t('Publish','Жариялау','Опубликовать'):t('Continue upload','Жүктеуді жалғастыру','Продолжить загрузку')}</button>}</li>)}</ul>;
 return <section className="dashboard-panel manage-panel video-upload-panel">
  <div className="panel-heading"><div><div className="eyebrow">UYYM ACADEMY</div><h2>{t('Upload a video lesson','Бейнесабақ жүктеу','Загрузить видеоурок')}</h2><p className="panel-description">{t('Choose a recording. We’ll verify it and publish it for your class.','Жазбаны таңдаңыз. Біз оны тексеріп, сыныбыңызға жариялаймыз.','Выберите запись. Мы проверим её и опубликуем для вашего класса.')}</p></div></div>
  <Notice error={error} success={success}/>
  {!enabled&&<p className="alert alert-error">{t('Video uploads are not enabled for your account.','Аккаунтыңызға бейне жүктеу рұқсаты берілмеген.','Загрузка видео для вашего аккаунта пока не разрешена.')}</p>}
  <form onSubmit={submit} className="manage-form upload-form"><fieldset disabled={busy}>
   <div className={`upload-dropzone ${dragging?'is-dragging':''}`} onDragOver={event=>{event.preventDefault();if(!busy)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);if(!busy)choose(event.dataTransfer.files[0]);}}>
    <span className="upload-symbol" aria-hidden="true">↑</span><strong>{file?file.name:t('Drop your MP4 here','MP4 файлын осында сүйреңіз','Перетащите MP4 сюда')}</strong><span>{file?size(file.size):t('MP4 · up to 20 GB','MP4 · 20 GB дейін','MP4 · до 20 ГБ')}</span>
    <button type="button" className="button button-outline" onClick={()=>input.current?.click()}>{file?t('Choose another file','Басқа файл таңдау','Выбрать другой файл'):t('Choose file','Файл таңдау','Выбрать файл')}</button><input ref={input} type="file" accept="video/mp4,.mp4" aria-label={t('MP4 recording','MP4 жазбасы','Запись MP4')} onChange={event=>choose(event.target.files?.[0])} hidden/>
   </div>
   <label>{t('Lesson title','Сабақ атауы','Название урока')}<input required maxLength={300} value={title} onChange={event=>setTitle(event.target.value)} placeholder={t('For example: Applications of derivatives','Мысалы: Туындының қолданылуы','Например: Применение производной')}/></label>
   <div className="upload-class-fields"><label>{t('Course','Курс','Курс')}<select required value={course} onChange={event=>{setScopeReady(false);setCourse(event.target.value);}}>{courses.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label>{t('Group','Топ','Группа')}<select value={group} required={!courseWide} disabled={!scopeReady} onChange={event=>setGroup(event.target.value)}>{courseWide&&<option value="">{t('All course groups','Курстың барлық топтары','Все группы курса')}</option>}{groups.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label>{t('Week','Апта','Неделя')}<input type="number" min={1} max={104} required value={week} onChange={event=>setWeek(Number(event.target.value))}/></label>
   </div>
   <details className="upload-settings"><summary>{t('Additional settings','Қосымша баптаулар','Дополнительные настройки')}</summary><label>{t('Description (optional)','Сипаттама (міндетті емес)','Описание (необязательно)')}<textarea value={description} onChange={event=>setDescription(event.target.value)} maxLength={10000}/></label></details>
   <button className="button upload-primary" disabled={!enabled||busy||!scopeReady||!file||!title.trim()}>{t('Upload and Publish','Жүктеу және жариялау','Загрузить и опубликовать')}</button>
  </fieldset></form>
  {busy&&<div className="upload-progress" role="status" aria-live="polite"><div><strong>{stages[progress.stage]}</strong><span>{progress.total?`${Math.round(progress.bytes/progress.total*100)}%`:''}</span></div><progress max={Math.max(1,progress.total)} value={progress.bytes} aria-label={stages[progress.stage]}/><small>{size(progress.bytes)} / {size(progress.total)} · {t('Keep this page open','Бұл бетті ашық ұстаңыз','Не закрывайте эту страницу')}</small></div>}
  <section className="upload-library"><h3>{t('Your lessons','Сабақтарыңыз','Ваши уроки')}</h3>{completed.length?history(completed):<p className="form-help">{t('Your completed lessons will appear here.','Аяқталған сабақтарыңыз осында көрсетіледі.','Здесь появятся ваши готовые уроки.')}</p>}</section>
  {unfinished.length>0&&<details className="upload-recovery"><summary>{t('Incomplete uploads','Аяқталмаған жүктеулер','Незавершённые загрузки')} <span>{unfinished.length}</span></summary><p className="form-help">{t('Continue checks the saved video first. Select the original MP4 only if more data is needed. Files are never restarted automatically.','Жалғастыру алдымен сақталған бейнені тексереді. Қосымша деректер қажет болса, бастапқы MP4 таңдаңыз. Жүктеу автоматты түрде қайта басталмайды.','При продолжении сначала проверяется сохранённое видео. Исходный MP4 нужен только для дозагрузки. Новая загрузка автоматически не создаётся.')}</p>{history(unfinished)}</details>}
 </section>;
}
