import {Component,lazy,Suspense,type ReactNode} from 'react';
import {tr,type Lang} from './i18n';
import type {User} from './api';

// Definitions live at module scope so language/status updates preserve instances.
const loadAdmin=()=>import('./AdminPanel');
const loadTeacher=()=>import('./TeacherPanel');
const loadStudent=()=>import('./LearningHub');
const AdminPanel=lazy(loadAdmin);
const TeacherPanel=lazy(loadTeacher);
const LearningHub=lazy(loadStudent);
const AdminInvitationSetup=lazy(()=>import('./AdminInvitation').then(module=>({default:module.AdminInvitationSetup})));

// Start the authorized role chunk alongside the new chrome chunk, avoiding a
// chrome -> role download waterfall. Public visitors load neither workspace.
export function preloadWorkspace(role:User['role']){
 void (role==='ADMIN'?loadAdmin():role==='TEACHER'?loadTeacher():loadStudent()).catch(()=>{/* The boundary offers reload if rendering also fails. */});
}

export function WorkspaceLoading({lang}:{lang:Lang}){
 return <div className="state-card" role="status"><span className="spinner" aria-hidden="true"/><p>{tr(lang,['Деректер жүктелуде…','Загружаем данные…'])}</p></div>;
}
export function WorkspaceError({lang}:{lang:Lang}){
 return <section className="state-card" role="alert"><h2>{tr(lang,['Кабинетті жүктеу мүмкін болмады','Не удалось загрузить кабинет'])}</h2><p>{tr(lang,['Байланысты тексеріп, бетті жаңартыңыз.','Проверьте соединение и обновите страницу.'])}</p><button className="button button-yellow" onClick={()=>window.location.reload()}>{tr(lang,['Бетті жаңарту','Обновить страницу'])}</button></section>;
}
export class WorkspaceBoundary extends Component<{lang:Lang;children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<WorkspaceError lang={this.props.lang}/>:this.props.children;}
}
export default function Workspace({lang,role,onAccountUpdated}:{lang:Lang;role:User['role'];onAccountUpdated:()=>void}){
 return <WorkspaceBoundary lang={lang}><Suspense fallback={<WorkspaceLoading lang={lang}/>}>
  {role==='ADMIN'?<AdminPanel lang={lang}/>:<AdminInvitationSetup lang={lang} onDone={onAccountUpdated}>{role==='TEACHER'?<TeacherPanel lang={lang}/>:<LearningHub lang={lang} role="STUDENT"/>}</AdminInvitationSetup>}
 </Suspense></WorkspaceBoundary>;
}
