import './workspace.css';
import {useState,type ReactNode} from 'react';
import type {User} from './api';
import {tr,type Lang} from './i18n';
import {UiIcon} from './ui';
import ThemeControl from './ThemeControl';
import type {ThemePreference} from './i18n';
import {WorkspaceHeadingContext} from './workspace-heading';

export type AppearanceProps={theme:ThemePreference;onTheme:(theme:ThemePreference)=>void;onLanguage:(lang:Lang)=>void};
export default function WorkspaceChrome({user,lang,theme,onTheme,onLanguage,onLogout,busy,children}:{user:User;lang:Lang;onLogout:()=>void;busy:boolean;children:ReactNode}&AppearanceProps){
 const role=tr(lang,user.role==='ADMIN'?['Әкімші','Администратор']:user.role==='TEACHER'?['Оқытушы','Преподаватель']:['Оқушы','Ученик']);
 const [heading,setHeading]=useState<string|null>(null);
 const admin=user.role==='ADMIN';
 return <div className={`workspace-frame${admin?' workspace-admin':''}`}>
  <aside className="workspace-rail" aria-label="UYYM Academy"><a href="#" className="workspace-brand" aria-label="UYYM Academy"><img src="/brand.png" alt="" width="40" height="40"/><span><strong>UYYM</strong><small>Academy</small></span></a><div className="workspace-rail-bottom"><a href="#" title={tr(lang,['Басты бетке','На главную'])} aria-label={tr(lang,['Басты бетке','На главную'])}><UiIcon name="home"/><span>{tr(lang,['Басты бетке','На главную'])}</span></a><div className="workspace-profile" aria-label={`${user.name} · ${role}`}><span className="profile-avatar" aria-hidden="true">{user.name.slice(0,1)||'U'}</span><span><strong>{user.name}</strong><small>{role}</small></span></div>{!admin&&<button onClick={onLogout} disabled={busy} title={tr(lang,['Шығу','Выйти'])} aria-label={tr(lang,['Шығу','Выйти'])}><UiIcon name="logout"/><span>{tr(lang,['Шығу','Выйти'])}</span></button>}</div></aside>
  <header className="workspace-topbar"><div className="workspace-location"><a href="#" aria-label={tr(lang,['Басты бетке','На главную'])}>UYYM Academy</a><span aria-hidden="true">/</span><h1>{admin&&heading?heading:role}</h1></div><div className="workspace-appearance"><div className="language-switch" role="group" aria-label={tr(lang,['Тіл','Язык'])}>{(['en','kk','ru'] as const).map(code=><button type="button" key={code} lang={code} aria-pressed={lang===code} onClick={()=>onLanguage(code)}>{code==='kk'?'ҚАЗ':code.toUpperCase()}</button>)}</div><ThemeControl lang={lang} value={theme} onChange={onTheme}/>{admin?<details className="workspace-account-menu" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label={`${tr(lang,['Аккаунт мәзірі','Меню аккаунта'])}: ${user.name}`}><span className="profile-avatar" aria-hidden="true">{user.name.slice(0,1)||'U'}</span><span className="account-menu-name">{user.name}</span><span aria-hidden="true">⌄</span></summary><div className="account-menu-panel"><strong>{user.name}</strong><small>{role}</small><button onClick={onLogout} disabled={busy}><UiIcon name="logout"/>{tr(lang,['Шығу','Выйти'])}</button></div></details>:<button className="workspace-mobile-logout theme-button" onClick={onLogout} disabled={busy} aria-label={tr(lang,['Шығу','Выйти'])}><UiIcon name="logout"/></button>}</div></header>
  <WorkspaceHeadingContext value={setHeading}><div className="workspace-canvas">{children}</div></WorkspaceHeadingContext>
 </div>;
}
