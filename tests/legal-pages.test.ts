import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import LegalPage from '../client/src/LegalPage.js';
import {pageFromLocation} from '../client/src/legal-route.js';

const settings={whatsapp:'',contact_email:''};

test('legal documents render in EN, KAZ and RU without authentication data',()=>{
 const cases=[
  {lang:'en' as const,privacy:'Privacy Policy',terms:'Terms of Service',google:'Google Drive folders managed by the academy owner'},
  {lang:'kk' as const,privacy:'Құпиялылық саясаты',terms:'Қызмет көрсету шарттары',google:'Google Drive қалталарында'},
  {lang:'ru' as const,privacy:'Политика конфиденциальности',terms:'Условия использования',google:'закрытых папках Google Drive'}
 ];
 for(const item of cases){
  const privacy=renderToStaticMarkup(React.createElement(LegalPage,{kind:'privacy',lang:item.lang,contacts:settings}));
  const terms=renderToStaticMarkup(React.createElement(LegalPage,{kind:'terms',lang:item.lang,contacts:settings}));
  assert.ok(privacy.includes(item.privacy));assert.ok(privacy.toLowerCase().includes(item.google.toLowerCase()));
  assert.ok(terms.includes(item.terms));assert.doesNotMatch(terms,/Teachers may upload MP4|teacher-upload|OAuth upload/i);assert.match(privacy,/<main[^>]*class="legal-page"/);
  assert.doesNotMatch(privacy,/login|required authentication/i);assert.doesNotMatch(privacy,/teacher-upload feature|owner-authorized Google integration|OAuth upload/i);
 }
});

test('stable legal URLs and old hash URLs resolve publicly; unrelated routes stay intact',()=>{
 assert.equal(pageFromLocation('/privacy',''),'privacy');
 assert.equal(pageFromLocation('/terms',''),'terms');
 assert.equal(pageFromLocation('/','#privacy'),'privacy');
 assert.equal(pageFromLocation('/','#terms'),'terms');
 assert.equal(pageFromLocation('/','#account'),'account');
 assert.equal(pageFromLocation('/',''),'public');
});

test('legal footer and pages have responsive mobile styling',async()=>{
 const {readFile}=await import('node:fs/promises');
 const app=await readFile(new URL('../client/src/App.tsx',import.meta.url),'utf8');
 const styles=await readFile(new URL('../client/src/styles.css',import.meta.url),'utf8');
 const server=await readFile(new URL('../server/index.ts',import.meta.url),'utf8');
 assert.match(app,/href="\/privacy"/);assert.match(app,/href="\/terms"/);
 assert.match(server,/req.method==='GET'&&req.headers.accept\?\.includes\('text\/html'\)/);
 assert.match(server,/!path.startsWith\('\/api\/'\)&&!path.startsWith\('\/assets\/'\)/);
 assert.match(styles,/@media\s*\(max-width:\s*740px\).*footer-bottom/s);
 assert.match(styles,/\.legal-page\{padding:22px 0 55px\}/);
});
