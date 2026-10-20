import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ApplicationOverview,{ApplicationStatCards,applicationStatuses,loadApplicationCounts} from '../client/src/ApplicationOverview';

test('application overview reads four protected status totals in parallel, scoped to the exact search',async()=>{
 const controller=new AbortController(),pending:{resolve:(value:{total:unknown})=>void}[]=[],calls:{path:string;options:{method:'GET';proof:'api';signal:AbortSignal}}[]=[];
 const query='PP1 + Қ & <applicant>',loading=loadApplicationCounts(query,controller.signal,(path,options)=>{
  calls.push({path,options});return new Promise(resolve=>pending.push({resolve}));
 });
 assert.equal(calls.length,4,'independent count requests must start before any response resolves');
 for(const [index,call] of calls.entries()){
  const url=new URL(call.path,'https://local.invalid');
  assert.equal(url.pathname,'/api/admin/applications');
  assert.deepEqual(Object.fromEntries(url.searchParams),{page:'1',page_size:'1',q:query,status:applicationStatuses[index]});
  assert.equal(call.options.method,'GET');assert.equal(call.options.proof,'api');assert.equal(call.options.signal,controller.signal);
 }
 // Total 51 deliberately exceeds both one returned row and the normal 20-row page.
 pending.forEach((item,index)=>item.resolve({total:[51,2,0,9][index]}));
 assert.deepEqual(await loading,{pending:51,processing:2,approved:0,rejected:9});
});

test('application count failures remain unknown while successful status totals survive',async()=>{
 const result=await loadApplicationCounts('',new AbortController().signal,async path=>{
  const status=new URL(path,'https://local.invalid').searchParams.get('status');
  if(status==='processing')throw new Error('private backend details must not be surfaced');
  if(status==='rejected')return {total:-1};
  return {total:status==='approved'?0:23};
 });
 assert.deepEqual(result,{pending:23,processing:null,approved:0,rejected:null});
 for(const invalid of [undefined,null,'3',NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){
  const invalidResult=await loadApplicationCounts('',new AbortController().signal,async()=>({total:invalid}));
  assert.deepEqual(Object.values(invalidResult),[null,null,null,null]);
 }
});

test('application count loading rejects an already aborted or stale request without returning totals',async()=>{
 const stopped=new AbortController();stopped.abort();let called=false;
 await assert.rejects(loadApplicationCounts('',stopped.signal,async()=>{called=true;return {total:1};}),{name:'AbortError'});
 assert.equal(called,false);
 const controller=new AbortController(),responses:{resolve:(value:{total:unknown})=>void}[]=[];
 const result=loadApplicationCounts('old search',controller.signal,(_path,options)=>{
  assert.equal(options.signal,controller.signal);
  return new Promise(resolve=>responses.push({resolve}));
 });
 controller.abort();responses.forEach(response=>response.resolve({total:99}));
 await assert.rejects(result,{name:'AbortError'});
});

test('application KPI markup distinguishes selected status, true zero and failed or loading counts',()=>{
 const props={lang:'en' as const,query:'',counts:{pending:51,processing:null,approved:0,rejected:9},loading:false,selectedStatus:'processing',onSelect(){}};
 const html=renderToStaticMarkup(createElement(ApplicationStatCards,props));
 assert.equal((html.match(/class="admin-stat-card"/g)||[]).length,4);
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 assert.deepEqual(Array.from(html.matchAll(/<button[^>]*data-tone="([^"]+)"[^>]*>[\s\S]*?class="admin-stat-label">([^<]+)<\/span>[\s\S]*?<\/button>/g),match=>[match[2],match[1]]),[['Pending','warning'],['Processing','info'],['Approved','success'],['Rejected','danger']]);
 assert.ok(html.includes('>51</span>')&&html.includes('>0</span>')&&html.includes('>—</span>'));
 const loading=renderToStaticMarkup(createElement(ApplicationStatCards,{...props,loading:true}));
 assert.equal((loading.match(/>—<\/span>/g)||[]).length,4);assert.ok(!loading.includes('>51</span>')&&!loading.includes('>0</span>'));
 const initial=renderToStaticMarkup(createElement(ApplicationOverview,{lang:'en',query:'PP1',change:0,selectedStatus:'',onSelect(){}}));
 assert.ok(initial.includes('aria-busy="true"'));assert.equal((initial.match(/>—<\/span>/g)||[]).length,4);
});

test('each KPI button selects its exact server status and shared labels support EN/KK/RU',()=>{
 const selected:string[]=[];
 const cards=ApplicationStatCards({lang:'en',query:'',counts:{pending:1,processing:2,approved:3,rejected:4},loading:false,selectedStatus:'',onSelect:status=>selected.push(status)});
 for(const card of cards.props.children)card.props.onClick();
 assert.deepEqual(selected,[...applicationStatuses]);
 for(const [lang,label] of [['en','Processing'],['kk','Өңделуде'],['ru','Обрабатывается']] as const){
  const html=renderToStaticMarkup(createElement(ApplicationStatCards,{lang,query:'',counts:{pending:0,processing:0,approved:0,rejected:0},loading:false,selectedStatus:'',onSelect(){}}));
  assert.ok(html.includes(label),html);
 }
});
