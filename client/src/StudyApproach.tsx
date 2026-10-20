import type {Lang} from './i18n';
const copy={
 en:{before:'Too many topics. Too little structure.',problem:'A quiz is coming, but scattered notes and unfinished problems make it hard to know where to begin.',after:'One topic. Then the next.',solution:'Choose your subject, work through the problems in class, and use recordings and assignments to review at your own pace.'},
 kk:{before:'Тақырып көп. Жүйе жетіспейді.',problem:'Quiz жақындап қалды. Шашыраңқы конспект пен аяқталмаған есептің қайсысынан бастарыңды білмейсің.',after:'Бір тақырыптан келесісіне.',solution:'Пәніңді таңда. Сабақта есепті бірге талда. Жазба мен тапсырмалар арқылы өз қарқыныңмен қайтала.'},
 ru:{before:'Тем много. Порядка не хватает.',problem:'Quiz уже скоро, а разрозненные конспекты и нерешённые задачи мешают понять, с чего начать.',after:'Одна тема. Затем следующая.',solution:'Выбери предмет, разбери задачи на занятии и повторяй по записям и заданиям в своём темпе.'},
} as const;
export default function StudyApproach({lang}:{lang:Lang}){const text=copy[lang];return <section className="section neo-approach" aria-label={text.after}><div className="container neo-approach-grid"><article><h2>{text.before}</h2><p>{text.problem}</p></article><article><h2>{text.after}</h2><p>{text.solution}</p></article></div></section>;}
