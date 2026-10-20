import type {Course} from './api';
import {tr,type Lang} from './i18n';

export const courseTarget=(id:string)=>`course-${id}`;

/** Real catalogue anchors, not an invented active enrolment or extra courses. */
export default function SubjectStrip({courses,lang}:{courses:readonly Course[];lang:Lang}){
 if(!courses.length)return null;
 return <section className="exam-band section-transition transition-overlap"><div className="container"><nav className="subject-links" aria-label={tr(lang,['Курстар','Курсы'])}>{courses.map(course=><a href={`#${encodeURIComponent(courseTarget(course.id))}`} key={course.id}>{course.title}</a>)}</nav></div></section>;
}
