import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice,message,type Lang} from './management';

type Status={configured:boolean;connected:boolean;can_connect:boolean;email?:string;quota_available?:boolean;quota?:{limit?:string;usage?:string;usageInDrive?:string}};
type Teacher={id:string;name:string;enabled:boolean};
type Activity={action:string;offset_bytes:number;created_at:string;teacher_name:string;lesson_title:string;week:number};
const copy=(lang:Lang,en:string,kk:string,ru:string)=>lang==='en'?en:lang==='kk'?kk:ru;
const gigabytes=(bytes?:string)=>bytes&&Number.isFinite(Number(bytes))?(Number(bytes)/1073741824).toFixed(1)+' GB':'—';
const megabytes=(bytes:number)=>Number.isFinite(bytes)?(bytes/1048576).toFixed(1)+' MB':'—';
const activityLabel=(lang:Lang,action:string)=>({started:copy(lang,'Started','Басталды','Начато'),progress:copy(lang,'In progress','Жүктелуде','В процессе'),completed:copy(lang,'Completed','Аяқталды','Завершено'),failed:copy(lang,'Failed','Қате','Ошибка'),cancelled:copy(lang,'Cancelled','Бас тартылды','Отменено')} as Record<string,string>)[action]??action;
const localDate=(lang:Lang,value:string)=>new Intl.DateTimeFormat(lang==='kk'?'kk-KZ':lang==='ru'?'ru-RU':'en-US',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Almaty'}).format(new Date(value));

export default function OwnerDriveAdmin({lang,oauthError='',oauthSuccess=''}:{lang:Lang;oauthError?:string;oauthSuccess?:string}){
 const [status,setStatus]=useState<Status|null>(null),[teachers,setTeachers]=useState<Teacher[]>([]),[events,setEvents]=useState<Activity[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const load=async()=>{const [drive,access,activity]=await Promise.all([
  api<Status>('/api/admin/owner-drive',{proof:'api'}),api<{teachers:Teacher[]}>('/api/admin/teacher-video-access',{proof:'api'}),api<{events:Activity[]}>('/api/admin/video-upload-activity',{proof:'api'})]);
  setStatus(drive);setTeachers(access.teachers);setEvents(activity.events);
 };
 useEffect(()=>{void load().catch(reason=>setError(message(reason)));},[]);
 useEffect(()=>{const connected=()=>void load().catch(reason=>setError(message(reason)));window.addEventListener('uyym-drive-connected',connected);return()=>window.removeEventListener('uyym-drive-connected',connected);},[]);
 const connect=async()=>{setBusy(true);setError('');try{
  const result=await api<{url:string;state:string}>('/api/admin/owner-drive/connect',{method:'POST',proof:'api',body:{}});
  sessionStorage.setItem('uyym-drive-oauth-state',result.state);window.location.assign(result.url);
 }catch(reason){setError(message(reason));setBusy(false);}};
 const toggle=async(row:Teacher)=>{setBusy(true);setError('');try{
  await api(`/api/admin/teacher-video-access/${row.id}`,{method:'PATCH',proof:'api',body:{enabled:!row.enabled}});
  await load();setSuccess(copy(lang,'Upload permission updated.','Жүктеу рұқсаты жаңартылды.','Разрешение на загрузку обновлено.'));
 }catch(reason){setError(message(reason));}finally{setBusy(false);}};
 return <section className="dashboard-panel manage-panel video-upload-panel"><div className="panel-heading"><div><div className="eyebrow">UYYM ACADEMY · PRIVATE DRIVE</div><h2>{copy(lang,'Teacher video uploads','Мұғалімдердің видео жүктеуі','Загрузка видео преподавателями')}</h2></div><button className="button button-outline" onClick={()=>void load().catch(reason=>setError(message(reason)))}>{copy(lang,'Refresh','Жаңарту','Обновить')}</button></div>
  <Notice error={error||oauthError} success={success||oauthSuccess}/>
  <div className="manage-record"><div className="manage-record-info"><h3>{copy(lang,'Owner Drive connection','Иесінің Drive байланысы','Подключение Drive владельца')}</h3><p>{status?.connected?`${copy(lang,'Connected','Қосылған','Подключен')}${status.email?`: ${status.email}`:''}`:copy(lang,'Not connected','Қосылмаған','Не подключен')}</p>{status?.quota_available&&<p>{copy(lang,'Storage used','Қолданылған сақтау орны','Использовано хранилища')}: {gigabytes(status.quota?.usage)} / {gigabytes(status.quota?.limit)}</p>}<p className="form-help">{copy(lang,'Only the configured owner account may connect. A private UYYM folder is created in that account and shared read-only with the backend identity. Teachers never receive Google credentials.','Тек көрсетілген иесінің аккаунты қосылады. Сол аккаунтта жабық UYYM папкасы ашылып, backend оқу құқығын алады. Мұғалімдер Google құпия деректерін алмайды.','Подключить может только заданный аккаунт владельца. В нём создаётся закрытая папка UYYM с доступом backend только на чтение. Преподаватели не получают данные Google.')}</p></div><div className="manage-record-actions">{status?.can_connect&&<button className="button button-yellow" disabled={!status.configured||busy} onClick={()=>void connect()}>{status.connected?copy(lang,'Reconnect owner Drive','Drive-ты қайта қосу','Переподключить Drive'):copy(lang,'Connect owner Drive','Иесінің Drive-ын қосу','Подключить Drive владельца')}</button>}</div></div>
  {!status?.configured&&<div className="alert alert-error" role="status">{copy(lang,'Server-side Google OAuth settings are required before connection.','Қосу үшін сервердегі Google OAuth баптаулары қажет.','Для подключения нужны серверные настройки Google OAuth.')}</div>}
  <div className="manage-subheading"><h3>{copy(lang,'Teacher upload access','Мұғалімдердің жүктеу рұқсаты','Доступ преподавателей к загрузке')}</h3></div>
  <div className="manage-records">{teachers.map(row=><article className="manage-record" key={row.id}><div className="manage-record-info"><h4>{row.name}</h4><p>{row.enabled?copy(lang,'Upload enabled','Жүктеу ашық','Загрузка разрешена'):copy(lang,'Upload disabled','Жүктеу жабық','Загрузка запрещена')}</p></div><div className="manage-record-actions"><button className="button button-outline" disabled={busy||!status?.connected} onClick={()=>void toggle(row)}>{row.enabled?copy(lang,'Revoke upload access','Жүктеуді тоқтату','Отозвать доступ'):copy(lang,'Allow upload','Жүктеуге рұқсат','Разрешить загрузку')}</button></div></article>)}</div>
  <div className="manage-subheading"><h3>{copy(lang,'Recent upload activity','Соңғы жүктеу әрекеттері','Недавние загрузки')}</h3></div><div className="manage-records">{events.map((event,index)=><div className="manage-record" key={`${event.created_at}-${index}`}><div className="manage-record-info"><strong>{event.lesson_title}</strong><p>{event.teacher_name} · {activityLabel(lang,event.action)} · {megabytes(event.offset_bytes)} · {localDate(lang,event.created_at)}</p></div></div>)}</div>
 </section>;
}
