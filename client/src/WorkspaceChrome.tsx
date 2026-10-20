import './workspace.css';
import type {ReactNode} from 'react';
import type {User} from './api';
import {tr,type Lang} from './i18n';
import {UiIcon} from './ui';
import ThemeControl from './ThemeControl';
import type {ThemePreference} from './i18n';

export type AppearanceProps={theme:ThemePreference;onTheme:(theme:ThemePreference)=>void;onLanguage:(lang:Lang)=>void};
export default function WorkspaceChrome({user,lang,theme,onTheme,onLanguage,onLogout,busy,children}:{user:User;lang:Lang;onLogout:()=>void;busy:boolean;children:ReactNode}&AppearanceProps){
 const role=tr(lang,user.role==='ADMIN'?['Әкімші','Администратор']:user.role==='TEACHER'?['Оқытушы','Преподаватель']:['Оқушы','Ученик']);
 return <div className="workspace-frame">
  <aside className="workspace-rail" aria-label="UYYM Academy"><a href="#" className="workspace-brand"><img src="/brand.png" alt="" width="40" height="40"/><span><strong>UYYM</strong><small>Academy</small></span></a><div className="workspace-rail-bottom"><a href="#"><UiIcon name="home"/>{tr(lang,['Басты бетке','На главную'])}</a><div className="workspace-profile"><span className="profile-avatar" aria-hidden="true">{user.name.slice(0,1)||'U'}</span><span><strong>{user.name}</strong><small>{role}</small></span></div><button onClick={onLogout} disabled={busy}><UiIcon name="logout"/>{tr(lang,['Шығу','Выйти'])}</button></div></aside>
  <header className="workspace-topbar"><div className="workspace-location"><a href="#" aria-label={tr(lang,['Басты бетке','На главную'])}>UYYM Academy</a><span aria-hidden="true">/</span><h1>{role}</h1></div><div className="workspace-appearance"><div className="language-switch" role="group" aria-label={tr(lang,['Тіл','Язык'])}>{(['en','kk','ru'] as const).map(code=><button type="button" key={code} lang={code} aria-pressed={lang===code} onClick={()=>onLanguage(code)}>{code==='kk'?'ҚАЗ':code.toUpperCase()}</button>)}</div><ThemeControl lang={lang} value={theme} onChange={onTheme}/><button className="workspace-mobile-logout theme-button" onClick={onLogout} disabled={busy} aria-label={tr(lang,['Шығу','Выйти'])}><UiIcon name="logout"/></button></div></header>
  <div className="workspace-canvas">{children}</div>
 </div>;
}
