import {useEffect,useState} from 'react';
import {api} from './api';
import {locale,tr,type Lang,type Copy} from './i18n';
import {Button,UiIcon,type IconName} from './ui';

export const applicationStatuses=['pending','processing','approved','rejected'] as const;
export type ApplicationStatus=typeof applicationStatuses[number];
export type ApplicationCounts=Record<ApplicationStatus,number|null>;
type CountReader=(path:string,options:{method:'GET';proof:'api';signal:AbortSignal})=>Promise<{total:unknown}>;
const emptyCounts=():ApplicationCounts=>({pending:null,processing:null,approved:null,rejected:null});

/** Read server totals, never count a single paginated page or change application data. */
export async function loadApplicationCounts(query:string,signal:AbortSignal,read:CountReader=(path,options)=>api(path,options)):Promise<ApplicationCounts>{
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 const settled=await Promise.allSettled(applicationStatuses.map(async status=>{
  const params=new URLSearchParams({page:'1',page_size:'1',q:query,status});
  const result=await read(`/api/admin/applications?${params}`,{method:'GET',proof:'api',signal});
  if(typeof result.total!=='number'||!Number.isSafeInteger(result.total)||result.total<0)throw new Error('Invalid count');
  return result.total;
 }));
 // A late response must never repopulate totals belonging to an older search.
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 const counts=emptyCounts();
 settled.forEach((result,index)=>{if(result.status==='fulfilled')counts[applicationStatuses[index]]=result.value;});
 return counts;
}

const cards:Record<ApplicationStatus,{label:Copy;icon:IconName;tone:string}>={
 pending:{label:['Күтуде','Ожидает'],icon:'inbox',tone:'warning'},
 processing:{label:['Өңделуде','Обрабатывается'],icon:'history',tone:'info'},
 approved:{label:['Мақұлданған','Одобрен'],icon:'check',tone:'success'},
 rejected:{label:['Қабылданбаған','Отклонён'],icon:'close',tone:'danger'},
};
type CardProps={lang:Lang;query:string;counts:ApplicationCounts;loading:boolean;selectedStatus:string;onSelect:(status:string)=>void};

/** Presentation is separate so loading, partial failures and true zeroes are reviewable. */
export function ApplicationStatCards({lang,query,counts,loading,selectedStatus,onSelect}:CardProps){
 return <div className="admin-stat-grid">{applicationStatuses.map(status=>{
  const card=cards[status],count=loading?null:counts[status];
  return <button type="button" className="admin-stat-card" data-tone={card.tone} aria-pressed={selectedStatus===status} key={status} onClick={()=>onSelect(status)}>
   <span className="admin-stat-icon"><UiIcon name={card.icon}/></span>
   <span className="admin-stat-value">{count===null?'—':new Intl.NumberFormat(locale(lang)).format(count)}</span>
   <span className="admin-stat-label">{tr(lang,card.label)}</span>
   <span className="admin-stat-note">{loading?tr(lang,['Деректер жүктелуде…','Загружаем данные…']):tr(lang,query.trim()?['Іздеу нәтижелері','Результаты поиска']:['Барлық өтінімдер','Все заявки'])}</span>
  </button>;
 })}</div>;
}

export default function ApplicationOverview({lang,query,change,selectedStatus,onSelect}:{lang:Lang;query:string;change:number;selectedStatus:string;onSelect:(status:string)=>void}){
 const [retry,setRetry]=useState(0);
 const scope=JSON.stringify([query,change,retry]);
 const [state,setState]=useState<{scope:string;counts:ApplicationCounts;loading:boolean}>({scope:'',counts:emptyCounts(),loading:true});
 useEffect(()=>{
  const controller=new AbortController();
  setState({scope,counts:emptyCounts(),loading:true});
  void loadApplicationCounts(query,controller.signal).then(counts=>{
   if(!controller.signal.aborted)setState({scope,counts,loading:false});
  }).catch(()=>{
   if(!controller.signal.aborted)setState({scope,counts:emptyCounts(),loading:false});
  });
  return ()=>controller.abort();
 },[query,change,retry,scope]);
 const loading=state.scope!==scope||state.loading;
 const failed=!loading&&applicationStatuses.some(status=>state.counts[status]===null);
 return <section className="application-overview" aria-label={tr(lang,['Курс өтінімдері','Заявки на курсы'])} aria-busy={loading}>
  <ApplicationStatCards lang={lang} query={query} counts={state.counts} loading={loading} selectedStatus={selectedStatus} onSelect={onSelect}/>
  {failed&&<div className="application-overview-error"><p role="alert">{tr(lang,['Кейбір көрсеткіштер жүктелмеді. Қайталап көріңіз.','Не удалось загрузить часть показателей. Повторите попытку.'])}</p><Button onClick={()=>setRetry(current=>current+1)}>{tr(lang,['Қайта көру','Повторить'])}</Button></div>}
 </section>;
}
