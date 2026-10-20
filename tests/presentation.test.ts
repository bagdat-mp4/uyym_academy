import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import ts from 'typescript';
import english from '../client/src/english.json';
import {savedLanguage,savedTheme,publicFaq,tr,locale} from '../client/src/i18n.js';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import App from '../client/src/App.js';
import AccountLink from '../client/src/AccountLink.js';
import {WorkspaceError,WorkspaceLoading} from '../client/src/Workspace.js';

test('account navigation names the real destination for guests and each role in all languages',()=>{
 for(const [lang,labels] of [
  ['en',['Sign in','Dashboard','Teaching workspace','Administration']],
  ['kk',['Кіру','Оқу кабинеті','Оқытушы кабинеті','Әкімші панелі']],
  ['ru',['Войти','Учебный кабинет','Кабинет преподавателя','Администрирование']],
 ] as const){
  [undefined,'STUDENT','TEACHER','ADMIN'].forEach((role,index)=>{
   const markup=renderToStaticMarkup(createElement(AccountLink,{lang,role:role as 'STUDENT'|'TEACHER'|'ADMIN'|undefined,current:true,onNavigate(){}}));
   assert.ok(markup.includes(labels[index]),markup);assert.ok(markup.includes('href="#account"'));assert.ok(markup.includes('aria-current="page"'));
  });
 }
});

test('new visitors default to English and light; all saved choices are retained',()=>{
 const storage=(value:string|null)=>({getItem:()=>value});
 assert.equal(savedLanguage(storage(null)),'en');assert.equal(savedTheme(storage(null)),'light');
 for(const lang of ['en','kk','ru'] as const)assert.equal(savedLanguage(storage(lang)),lang);
 assert.equal(savedLanguage(storage('invalid')),'en');assert.equal(savedTheme(storage('dark')),'dark');
 const blocked={getItem(){throw new Error('Blocked storage');}};
 assert.equal(savedLanguage(blocked),'en');assert.equal(savedTheme(blocked),'light');
 assert.equal(tr('en',['Курстар','Курсы']),'Courses');assert.equal(locale('en'),'en-GB');
});

test('deferred workspace loading/error retain translated accessible states without error details',()=>{
 for(const [lang,retry] of [['en','Reload page'],['kk','Бетті жаңарту'],['ru','Обновить страницу']] as const){
  const loading=renderToStaticMarkup(createElement(WorkspaceLoading,{lang}));assert.ok(loading.includes('role="status"'));
  const error=renderToStaticMarkup(createElement(WorkspaceError,{lang}));assert.ok(error.includes('role="alert"')&&error.includes(retry));assert.ok(!/stack|\.js|supabase|grant=/i.test(error));
 }
});

test('account header replaces public navigation with home; public header keeps course links',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 try {
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{hash:'#account'}}});
  const account=renderToStaticMarkup(createElement(App)).match(/<header[\s\S]*?<\/header>/)![0];
  assert.ok(account.includes('Back to home'));
  for(const path of ['#courses','#format','#faq','#contact'])assert.ok(!account.includes(`href="${path}"`));
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{hash:''}}});
  const homepage=renderToStaticMarkup(createElement(App)).match(/<header[\s\S]*?<\/header>/)![0];
  for(const path of ['#courses','#format','#faq','#contact'])assert.ok(homepage.includes(`href="${path}"`));
  assert.ok(homepage.includes('EN')&&homepage.includes('ҚАЗ')&&homepage.includes('RU'));
  const full=renderToStaticMarkup(createElement(App));assert.ok(full.includes('class="skip-link"')&&full.includes('id="main-content" tabindex="-1"'));assert.ok(full.includes('width="48" height="48"'));
  assert.ok(full.includes('Loading courses…'));assert.ok(!full.includes('60,000')&&!full.includes('Principles of Programming'));
 }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});

test('English catalog covers every existing UI copy pair, including roles and player',async()=>{
 const catalog:Record<string,string>=english,missing:string[]=[];
 const dir=new URL('../client/src/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>/\.tsx?$/.test(f)&&f!=='i18n.ts')){
  const source=ts.createSourceFile(file,await readFile(new URL(file,dir),'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function visit(node:ts.Node){
   let pair:ts.NodeArray<ts.Expression>|undefined;
   if(ts.isArrayLiteralExpression(node)&&node.elements.length===2&&node.elements.every(ts.isStringLiteral))pair=node.elements;
   if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments.length===2&&node.arguments.every(ts.isStringLiteral))pair=node.arguments;
   if(pair&&ts.isStringLiteral(pair[0])&&ts.isStringLiteral(pair[1])&&/[А-Яа-яӘәҚқҰұІі]/.test(pair[0].text)&&!catalog[pair[1].text])missing.push(file+': '+pair[1].text);
   ts.forEachChild(node,visit);
  }visit(source);
 }
 assert.deepEqual(missing,[]);
});

test('legacy affiliation FAQ is removed from settings in three languages; owner content stays verbatim',()=>{
 const courseFaq={question:'How do I prepare for KBTU Final?',answer:'Read chapter 3.'};
 const examFaq={question:'Where are official KBTU exam dates?',answer:'Check the university schedule.'};
 const ownerContent={question:'Өз сұрағым',answer:'My exact owner-written text'};
 const items=[courseFaq,examFaq,ownerContent,
  {question:'UYYM Academy — официальный проект КБТУ?',answer:'UYYM Academy — независимый учебный проект. Официальное партнёрство с КБТУ не заявлено.'},
  {question:'UYYM Academy КБТУ-дың ресми жобасы ма?',answer:'КБТУ-мен ресми серіктестік туралы мәлімдеме жасалмайды.'},
  {question:'Official KBTU partnership?',answer:'No partnership is claimed.'}];
 assert.deepEqual(publicFaq(items),[courseFaq,examFaq,ownerContent]);
 assert.equal(publicFaq([ownerContent])[0],ownerContent);
});
