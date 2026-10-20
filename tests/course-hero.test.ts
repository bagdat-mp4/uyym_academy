import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CourseHero from '../client/src/CourseHero';
import type { Course } from '../client/src/api';

const course: Course = { id: 'own', title: 'PP1 <script>unsafe()</script>', summary: 'Owner copy', price_kzt: 60000, weeks: 6, lessons: 12, hours: 18, group_capacity: 5 };

test('course hero translates its heading and real navigation in all three languages', () => {
  for (const [lang, heading, action] of [
    ['en', 'More understanding.', 'Explore courses'],
    ['kk', 'Түсініп үйрен.', 'Курстарды көру'],
    ['ru', 'Больше понимания.', 'Посмотреть курсы'],
  ] as const) {
    const html = renderToStaticMarkup(createElement(CourseHero, { lang, courses: [course] }));
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok(html.includes(heading) && html.includes(action));
    assert.ok(html.includes('aria-labelledby="course-hero-title"'));
    assert.ok(html.includes('href="#courses"') && html.includes('href="#account"'));
    // An explicitly labelled illustration never pretends to be the real account.
    assert.ok(html.includes('<figcaption>'));
    assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
    assert.ok(!html.includes('<script>') && !html.includes('<button'));
  }
});

test('hero names the actual learning entry point and never invents course offerings',()=>{
 const student=renderToStaticMarkup(createElement(CourseHero,{lang:'en',courses:[course],role:'STUDENT'}));
 assert.ok(student.includes('Open dashboard')&&student.includes('Illustration · not your account'));
 assert.ok(!student.includes('Physics')&&!student.includes('GPA')&&!student.includes('streak'));
 assert.equal((student.match(/PP1 &lt;script&gt;/g)||[]).length,1);
 const teacher=renderToStaticMarkup(createElement(CourseHero,{lang:'en',courses:[],role:'TEACHER'}));assert.ok(teacher.includes('Open workspace'));
});

test('empty course catalogue does not invent covers or load external imagery', () => {
  const html = renderToStaticMarkup(createElement(CourseHero, { lang: 'en', courses: [] }));
  assert.ok(!html.includes('hero-course-cover--'));
  assert.ok(!html.includes('<img') && !html.includes('https://'));
  assert.ok(html.includes('Explore courses'));
});
