import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,ApiError} from './api';
import {dateLabel,Dialog,Empty,managementMutation,message,newOperation,Notice,Pager,Status,tr,type Copy,type Lang} from './management';
import {Button,UiIcon} from './ui';
import EnrollmentPeriod from './EnrollmentPeriod';
import {defaultAccessDates,enrollmentRequest,freeSeats,GROUP_BATCH_LIMIT,groupAvailable,reconcileSelection,selectionProblem,toggleStudent,type AccessDates,type GroupCandidate,type GroupCandidatePage,type GroupContext,type GroupEnrollmentRequest,type SelectedStudents} from './group-enrollment-model';

const reasons:Record<GroupCandidate['eligibility'],Copy>={
 new:['Жаңа курс қолжетімділігі','Новый доступ к курсу'],
 ungrouped:['Курсқа қолжетімділігі бар · топсыз','Есть доступ к курсу · без группы'],
 member:['Осы топта бар','Уже в этой группе'],
 other_group:['Басқа топта','В другой группе'],
 inactive:['Аккаунт белсенді емес','Аккаунт неактивен'],
 access_review:['Қолжетімділікті жеке тексеріңіз','Проверьте доступ отдельно'],
};

export function StudentChoices({items,selected,lang,disabled,onToggle}:{items:GroupCandidate[];selected:SelectedStudents;lang:Lang;disabled:boolean;onToggle:(row:GroupCandidate)=>void}){
 return <ul className="group-student-list">{items.map(row=><li key={row.user_id}><label className={`group-student-choice${selected[row.user_id]?' is-selected':''}`}>
  <input type="checkbox" checked={Boolean(selected[row.user_id])} disabled={disabled||!row.selectable||(!selected[row.user_id]&&Object.keys(selected).length>=GROUP_BATCH_LIMIT)} onChange={()=>onToggle(row)}/>
  <span className="group-student-identity"><strong>{row.name}</strong><span>{row.phone}</span><small>{tr(lang,reasons[row.eligibility])}{row.eligibility==='other_group'&&row.group_title?` · ${row.group_title}`:''}</small></span>
  {row.effective_status&&<Status status={row.effective_status} lang={lang}/>}
 </label></li>)}</ul>;
}

type Reader=(path:string,options:{proof:'api';signal:AbortSignal})=>Promise<GroupCandidatePage>;
export async function loadGroupCandidates(groupId:string,query:string,page:number,signal:AbortSignal,read:Reader=(path,options)=>api(path,options)){
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 const params=new URLSearchParams({q:query,page:String(page),page_size:'20'});
 const result=await read(`/api/admin/groups/${groupId}/students?${params}`,{proof:'api',signal});
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 return result;
}

export default function GroupEnrollmentDialog({groupId,lang,onClose,onSaved}:{groupId:string;lang:Lang;onClose:()=>void;onSaved:()=>void}){
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[reload,setReload]=useState(0);
 const [selected,setSelected]=useState<SelectedStudents>({}),[group,setGroup]=useState<GroupContext|null>(null);
 const [dates,setDates]=useState<AccessDates>({starts_at:'',expires_at:''}),[status,setStatus]=useState<'active'|'pending'>('active');
 const [state,setState]=useState<{scope:string;loading:boolean;data:GroupCandidatePage|null;error:string}>({scope:'',loading:true,data:null,error:''});
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const pending=useRef<GroupEnrollmentRequest|null>(null),operation=useRef(newOperation()),inFlight=useRef(false),initialized=useRef<string|null>(null);
 const scope=JSON.stringify([groupId,query,page,reload]),current=state.scope===scope?state.data:null,loading=state.scope!==scope||state.loading;
 const currentGroup=group?.id===groupId?group:null,locked=busy||uncertain;
 const students=Object.values(selected),newCount=students.filter(row=>row.eligibility==='new').length;
 const t=(kk:string,ru:string)=>tr(lang,[kk,ru]);
 useEffect(()=>{setSearch('');setQuery('');setPage(1);setSelected({});setGroup(null);setUncertain(false);setError('');pending.current=null;operation.current=newOperation();initialized.current=null;},[groupId]);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(1);},300);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>{
  const controller=new AbortController();setState({scope,loading:true,data:null,error:''});
  void loadGroupCandidates(groupId,query,page,controller.signal).then(result=>{
   if(controller.signal.aborted)return;
   setGroup(result.group);setSelected(previous=>reconcileSelection(previous,result.items));
   if(initialized.current!==groupId){setDates(defaultAccessDates(result.group));initialized.current=groupId;}
   setState({scope,loading:false,data:result,error:''});
  }).catch(reason=>{if(!controller.signal.aborted)setState({scope,loading:false,data:null,error:message(reason)});});
  return()=>controller.abort();
 },[groupId,query,page,reload,scope]);

 const submit=async(event?:FormEvent)=>{
  event?.preventDefault();if(inFlight.current||!currentGroup)return;
  if(!pending.current){
   const problem=selectionProblem(currentGroup,selected,dates);
   if(problem){setError(tr(lang,problem==='capacity'?['Таңдалған оқушыларға орын жеткіліксіз. Топ көлемін тексеріңіз.','Для выбранных учеников недостаточно мест. Проверьте размер группы.']:problem==='dates'?['Қолжетімділіктің басталуы мен болашақ аяқталу күнін тексеріңіз.','Проверьте начало и будущую дату окончания доступа.']:problem==='group'?['Бұл топ қазір оқушы қабылдамайды. Топ пен курс күйін тексеріңіз.','Эта группа сейчас не принимает учеников. Проверьте состояние группы и курса.']:problem==='limit'?['Бір әрекетте 100 оқушыға дейін таңдаңыз.','Выберите не более 100 учеников за одну операцию.']:['Кемінде бір оқушыны таңдаңыз.','Выберите хотя бы одного ученика.']));return;}
   pending.current=enrollmentRequest(operation.current,selected,status,newCount?dates:defaultAccessDates(currentGroup));
  }
  inFlight.current=true;setBusy(true);setError('');
  try{await managementMutation(`/api/admin/groups/${groupId}/students`,pending.current);pending.current=null;setUncertain(false);onSaved();}
  catch(reason){
   const unknown=!(reason instanceof ApiError)||reason.status===408||reason.status>=500;
   setUncertain(unknown);setError(unknown?t('Нәтиже белгісіз. Өзгеріс екі рет жасалмауы үшін сол сұрауды қайталаңыз. Терезені жапсаңыз, алдымен топ тізімін жаңартыңыз.','Результат неизвестен. Повторите тот же запрос, чтобы не выполнить изменение дважды. Если закрыть окно, сначала обновите список группы.'):message(reason));
   if(!unknown){pending.current=null;operation.current=newOperation();setSelected({});setReload(value=>value+1);}
  }finally{inFlight.current=false;setBusy(false);}
 };
 const available=currentGroup?groupAvailable(currentGroup):false,overCapacity=currentGroup?students.length>freeSeats(currentGroup):false;
 const eligible=current?.items.filter(row=>row.selectable&&!selected[row.user_id])??[];
 const allVisibleAllowed=students.length+eligible.length<=GROUP_BATCH_LIMIT;
 return <Dialog title={t('Топқа оқушылар қосу','Добавить учеников в группу')} lang={lang} onClose={onClose} busy={busy} wide><div className="group-enrollment-dialog">
  {currentGroup&&<div className="group-enrollment-context"><div><strong>{currentGroup.title}</strong><p>{currentGroup.course_title}</p></div><span>{t('Бос орын','Свободных мест')}: <strong>{freeSeats(currentGroup)}</strong> / {currentGroup.capacity}</span></div>}
  <p className="group-enrollment-intro">{t('Аккаунты ашылған оқушыларды белгілеңіз. Оқушының сайтқа алғаш кіруін күтудің қажеті жоқ.','Отметьте учеников с созданными аккаунтами. Ждать их первого входа на сайт не нужно.')}</p>
  <Notice error={error}/>
  {currentGroup&&!available&&<p className="group-enrollment-warning" role="alert">{t('Бұл топ қазір оқушы қабылдамайды. Топ пен курс күйін тексеріңіз.','Эта группа сейчас не принимает учеников. Проверьте состояние группы и курса.')}</p>}
  <div className="group-student-search"><label>{t('Оқушыны аты немесе телефоны бойынша іздеу','Поиск ученика по имени или телефону')}<input type="search" value={search} maxLength={120} autoComplete="off" disabled={locked} onChange={event=>setSearch(event.target.value)}/></label><Button type="button" onClick={()=>{setSelected(previous=>{let next=previous;for(const row of eligible)next=toggleStudent(next,row);return next;});}} disabled={locked||loading||!available||!eligible.length||!allVisibleAllowed}>{t('Осы беттегілерді таңдау','Выбрать на этой странице')}</Button></div>
  <div className="group-candidate-results" aria-busy={loading}>
   {loading?<Empty lang={lang} loading/>:state.error?<><Notice error={state.error}/><Button type="button" onClick={()=>setReload(value=>value+1)} disabled={locked}>{t('Қайта көру','Повторить')}</Button></>:current&&!current.items.length?<p className="group-student-empty">{t('Оқушылар табылмады. Атын немесе телефон нөмірін өзгертіп іздеңіз.','Ученики не найдены. Попробуйте другое имя или номер телефона.')}</p>:current&&<StudentChoices items={current.items} selected={selected} lang={lang} disabled={locked||!available} onToggle={row=>setSelected(previous=>toggleStudent(previous,row))}/>}
  </div>
  {current&&!loading&&<Pager data={current} lang={lang} setPage={next=>{if(!locked)setPage(next);}} loading={locked}/>}
  <section className="group-selected-students" aria-label={t('Таңдалған оқушылар','Выбранные ученики')}><div className="group-selection-heading"><h3>{t('Таңдалды','Выбрано')}: <span role="status">{students.length}</span></h3><Button type="button" variant="ghost" onClick={()=>setSelected({})} disabled={locked||!students.length}>{t('Таңдауды тазарту','Очистить выбор')}</Button></div>
   {students.length>0&&<ul>{students.map(row=><li key={row.user_id}><span>{row.name}<small>{row.phone}</small></span><button type="button" disabled={locked} aria-label={`${t('Таңдаудан алып тастау','Убрать из выбора')}: ${row.name}`} onClick={()=>setSelected(previous=>toggleStudent(previous,row))}><UiIcon name="close"/></button></li>)}</ul>}
  </section>
  <form className="group-access-form" onSubmit={event=>void submit(event)}>
   {<fieldset hidden={students.length>0&&newCount===0} disabled={locked||(students.length>0&&newCount===0)}><legend>{t('Жаңа курс қолжетімділігі','Новый доступ к курсу')}{newCount>0?` · ${newCount}`:''}</legend><div className="group-access-fields"><label>{t('Қолжетімділік күйі','Статус доступа')}<select value={status} onChange={event=>setStatus(event.target.value as 'active'|'pending')}><option value="active">{t('Бірден ашу','Открыть сразу')}</option><option value="pending">{t('Күтуде қалдыру','Оставить в ожидании')}</option></select></label></div>{currentGroup&&<EnrollmentPeriod dates={dates} automaticDates={()=>defaultAccessDates(currentGroup)} onChange={setDates} lang={lang} disabled={locked}/>}</fieldset>}
   <p className="group-access-note">{t('Бұл күндер мен күй тек осы курсқа алғаш қосылатындарға қолданылады. Курсқа қолжетімділігі бар оқушының мерзімі, күйі және төлемі сақталады.','Эти даты и статус применяются только к новым зачислениям на этот курс. Срок, статус и оплата уже зачисленного ученика сохраняются.')}</p>
   <p className="group-access-note">{t('Браузерді мақұлдау бөлек орындалады. Топқа қосу браузер қорғанысын алып тастамайды.','Одобрение браузера выполняется отдельно. Добавление в группу не снимает защиту браузера.')}</p>
   {overCapacity&&<p className="group-enrollment-warning" role="alert">{t('Таңдалған оқушыларға орын жеткіліксіз. Топ көлемін тексеріңіз.','Для выбранных учеников недостаточно мест. Проверьте размер группы.')}</p>}
   {students.length>=GROUP_BATCH_LIMIT&&<p className="group-access-note">{t('Бір әрекетте 100 оқушыға дейін таңдаңыз.','Выберите не более 100 учеников за одну операцию.')}</p>}
   <div className="group-enrollment-actions"><Button type="button" onClick={onClose} disabled={busy}>{t('Жабу','Закрыть')}</Button>{uncertain?<Button type="button" variant="primary" busy={busy} onClick={()=>void submit()}>{t('Сол сұрауды қайталау','Повторить тот же запрос')}</Button>:<Button type="submit" variant="primary" busy={busy} disabled={loading||!!state.error||!available||!students.length||overCapacity}>{t('Топқа қосу','Добавить в группу')}{students.length?` · ${students.length}`:''}</Button>}</div>
  </form>
 </div></Dialog>;
}
