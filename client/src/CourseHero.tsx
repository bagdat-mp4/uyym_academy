import type { Course } from './api';
import type { Lang } from './i18n';

const copy = {
  en: {
    label: 'For KBTU students',
    title: { first: 'We make', second: 'learning clear.' },
    description: 'Calculus, Linear Algebra and C++ in small groups. Classes, recordings and practice to help you prepare for your next exam.',
    courses: 'Explore courses',
    format: 'How we learn',
    note: 'Quiz, Midterm, Endterm & Final',
    scroll: 'Find your course below',
  },
  kk: {
    label: 'КБТУ студенттеріне арналған',
    title: { first: 'Түсініп оқы.', second: 'Сенімді бол.' },
    description: 'Calculus, Linear Algebra және C++ — шағын топта бірге талдаймыз. Сабақ, жазба және практика арқылы келесі емтиханға дайындал.',
    courses: 'Курстарды көру',
    format: 'Қалай оқимыз?',
    note: 'Quiz, Midterm, Endterm және Final',
    scroll: 'Өзіңе керек курсты таңда',
  },
  ru: {
    label: 'Для студентов КБТУ',
    title: { first: 'Понимай.', second: 'Учись уверенно.' },
    description: 'Calculus, Linear Algebra и C++ — разбираем вместе в небольшой группе. Занятия, записи и практика для подготовки к следующему экзамену.',
    courses: 'Посмотреть курсы',
    format: 'Как мы учимся',
    note: 'Quiz, Midterm, Endterm и Final',
    scroll: 'Выбери свой курс ниже',
  },
} as const;

function courseSymbol(title: string) {
  return /calculus/i.test(title) ? '∫' : /linear|algebra/i.test(title) ? '[A]' : /pp1|programming|c\+\+/i.test(title) ? '{ }' : '↗';
}

export default function CourseHero({ lang, courses }: { lang: Lang; courses: readonly Course[] }) {
  const text = copy[lang];
  // Repeated covers are scenery, not extra courses, statistics or actionable UI.
  // The accessible, complete course catalogue and enrolment actions follow below.
  const covers = courses.slice(0, 3);
  const arrangement = [0, 1, 2, 1, 0, 2, 0, 2, 1];

  return <section className={`course-hero course-hero--${lang}`} aria-labelledby="course-hero-title">
    <div className="course-hero-collage" aria-hidden="true">
      {covers.length > 0 && arrangement.map((index, position) => {
        const course = covers[index % covers.length];
        return <div className={`hero-course-cover hero-course-cover--${position + 1}`} key={position}>
          <span className="hero-cover-title">{course.title}</span>
          <span className="hero-cover-symbol">{courseSymbol(course.title)}</span>
          <span className="hero-cover-brand">UYYM Academy</span>
        </div>;
      })}
    </div>
    <div className="course-hero-copy">
      <p className="course-hero-label">{text.label}</p>
      <h1 id="course-hero-title"><span>{text.title.first}</span><span>{text.title.second}</span></h1>
      <p className="course-hero-description">{text.description}</p>
      <div className="course-hero-actions">
        <a className="course-hero-primary" href="#courses">{text.courses}<span aria-hidden="true">↗</span></a>
        <a className="course-hero-secondary" href="#format">{text.format}</a>
      </div>
      <p className="course-hero-note">{text.note}</p>
    </div>
    <a className="course-hero-scroll" href="#courses"><span aria-hidden="true">↓</span>{text.scroll}</a>
  </section>;
}
