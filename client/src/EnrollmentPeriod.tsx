import {useState} from 'react';
import {dateLabel,tr,type Lang} from './management';
import {Button} from './ui';
import {localAccessDate,type AccessDates} from './group-enrollment-model';

/** New enrollments are ready to save; date inputs are an optional override. */
export default function EnrollmentPeriod({dates,automaticDates,onChange,lang,disabled=false}:{dates:AccessDates;automaticDates:()=>AccessDates;onChange:(dates:AccessDates)=>void;lang:Lang;disabled?:boolean}){
 const [editing,setEditing]=useState(false);
 const t=(kk:string,ru:string)=>tr(lang,[kk,ru]);
 return <section className="enrollment-period" aria-label={t('Қолжетімділік мерзімі','Срок доступа')}>
  <div className="enrollment-period-heading"><strong>{t('Қолжетімділік мерзімі','Срок доступа')}</strong><span>{editing?t('Қолмен өзгерту','Ручная настройка'):t('Автоматты түрде таңдалды','Выбрано автоматически')}</span></div>
  <dl><div><dt>{t('Басталуы','Начало')}</dt><dd>{dateLabel(localAccessDate(dates.starts_at),lang)}</dd></div><div><dt>{t('Аяқталуы','Окончание')}</dt><dd>{dateLabel(localAccessDate(dates.expires_at),lang)}</dd></div></dl>
  <p>{t('Алматы уақыты · UTC+5','Время Алматы · UTC+5')}</p>
  {!editing?<Button type="button" disabled={disabled} aria-expanded={false} onClick={()=>setEditing(true)}>{t('Күндерді өзгерту','Изменить даты')}</Button>:<>
   <div className="enrollment-period-inputs"><label>{t('Басталуы · Алматы UTC+5','Начало · Алматы UTC+5')}<input type="datetime-local" value={dates.starts_at} required disabled={disabled} onInput={event=>onChange({...dates,starts_at:event.currentTarget.value})} onChange={event=>onChange({...dates,starts_at:event.target.value})}/></label><label>{t('Аяқталуы · Алматы UTC+5','Окончание · Алматы UTC+5')}<input type="datetime-local" value={dates.expires_at} required disabled={disabled} onInput={event=>onChange({...dates,expires_at:event.currentTarget.value})} onChange={event=>onChange({...dates,expires_at:event.target.value})}/></label></div>
   <Button type="button" disabled={disabled} onClick={()=>{onChange(automaticDates());setEditing(false);}}>{t('Автоматты мерзімді қолдану','Использовать автоматический срок')}</Button>
  </>}
 </section>;
}
