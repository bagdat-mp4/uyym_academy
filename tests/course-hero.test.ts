import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CourseHero from '../client/src/CourseHero';
import type { Course } from '../client/src/api';

const course: Course = { id: 'own', title: 'PP1 <script>unsafe()</script>', summary: 'Owner copy', price_kzt: 60000, weeks: 6, lessons: 12, hours: 18, group_capacity: 5 };

test('course hero translates its heading and real navigation in all three languages', () => {
  for (const [lang, heading, action] of [
    ['en', 'learning clear.', 'Explore courses'],
    ['kk', 'Сенімді бол.', 'Курстарды көру'],
    ['ru', 'Учись уверенно.', 'Посмотреть курсы'],
  ] as const) {
    const html = renderToStaticMarkup(createElement(CourseHero, { lang, courses: [course] }));
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok(html.includes(heading) && html.includes(action));
    assert.ok(html.includes('aria-labelledby="course-hero-title"'));
    assert.ok(html.includes('href="#courses"') && html.includes('href="#format"'));
    // Repeated art does not add duplicate destinations or expose author HTML.
    assert.ok(html.includes('class="course-hero-collage" aria-hidden="true"'));
    assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
    assert.ok(!html.includes('<script>') && !html.includes('<button'));
  }
});

test('empty course catalogue does not invent covers or load external imagery', () => {
  const html = renderToStaticMarkup(createElement(CourseHero, { lang: 'en', courses: [] }));
  assert.ok(!html.includes('hero-course-cover--'));
  assert.ok(!html.includes('<img') && !html.includes('https://'));
  assert.ok(html.includes('Explore courses'));
});
