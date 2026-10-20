import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {User} from '../client/src/api';
import {tr,type Lang} from '../client/src/i18n';

// The shell imports its stylesheet for Vite. Only omit that non-JS asset in SSR.
const require=createRequire(import.meta.url),previousStyleLoader=require.extensions['.css'];
require.extensions['.css']=()=>{};
const {default:WorkspaceChrome}=require('../client/src/WorkspaceChrome') as typeof import('../client/src/WorkspaceChrome');
if(previousStyleLoader)require.extensions['.css']=previousStyleLoader;
else delete require.extensions['.css'];

const owner:User={id:'synthetic-owner',name:'Owner <name>',phone:'synthetic',role:'ADMIN',must_change_password:false};
function render(role:User['role'],lang:Lang,busy=false){
 return renderToStaticMarkup(createElement(WorkspaceChrome,{user:{...owner,role},lang,theme:'light',busy,onTheme(){},onLanguage(){},onLogout(){},children:null}));
}
function section(html:string,element:string){
 const match=html.match(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}>`));
 assert.ok(match,`${element} must exist`);return match[1];
}

test('ADMIN has one native logout button in its account menu and none in the sidebar in every locale',()=>{
 for(const lang of ['en','kk','ru'] as const){
  const html=render('ADMIN',lang),rail=section(html,'aside'),header=section(html,'header');
  const label=tr(lang,['Шығу','Выйти']);
  assert.equal((html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)||[]).filter(button=>button.includes(label)).length,1);
  assert.ok(!rail.includes('<button'),'ADMIN sidebar must not expose a second logout action');
  assert.match(header,/<details class="workspace-account-menu">/);
  assert.match(header,new RegExp(`<button><svg[\\s\\S]*?<\\/svg>${label}<\\/button>`));
  assert.ok(rail.includes('Owner &lt;name&gt;')&&header.includes('Owner &lt;name&gt;'),'Real escaped account identity remains in both places');
  const role=tr(lang,['Әкімші','Администратор']);
  assert.ok(rail.includes(role)&&header.includes(role));
  assert.ok(rail.includes('href="#"'),'Existing home link remains available');
 }
});

test('ADMIN account logout preserves the existing busy-state guard',()=>{
 const header=section(render('ADMIN','en',true),'header');
 assert.match(header,/<button disabled=""><svg[\s\S]*?<\/svg>Sign out<\/button>/);
});

test('TEACHER and STUDENT retain their sidebar and mobile logout actions in all locales',()=>{
 for(const role of ['TEACHER','STUDENT'] as const)for(const lang of ['en','kk','ru'] as const){
  const html=render(role,lang,true),rail=section(html,'aside'),header=section(html,'header');
  const label=tr(lang,['Шығу','Выйти']);
  assert.ok(rail.includes(`<span>${label}</span></button>`));
  assert.match(rail,/<button disabled=""/);
  assert.match(header,/<button class="workspace-mobile-logout theme-button" disabled=""/);
  assert.ok(!html.includes('workspace-account-menu'));
 }
});
