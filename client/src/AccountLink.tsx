import {tr,type Lang} from './i18n';
import type {User} from './api';

// A navigation destination, never a course/enrollment action. Labels do not grant access.
export default function AccountLink({lang,role,current,onNavigate}:{lang:Lang;role?:User['role'];current:boolean;onNavigate:()=>void}) {
 const label=role==='ADMIN'?tr(lang,['Әкімші панелі','Администрирование']):role==='TEACHER'?tr(lang,['Оқытушы кабинеті','Кабинет преподавателя']):role==='STUDENT'?tr(lang,['Оқу кабинеті','Учебный кабинет']):tr(lang,['Кіру','Войти']);
 return <a className="button button-outline header-login" href="#account" onClick={onNavigate} aria-current={current?'page':undefined}>{label}<span aria-hidden="true">↗</span></a>;
}
