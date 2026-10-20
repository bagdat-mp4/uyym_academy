import {useState,type ButtonHTMLAttributes,type ReactNode} from 'react';
import {tr,type Lang,type Copy} from './i18n';
import {Dialog} from './management';

export type IconName='home'|'book'|'people'|'inbox'|'calendar'|'file'|'shield'|'settings'|'history'|'arrow'|'play'|'check'|'menu'|'logout'|'sun'|'moon'|'close'|'search'|'refresh';
const paths:Record<IconName,ReactNode>={
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/></>,
 home:<><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>,book:<><path d="M12 5c-3-2-7-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1Z"/><path d="M12 5v15"/></>,
 people:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4c3 0 4 2 4 4v3"/></>,inbox:<><path d="M4 4h16l2 11v5H2v-5L4 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/></>,
 calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 5h3"/></>,file:<><path d="M5 2h9l5 5v15H5zM14 2v6h5M8 13h8m-8 4h6"/></>,shield:<><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/></>,
 settings:<><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></>,history:<><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2"/></>,
 arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,play:<path d="m9 5 11 7-11 7z"/>,check:<path d="m4 12 5 5L20 6"/>,menu:<path d="M4 6h16M4 12h16M4 18h16"/>,logout:<><path d="M9 4H3v16h6m5-13 5 5-5 5m-5-5h12"/></>,sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>,moon:<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>,close:<path d="m6 6 12 12M6 18 18 6"/>
};
export function UiIcon({name}:{name:IconName}){return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;}
export function Button({variant='secondary',busy=false,children,className='',disabled,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'accent'|'secondary'|'ghost'|'destructive';busy?:boolean}){return <button {...props} disabled={disabled||busy} aria-busy={busy||undefined} className={`ui-button ui-button-${variant} ${className}`}>{busy&&<span className="spinner" aria-hidden="true"/>}{children}</button>;}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'success'|'warning'}){return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;}
export function PageHeader({title,description,actions}:{title:string;description?:string;actions?:ReactNode}){return <div className="ui-page-header"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{actions&&<div className="ui-page-actions">{actions}</div>}</div>;}
export function Skeleton({label}:{label:string}){return <div className="ui-skeleton" role="status"><span className="sr-only">{label}</span><i/><i/><i/></div>;}
export type NavigationItem={id:string;label:Copy;icon:IconName;group?:Copy};
export function WorkspaceNav({items,current,onSelect,lang}:{items:NavigationItem[];current:string;onSelect:(id:string)=>void;lang:Lang}){
 const [open,setOpen]=useState(false);
 const links=<nav aria-label={tr(lang,['Кабинет бөлімдері','Разделы кабинета'])}>{items.map((item,index)=><div key={item.id}>{item.group&&item.group[1]!==items[index-1]?.group?.[1]&&<p className="nav-group-label">{tr(lang,item.group)}</p>}<button type="button" title={tr(lang,item.label)} aria-current={current===item.id?'page':undefined} onClick={()=>{onSelect(item.id);setOpen(false);}}><UiIcon name={item.icon}/><span>{tr(lang,item.label)}</span>{current===item.id&&<span className="nav-current-dot"/>}</button></div>)}<a className="workspace-nav-home" href="#"><UiIcon name="home"/>{tr(lang,['Басты бетке','На главную'])}</a></nav>;
 return <><div className="workspace-navigation">{links}</div><Button className="workspace-mobile-trigger" aria-label={tr(lang,['Кабинет мәзірі','Меню кабинета'])} aria-haspopup="dialog" onClick={()=>setOpen(true)}><UiIcon name="menu"/><span>{tr(lang,items.find(item=>item.id===current)?.label??['Бөлімдер','Разделы'])}</span></Button>{open&&<Dialog title={tr(lang,['Кабинет мәзірі','Меню кабинета'])} lang={lang} onClose={()=>setOpen(false)}><div className="workspace-mobile-navigation">{links}</div></Dialog>}</>;
}
