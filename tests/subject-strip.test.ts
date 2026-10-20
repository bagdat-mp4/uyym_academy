import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SubjectStrip,{courseTarget} from '../client/src/SubjectStrip';
import type {Course} from '../client/src/api';

const course:Course={id:'own / subject',title:'PP1 <script>unsafe()</script>',summary:'Owner copy',price_kzt:60000,weeks:6,lessons:12,hours:18,group_capacity:5};

test('subject navigation uses actual catalogue targets and preserves owner copy in all locales',()=>{
 for(const [lang,label] of [['en','Courses'],['kk','Курстар'],['ru','Курсы']] as const){
  const html=renderToStaticMarkup(createElement(SubjectStrip,{lang,courses:[course]}));
  assert.ok(html.includes(`<nav class="subject-links" aria-label="${label}">`));
  const href=html.match(/href="([^"]+)"/)![1];
  assert.equal(decodeURIComponent(href.slice(1)),courseTarget(course.id));
  assert.equal((html.match(/<a /g)||[]).length,1);
  assert.ok(html.includes('PP1 &lt;script&gt;unsafe()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>')&&!html.includes('aria-current')&&!html.includes('href="#account"'));
 }
});

test('empty catalogue creates no empty floating section or invented subjects',()=>{
 assert.equal(renderToStaticMarkup(createElement(SubjectStrip,{lang:'en',courses:[]})),'');
});
