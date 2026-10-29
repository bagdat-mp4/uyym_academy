import {useState} from 'react';
import {Dialog,EntitySelect,tr,type Lang} from './management';
import GroupEnrollmentDialog from './GroupEnrollmentDialog';

/** Groups carry the course context so the owner never has to choose it twice. */
export default function GroupEnrollmentFlow({initialGroupId,lang,onClose,onSaved}:{initialGroupId?:string;lang:Lang;onClose:()=>void;onSaved:()=>void}){
 const [groupId,setGroupId]=useState(initialGroupId??'');
 if(groupId)return <GroupEnrollmentDialog groupId={groupId} lang={lang} onClose={onClose} onSaved={onSaved}/>;
 return <Dialog title={tr(lang,['Топқа оқушылар қосу','Добавить учеников в группу'])} lang={lang} onClose={onClose}>
  <p className="manage-dialog-description">{tr(lang,['Алдымен топты таңдаңыз. Пән автоматты түрде анықталады.','Сначала выберите группу. Предмет определится автоматически.'])}</p>
  <EntitySelect entity="groups" label={tr(lang,['Топты таңдаңыз','Выберите группу'])} selected={groupId} onChange={setGroupId} lang={lang}/>
 </Dialog>;
}
