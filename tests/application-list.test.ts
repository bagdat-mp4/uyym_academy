import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ApplicationList,{ApplicationEmpty} from '../client/src/ApplicationList';

const application={id:'local-review',name:'A <script>unsafe()</script>',phone:'+7 <img src=x>',course_title:'PP1 <b>author copy</b>',status:'processing',created_at:'2026-10-20T10:00:00Z'};
test('application table keeps semantic columns, escaped owner data and a distinct details action',()=>{
 const html=renderToStaticMarkup(createElement(ApplicationList,{items:[application],lang:'en',onReview(){throw Error('SSR must not approve');}}));
 assert.ok(html.includes('<caption class="sr-only">'));
 assert.equal((html.match(/scope="col"/g)||[]).length,6);
 assert.ok(html.includes('>Contact</th>')&&html.includes('>Processing</span>'));
 for(const text of ['&lt;script&gt;unsafe()&lt;/script&gt;','&lt;img src=x&gt;','PP1 &lt;b&gt;author copy&lt;/b&gt;'])assert.ok(html.includes(text));
 assert.ok(!html.includes('<script>')&&!html.includes('<img'));
 assert.ok(html.includes('aria-label="Details: A &lt;script&gt;'));
 assert.ok(!html.includes('Verify and approve'));
});

test('processing label and useful empty/search states are localized without invented records',()=>{
 for(const [lang,label] of [['en','Processing'],['kk','Өңделуде'],['ru','Обрабатывается']] as const){
  const html=renderToStaticMarkup(createElement(ApplicationList,{items:[application],lang,onReview(){}}));
  assert.ok(html.includes(`>${label}</span>`));
  const empty=renderToStaticMarkup(createElement(ApplicationEmpty,{lang,filtered:false}));
  const filtered=renderToStaticMarkup(createElement(ApplicationEmpty,{lang,filtered:true}));
  assert.notEqual(empty,filtered);assert.ok(!empty.includes(application.name)&&!filtered.includes('60,000'));
 }
});
