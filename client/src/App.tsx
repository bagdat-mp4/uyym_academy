import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, setCsrfToken, type AuthStatus, type BrowserRequest, type Course, type Lesson, type PublicData } from './api';
import { browserLabel, publicBrowserKey } from './device';
import ProtectedPlayer from './ProtectedPlayer';
import AdminPanel from './AdminPanel';
import TeacherPanel from './TeacherPanel';
import LearningHub from './LearningHub';

type Lang = 'kk' | 'ru';
const initialCourses: Course[] = [
  { id: 'calculus-i', title: 'Calculus I', summary: 'Функциялар, шектер, туынды және интеграл. Есептің шешімін қадам сайын түсіну.', price_kzt: 60000, weeks: 6, lessons: 12, hours: 18, group_capacity: 5 },
  { id: 'linear-algebra', title: 'Linear Algebra', summary: 'Матрицалар, векторлар және сызықтық жүйелер. Абстрактілі ұғымдарды жүйелеу.', price_kzt: 60000, weeks: 6, lessons: 12, hours: 18, group_capacity: 5 },
  { id: 'pp1', title: 'PP1 · C++', summary: 'Principles of Programming I. Логикадан алғашқы C++ бағдарламаларына дейін.', price_kzt: 60000, weeks: 6, lessons: 12, hours: 18, group_capacity: 5 },
];
const ruSummaries = ['Функции, пределы, производные и интегралы. Разбираем решение задачи шаг за шагом.', 'Матрицы, векторы и линейные системы. Превращаем абстрактные понятия в понятную систему.', 'Principles of Programming I. От логики до первых программ на C++.'];

function Icon({ name, className = '' }: { name: 'arrow' | 'arrow-up' | 'lock' | 'clock' | 'people' | 'book' | 'check' | 'menu' | 'close' | 'logout' | 'laptop' | 'play' | 'calendar' | 'message'; className?: string }) {
  const paths: Record<string, ReactNode> = {
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    'arrow-up': <><path d="M6 18 18 6M6 6h12v12" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5" /></>,
    book: <><path d="M12 5C8 2 3 4 3 4v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1ZM12 5v15" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    logout: <><path d="M9 4H4v16h5M10 12h10m-4-4 4 4-4 4" /></>,
    laptop: <><rect x="4" y="3" width="16" height="13" rx="2" /><path d="m4 16-2 4h20l-2-4" /></>,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2" /></>,
    message: <path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z" />,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatMoney(value: number) { return `${new Intl.NumberFormat('kk-KZ').format(value)} ₸`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Сұрауды орындау мүмкін болмады.'; }
function Brand({ small = false }: { small?: boolean }) {
  return <a className={`brand ${small ? 'brand-small' : ''}`} href="#" aria-label="UYYM Academy"><img src="/brand.png" alt="UYYM Academy логотипі" /><span><strong>UYYM<span className="brand-yellow">.</span></strong><small>ACADEMY</small></span></a>;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => localStorage.getItem('uyym-language') === 'ru' ? 'ru' : 'kk');
  const [page, setPage] = useState<'public' | 'account'>(() => window.location.hash.startsWith('#account') ? 'account' : 'public');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [data, setData] = useState<PublicData>({ courses: initialCourses, settings: {} });
  const [publicOffline, setPublicOffline] = useState(false);
  const [enrollment, setEnrollment] = useState<Course | null>(null);
  const [applicantName, setApplicantName] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationSent, setApplicationSent] = useState(false);
  const [status, setStatus] = useState<AuthStatus>({ authenticated: false });
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);
  const t = (kk: string, ru: string) => lang === 'kk' ? kk : ru;

  const applyStatus = useCallback((next: AuthStatus) => { setStatus(next); setCsrfToken(next.csrf_token); setExpired(false); }, []);
  const refreshStatus = useCallback(async () => {
    const next = await api<AuthStatus>('/api/auth/status'); applyStatus(next); return next;
  }, [applyStatus]);
  useEffect(() => {
    document.documentElement.lang = lang; localStorage.setItem('uyym-language', lang);
  }, [lang]);
  useEffect(() => {
    const changed = () => { void api<PublicData>('/api/public').then(setData).catch(() => setPublicOffline(true)); };
    const permissionChanged = () => { void refreshStatus().catch(() => applyStatus({ authenticated: false })); };
    window.addEventListener('uyym-data-changed', changed);
    window.addEventListener('uyym-management-permissions-changed', permissionChanged);
    return () => { window.removeEventListener('uyym-data-changed', changed); window.removeEventListener('uyym-management-permissions-changed', permissionChanged); };
  }, [applyStatus, refreshStatus]);
  useEffect(() => {
    if (!enrollment) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEnrollment(null);
      if (event.key !== 'Tab') return;
      const elements = Array.from(document.querySelectorAll<HTMLElement>('.modal button:not(:disabled), .modal a[href], .modal input'));
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', keyboard); };
  }, [enrollment]);
  useEffect(() => {
    void api<PublicData>('/api/public').then(result => { setData(result); setPublicOffline(false); }).catch(() => setPublicOffline(true));
    void refreshStatus().catch(() => setStatus({ authenticated: false })).finally(() => setChecking(false));
    const expiredHandler = () => { setExpired(true); setStatus({ authenticated: false }); setCsrfToken(''); };
    const navigate = () => { setPage(window.location.hash.startsWith('#account') ? 'account' : 'public'); setMobileMenu(false); };
    window.addEventListener('uyym-session-expired', expiredHandler); window.addEventListener('hashchange', navigate);
    return () => { window.removeEventListener('uyym-session-expired', expiredHandler); window.removeEventListener('hashchange', navigate); };
  }, [refreshStatus]);
  const goAccount = () => { setPage('account'); window.location.hash = 'account'; setEnrollment(null); setMobileMenu(false); window.scrollTo(0, 0); };
  const goHome = () => { setPage('public'); window.location.hash = ''; setMobileMenu(false); window.scrollTo(0, 0); };
  const whatsapp = data.settings.whatsapp?.replace(/\D/g, '');
  const openEnrollment = (course: Course) => { setEnrollment(course); setApplicantName(''); setApplicantPhone(''); setApplicationError(''); setApplicationSent(false); };
  const submitApplication = async (event: FormEvent) => {
    event.preventDefault(); if (!enrollment || applicationBusy) return;
    setApplicationBusy(true); setApplicationError('');
    try {
      await api('/api/applications', { method: 'POST', body: { name: applicantName, phone: applicantPhone, course_id: enrollment.id } });
      setApplicationSent(true);
    } catch (reason) { setApplicationError(errorText(reason)); }
    finally { setApplicationBusy(false); }
  };

  return <>
    <div className="announcement"><span className="announcement-dot" />{t('Білімді жүйеле. Өзіңе сенімді бол.', 'Упорядочь знания. Готовься уверенно.')}<span className="announcement-right">Quiz · Midterm · Endterm · Final</span></div>
    <header className="site-header"><div className="container header-inner"><div onClick={goHome}><Brand /></div><nav className={mobileMenu ? 'desktop-nav nav-open' : 'desktop-nav'} aria-label={t('Негізгі мәзір', 'Основное меню')}>
      <a href="#courses" onClick={() => setPage('public')}>{t('Курстар', 'Курсы')}</a><a href="#format" onClick={() => setPage('public')}>{t('Оқу форматы', 'Формат')}</a><a href="#faq" onClick={() => setPage('public')}>FAQ</a><a href="#contact" onClick={() => setPage('public')}>{t('Байланыс', 'Контакты')}</a>
    </nav><div className="header-actions"><button className="language-button" onClick={() => setLang(lang === 'kk' ? 'ru' : 'kk')} aria-label={t('Орысшаға ауыстыру', 'Переключить на казахский')}>{lang === 'kk' ? 'RU' : 'ҚАЗ'}</button><button className="button button-outline header-login" onClick={goAccount}><Icon name="lock" />{t('Жеке кабинет', 'Личный кабинет')}</button><button className="menu-button" onClick={() => setMobileMenu(value => !value)} aria-label={t('Мәзір', 'Меню')} aria-expanded={mobileMenu}><Icon name={mobileMenu ? 'close' : 'menu'} /></button></div></div></header>
    {page === 'public' ? <main>
      <section className="hero"><div className="container hero-grid"><div className="hero-copy"><div className="eyebrow"><span />{t('КБТУ студенттеріне арналған', 'Для студентов КБТУ')}</div><h1>{t('Емтиханға', 'К экзаменам')}<br />{t('сеніммен.', 'уверенно.')}<br /><span className="highlight">{t('Білімге жүйемен.', 'К знаниям системно.')}</span></h1><p className="hero-description">{t('Calculus, Linear Algebra және C++ — шағын топта түсініп үйрен. Сабақ, практика және емтиханға дайындық бір жерде.', 'Calculus, Linear Algebra и C++ — учись понимать в небольшой группе. Занятия, практика и подготовка к экзаменам в одном месте.')}</p><div className="hero-actions"><a className="button button-yellow button-large" href="#courses">{t('Курсқа жазылу', 'Выбрать курс')}<Icon name="arrow" /></a><a className="text-link" href="#format">{t('Қалай оқимыз?', 'Как проходит обучение?')}<Icon name="arrow-up" /></a></div><div className="hero-details"><span><Icon name="people" />{t('5 адамға дейінгі топ', 'До 5 человек в группе')}</span><span><Icon name="calendar" />{t('6 апталық бағдарлама', 'Программа на 6 недель')}</span></div></div>
      <div className="study-illustration" aria-label={t('Үш бастапқы оқу бағыты', 'Три направления обучения')}><div className="illustration-dots" /><span className="orbit orbit-one" /><span className="orbit orbit-two" /><div className="study-sheet math-sheet"><span className="sheet-kicker">01 / CALCULUS I</span><span className="math-formula">∫ <i>f(x)</i> dx</span><div className="graph"><svg viewBox="0 0 290 100" aria-hidden="true"><path d="M12 83H275M44 96V5" stroke="#ccd8e6" fill="none"/><path d="M12 75C72 83 76 16 132 20S196 108 275 23" stroke="#203f85" strokeWidth="3" fill="none"/><path d="M132 20V83" stroke="#d4dbed" strokeDasharray="3 4"/><circle cx="132" cy="20" r="5" fill="#ffc928"/></svg></div><span className="sheet-note">{t('Түсін. Қолдан. Қайтала.', 'Пойми. Примени. Повтори.')}</span></div><div className="study-sheet algebra-sheet"><span className="sheet-kicker">02 / LINEAR ALGEBRA</span><div className="matrix-equation"><span className="matrix-bracket">[</span><span className="matrix-values">1&nbsp; 2<br />3&nbsp; 4</span><span className="matrix-bracket">]</span><span className="matrix-arrow">→</span><span className="matrix-result">a new<br />perspective</span></div></div><div className="study-sheet code-sheet"><span className="sheet-kicker">03 / PP1 · C++</span><code><span>#include</span> &lt;iostream&gt;<br /><br /><em>int</em> main() {'{'}<br />&nbsp; cout &lt;&lt; <b>"Hello, UYYM!"</b>;<br />&nbsp; <em>return</em> <i>0</i>;<br />{'}'}</code></div><div className="study-stamp"><span>6</span><small>{t('АПТА', 'НЕДЕЛЬ')}</small></div><div className="illustration-caption"><span className="yellow-spark">✦</span><span>{t('Күрделіні түсінікті етеміз', 'Делаем сложное понятным')}</span></div></div></div></section>
      <section className="exam-band"><div className="container"><span>{t('БІР МАҚСАТ. ЖҮЙЕЛІ ДАЙЫНДЫҚ.', 'ОДНА ЦЕЛЬ. СИСТЕМНАЯ ПОДГОТОВКА.')}</span><div>Quiz <i>✦</i> Midterm <i>✦</i> Endterm <i>✦</i> Final</div></div></section>
      <section id="courses" className="section courses-section"><div className="container"><div className="section-heading"><div><div className="eyebrow">{t('ӨЗ БАҒЫТЫҢДЫ ТАҢДА', 'ВЫБЕРИ СВОЁ НАПРАВЛЕНИЕ')}</div><h2>{t('Бүгін түсінгенің —', 'То, что поймёшь сегодня —')}<br /><span className="muted-heading">{t('ертеңгі сенімділігің.', 'завтрашняя уверенность.')}</span></h2></div><p>{t('Негізден бастап, емтихан есептеріне дейін. Әр пәнге бөлек курс және жеке қолжетімділік.', 'От основ до экзаменационных задач. У каждого предмета отдельный курс и персональный доступ.')}</p></div><div className="course-grid">{data.courses.map((course, index) => <article className={`course-card course-${index % 3}`} key={course.id}><div className="course-top"><span className="course-number">0{index + 1}</span><span className="course-category">{index === 2 ? 'PROGRAMMING' : 'MATHEMATICS'}</span><span className="course-symbol">{index === 0 ? '∫' : index === 1 ? '[A]' : '{ }'}</span></div><h3>{course.title}</h3><p>{lang === 'ru' && course.id === initialCourses[index]?.id ? ruSummaries[index] : course.summary}</p><div className="course-meta"><span><Icon name="clock" />{course.weeks} {t('апта', 'недель')} · {course.lessons} {t('сабақ', 'занятий')}</span><span><Icon name="people" />{course.group_capacity} {t('адамға дейін', 'человек максимум')}</span></div><div className="course-bottom"><div><strong>{formatMoney(course.price_kzt)}</strong><small>{t('бір курс үшін', 'за один курс')}</small></div><button className="course-link" onClick={() => openEnrollment(course)} aria-label={`${course.title}: ${t('курсқа жазылу', 'записаться на курс')}`}><Icon name="arrow-up" /></button></div></article>)}</div><p className="section-footnote">{t('Топ көлемі — оқу форматының бөлігі. Платформадағы аккаунт санына жасанды шектеу қойылмайды.', 'Размер группы — часть учебного формата. Количество аккаунтов на платформе не ограничено искусственно.')}</p></div></section>
      <section id="format" className="section format-section"><div className="container format-grid"><div className="format-title"><div className="eyebrow">{t('ЫҢҒАЙЛЫ ФОРМАТ', 'УДОБНЫЙ ФОРМАТ')}</div><h2>{t('Тек тыңдама.', 'Не просто слушай.')}<br />{t('Түсініп оқы.', 'Учись понимать.')}</h2><p>{t('Тұрақты сабақ кестесі, қайталауға арналған жазбалар және өзің орындайтын практика.', 'Регулярные занятия, записи для повторения и практика, которую выполняешь самостоятельно.')}</p><div className="format-facts"><div><strong>2 × 90</strong><span>{t('минут / апта', 'минут / неделю')}</span></div><div><strong>12 / 18</strong><span>{t('сабақ / сағат', 'занятий / часов')}</span></div></div></div><div className="format-steps">{[
        [t('Шағын топта бірге талдаймыз', 'Разбираем вместе в небольшой группе'), t('Бір топта 5 студентке дейін. Сұрақ қоюға және шешімді талқылауға уақыт бар.', 'До 5 студентов в группе. Есть время для вопросов и обсуждения решений.')],
        [t('Жазбаға қайта ораламыз', 'Возвращаемся к записи'), t('Сабақтан кейін жазбаны жеке кабинеттен көріп, күрделі тақырыпты қайталайсың.', 'После занятия повторяешь сложные темы по записи в личном кабинете.')],
        [t('Практикамен бекітеміз', 'Закрепляем практикой'), t('Конспект, үй тапсырмасы және Quiz, Midterm, Endterm, Final тапсырмалары.', 'Конспекты, домашние задания и задачи Quiz, Midterm, Endterm, Final.')],
      ].map(([title, description], index) => <div className="format-step" key={title}><span className="step-number">0{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div></div>)}</div></div></section>
      <section className="section access-section"><div className="container access-panel"><div className="access-icon"><Icon name="lock" /></div><div><div className="eyebrow">{t('СЕНІҢ ЖЕКЕ ОҚУ КЕҢІСТІГІҢ', 'ТВОЁ ЛИЧНОЕ УЧЕБНОЕ ПРОСТРАНСТВО')}</div><h2>{t('Бір аккаунт. Бір браузер.', 'Один аккаунт. Один браузер.')}</h2><p>{t('Материалдарды тек әкімші мақұлдаған браузер профилі арқылы ашасың. Браузерді ауыстыру керек болса, әкімшіге хабарлас. Сайт физикалық құрылғыны абсолютті дәлдікпен анықтамайды.', 'Материалы доступны только в одобренном администратором профиле браузера. Для замены браузера обратись к администратору. Сайт не определяет физическое устройство с абсолютной точностью.')}</p></div><button className="button button-white" onClick={goAccount}>{t('Жеке кабинетке кіру', 'Войти в кабинет')}<Icon name="arrow" /></button></div></section>
      <section id="teachers" className="section teachers-section"><div className="container teacher-grid"><div><div className="eyebrow">{t('БІРГЕ ҮЙРЕНЕМІЗ', 'УЧИМСЯ ВМЕСТЕ')}</div><h2>{t('Оқытушылар', 'Преподаватели')}</h2><p>{t('Тақырыпты түсіндіретін, жұмысыңа пікір қалдыратын және оқу тобыңмен бірге жүретін оқытушы.', 'Преподаватель объясняет тему, даёт обратную связь по работе и помогает учебной группе.')}</p></div><div className="public-teacher-list">{data.settings.teachers_public?.length ? data.settings.teachers_public.map((teacher, index) => <article className="teacher-empty" key={`${teacher.name}-${index}`}><Icon name="people" /><div><h3>{teacher.name}</h3><small>{teacher.subject}</small><p>{teacher.bio}</p></div></article>) : <div className="teacher-empty"><Icon name="people" /><div><h3>{t('Командамен жақында таныстырамыз', 'Скоро познакомим с командой')}</h3><p>{t('Оқытушылар туралы расталған ақпаратты академия иесі қосады.', 'Владелец академии добавит подтверждённую информацию о преподавателях.')}</p></div></div>}</div></div></section>
      <section id="faq" className="section faq-section"><div className="container faq-grid"><div><div className="eyebrow">{t('СҰРАҚТАР БАР МА?', 'ЕСТЬ ВОПРОСЫ?')}</div><h2>{t('Алдымен', 'Сначала')}<br />{t('түсініп алайық.', 'разберёмся.')}</h2><p>{t('Оқу және жеке кабинет туралы жиі қойылатын сұрақтар.', 'Частые вопросы об обучении и личном кабинете.')}</p></div><div className="faq-list">{(data.settings.faq?.length ? data.settings.faq.map(item => [item.question, item.answer]) : [
        [t('Курс кімдерге арналған?', 'Для кого эти курсы?'), t('Calculus I, Linear Algebra және PP1 пәндерінен білімін жүйелеп, КБТУ емтихандарына дайындалғысы келетін студенттерге.', 'Для студентов, которые хотят систематизировать знания по Calculus I, Linear Algebra и PP1 и подготовиться к экзаменам КБТУ.')],
        [t('Курс қанша уақытқа созылады?', 'Сколько длится курс?'), t('Бастапқы формат: 6 апта, аптасына 90 минуттан 2 сабақ. Барлығы 12 сабақ және 18 сағат. Бір курстың құны — 60 000 ₸. Топқа 5 студентке дейін қосылады.', 'Начальный формат: 6 недель, 2 занятия по 90 минут в неделю. Всего 12 занятий и 18 часов. Один курс стоит 60 000 ₸. В группе до 5 студентов.')],
        [t('Кабинетке қалай кіремін?', 'Как войти в кабинет?'), t('Курсқа ашық өтінім жібересің. Иесі өтінімді және телефон нөмірін жеке тексергеннен кейін аккаунт жасап, уақытша пароль береді. Алғаш кіргенде пароліңді ауыстырып, браузеріңді мақұлдауға жібересің.', 'Отправь публичную заявку на курс. После личной проверки заявки и номера владелец создаст аккаунт и передаст временный пароль. При первом входе ты сменишь пароль и отправишь браузер на одобрение.')],
        [t('Телефоннан және ноутбуктан қатар кіре аламын ба?', 'Можно ли входить и с телефона, и с ноутбука?'), t('Бір аккаунтқа бір браузер профилі мақұлданады. Сол браузердің бірнеше қойындысы рұқсат етіледі. Басқа құрылғы, профиль немесе инкогнито үшін әкімші браузерді ауыстыруы керек. Шығу және парольді ауыстыру привязканы жоймайды.', 'Для аккаунта одобряется один профиль браузера. Несколько вкладок этого браузера разрешены. Другому устройству, профилю или инкогнито нужна одобренная администратором замена. Выход и смена пароля не освобождают привязку.')],
        [t('UYYM Academy КБТУ-дың ресми жобасы ма?', 'UYYM Academy — официальный проект КБТУ?'), t('UYYM Academy — тәуелсіз оқу жобасы. КБТУ-мен ресми серіктестік туралы мәлімдеме жасалмайды.', 'UYYM Academy — независимый учебный проект. Официальное партнёрство с КБТУ не заявлено.')],
      ]).map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></div></section>
      <section id="contact" className="contact-section"><div className="container contact-grid"><div><div className="eyebrow">{t('КЕЛЕСІ ҚАДАМ', 'СЛЕДУЮЩИЙ ШАГ')}</div><h2>{t('Біліміңді бір', 'Собери знания')}<br />{t('жүйеге жина.', 'в одну систему.')}</h2><p>{t('Өзіңе керек пәнді таңда. Топ пен оқу кестесі туралы академиямен байланыс.', 'Выбери нужный предмет. Уточни у академии группу и расписание.')}</p></div><div className="contact-actions">{whatsapp ? <a className="button button-yellow button-large" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"><Icon name="message" />{t('WhatsApp-қа жазу', 'Написать в WhatsApp')}<Icon name="arrow-up" /></a> : <><button className="button button-yellow button-large" disabled><Icon name="message" />{t('WhatsApp-қа жазу', 'Написать в WhatsApp')}</button><p className="contact-empty">{t('Байланыс нөмірі әлі қосылмаған. Оны академия иесі баптауларда жариялайды.', 'Контактный номер ещё не добавлен. Владелец академии опубликует его в настройках.')}</p></>}{(data.settings.email || data.settings.contact_email) && <a className="contact-email" href={`mailto:${(data.settings.email || data.settings.contact_email)}`}>{(data.settings.email || data.settings.contact_email)}</a>}<button className="text-link text-link-light" onClick={goAccount}>{t('Аккаунтым бар → кіру', 'У меня есть аккаунт → войти')}</button></div></div></section>
      <div className="poc-notice container"><Icon name="laptop" /><p>{t('Жеке платформа техникалық POC кезеңінде. Supabase пен жеке Google Drive қосылып, нақты бейне және браузер қауіпсіздігі тексерілгеннен кейін оқу кабинеті іске қосылады.', 'Закрытая платформа на этапе технического POC. Учебный кабинет запускается после подключения Supabase, приватного Google Drive и проверки реального видео и защиты браузера.')}{publicOffline && <span> {t('Сервер қазір қосылмаған; бастапқы курс параметрлері көрсетілген.', 'Сервер сейчас не подключён; показаны исходные параметры курсов.')}</span>}</p></div>
    </main> : <main className="account-main"><div className="container"><div className="account-breadcrumb"><button onClick={goHome}>UYYM Academy</button><span>/</span>{t('Жеке кабинет', 'Личный кабинет')}<span className="poc-badge">MANAGEMENT · POC</span></div>{checking ? <div className="state-card"><span className="spinner" /><p>{t('Сессия тексерілуде…', 'Проверяем сессию…')}</p></div> : <AccountArea lang={lang} status={status} applyStatus={applyStatus} refreshStatus={refreshStatus} expired={expired} />}</div></main>}
    <footer><div className="container footer-top"><Brand small /><p>{t('Түсінікті білім. Жүйелі дайындық.', 'Понятные знания. Системная подготовка.')}</p><button className="text-link" onClick={goAccount}>{t('Жеке кабинетке кіру', 'Войти в личный кабинет')}<Icon name="arrow-up" /></button></div><div className="container footer-bottom"><span>© {new Date().getFullYear()} UYYM Academy</span><span>{t('Тәуелсіз оқу жобасы · Asia/Almaty', 'Независимый учебный проект · Asia/Almaty')}</span></div></footer>
    {enrollment && <div className="modal-backdrop" onClick={() => { if (!applicationBusy) setEnrollment(null); }}><div className="modal enrollment-modal" role="dialog" aria-modal="true" aria-labelledby="enrollment-title" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setEnrollment(null)} aria-label={t('Жабу', 'Закрыть')} disabled={applicationBusy} autoFocus><Icon name="close" /></button><span className="eyebrow">{t('КУРСҚА ЖАЗЫЛУ', 'ЗАПИСЬ НА КУРС')}</span><h2 id="enrollment-title">{enrollment.title}</h2><p>{enrollment.weeks} {t('апта', 'недель')} · {enrollment.lessons} {t('сабақ', 'занятий')} · {formatMoney(enrollment.price_kzt)}</p><div className="modal-info"><Icon name="people" /><p>{t('Иесі өтінімді және телефон нөмірін жеке тексергеннен кейін аккаунт пен оқу қолжетімділігін ашады. Төлем бөлек белгіленеді.', 'После личной проверки заявки и номера владелец создаст аккаунт и откроет учебный доступ. Оплата отмечается отдельно.')}</p></div>{applicationSent ? <div className="application-success" role="status"><Icon name="check"/><div><strong>{t('Өтінім жіберілді', 'Заявка отправлена')}</strong><p>{t('Иесі тексергеннен кейін сізбен бар жеке байланыс арқылы хабарласады.', 'После проверки владелец свяжется с вами по существующему личному контакту.')}</p></div></div> : <form className="application-form" onSubmit={event => void submitApplication(event)}><label>{t('Аты-жөніңіз', 'Имя и фамилия')}<input value={applicantName} onChange={event => setApplicantName(event.target.value)} maxLength={120} autoComplete="name" required /></label><label>{t('Телефон нөмірі', 'Номер телефона')}<input type="tel" value={applicantPhone} onChange={event => setApplicantPhone(event.target.value)} placeholder="+7 7XX XXX XX XX" maxLength={30} autoComplete="tel" required /></label>{applicationError && <div className="alert alert-error" role="alert">{applicationError}</div>}<button className="button button-yellow full-width" disabled={applicationBusy}>{applicationBusy ? t('Жіберілуде…', 'Отправляем…') : t('Өтінім жіберу', 'Отправить заявку')}</button><p className="form-help">{t('Өтінім аккаунтты автоматты ашпайды. Иесі жеке тексеруден кейін шешім қабылдайды.', 'Заявка не открывает аккаунт автоматически. Решение принимает владелец после личной проверки.')}</p></form>}{whatsapp && <a className="button button-outline full-width" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`${enrollment.title} — курсқа жазылғым келеді`)}`} target="_blank" rel="noopener noreferrer">{t('WhatsApp-қа жазу', 'Написать в WhatsApp')}<Icon name="arrow-up" /></a>}<button className="button button-outline full-width" onClick={goAccount}>{t('Жеке кабинетке кіру', 'Войти в личный кабинет')}</button></div></div>}
  </>;
}

function AccountArea({ lang, status, applyStatus, refreshStatus, expired }: { lang: Lang; status: AuthStatus; applyStatus: (value: AuthStatus) => void; refreshStatus: () => Promise<AuthStatus>; expired: boolean }) {
  const t = (kk: string, ru: string) => lang === 'kk' ? kk : ru;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState('');
  const activationRun = useRef<Promise<void> | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setSuccess('');
    try { await action(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  };
  const activate = useCallback(() => {
    if (!activationRun.current) {
      activationRun.current = api<AuthStatus>('/api/auth/activate', { method: 'POST', body: {}, proof: 'login' })
        .then(applyStatus).finally(() => { activationRun.current = null; });
    }
    return activationRun.current;
  }, [applyStatus]);
  useEffect(() => {
    setError(''); setSuccess('');
    if (status.authenticated && !status.user?.must_change_password && !status.user?.totp_required && status.device_status === 'approved' && !status.session_active) {
      setBusy(true); void activate().catch(reason => setError(errorText(reason))).finally(() => setBusy(false));
    }
  }, [status.authenticated, status.device_status, status.session_active, status.user?.must_change_password, status.user?.totp_required, activate]);
  useEffect(() => {
    if (!status.session_active) return;
    const timer = setInterval(() => {
      void api('/api/auth/refresh', { method: 'POST', body: {}, proof: 'refresh' }).then(() => refreshStatus()).catch(reason => setError(errorText(reason)));
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [status.session_active, refreshStatus]);
  const login = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const key = await publicBrowserKey();
    const next = await api<AuthStatus>('/api/auth/login', { method: 'POST', body: { phone, password, public_key: key, label: browserLabel() } }); setPassword(''); applyStatus(next);
  }); };
  const logout = () => void run(async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); applyStatus({ authenticated: false }); setPassword(''); });
  const notice = <>{error && <div className="alert alert-error" role="alert">{error}</div>}{success && <div className="alert alert-success" role="status">{success}</div>}</>;

  if (!status.authenticated || !status.user) return <div className="auth-grid"><div className="auth-story"><div className="eyebrow">{t('ҚОШ КЕЛДІҢ', 'ДОБРО ПОЖАЛОВАТЬ')}</div><h1>{t('Оқуға орал.', 'Вернись к учёбе.')}<br /><span>{t('Өз қарқыныңмен.', 'В своём темпе.')}</span></h1><p>{t('Сабақ жазбалары, материалдар және тапсырмалар — жеке оқу кеңістігіңде.', 'Записи занятий, материалы и задания — в твоём учебном пространстве.')}</p><div className="auth-security"><Icon name="lock" /><span>{t('Бір аккаунт — әкімші мақұлдаған бір браузер профилі.', 'Один аккаунт — один одобренный администратором профиль браузера.')}</span></div><small>{t('Алғашқы парольді академия әкімшісі береді. Браузер деректерін тазартсаң, қайта мақұлдау қажет.', 'Первый пароль выдаёт администратор академии. После очистки данных браузера потребуется повторное одобрение.')}</small></div><div className="auth-card"><h2>{t('Жеке кабинетке кіру', 'Войти в личный кабинет')}</h2><p>{t('Әкімші берген аккаунтты қолдан.', 'Используй аккаунт, выданный администратором.')}</p>{expired && <div className="alert alert-warning">{t('Сессия аяқталды. Мақұлданған браузеріңнен қайта кір.', 'Сессия завершилась. Войди снова из одобренного браузера.')}</div>}{notice}<form onSubmit={login}><label>{t('Телефон нөмірі', 'Номер телефона')}<input type="tel" autoComplete="tel" inputMode="tel" placeholder="+7 7XX XXX XX XX" value={phone} onChange={event => setPhone(event.target.value)} required /></label><label>{t('Пароль', 'Пароль')}<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} /></label><button className="button button-yellow full-width" disabled={busy}>{busy ? <span className="spinner" /> : <>{t('Кіру', 'Войти')}<Icon name="arrow" /></>}</button></form><p className="form-help">{t('Парольді ұмыттың ба? Жеке басыңды растап, әкімшіге хабарлас. Парольді қалпына келтіру браузерді ауыстырмайды.', 'Забыл пароль? Свяжись с администратором для проверки личности. Сброс пароля не меняет привязанный браузер.')}</p></div></div>;

  const user = status.user;
  const header = <div className="dashboard-heading"><div><div className="eyebrow">{user.role === 'ADMIN' ? t('ӘКІМШІ КАБИНЕТІ', 'КАБИНЕТ АДМИНИСТРАТОРА') : user.role === 'TEACHER' ? t('ОҚЫТУШЫ КАБИНЕТІ', 'КАБИНЕТ ПРЕПОДАВАТЕЛЯ') : t('ЖЕКЕ ОҚУ КАБИНЕТІ', 'ЛИЧНЫЙ УЧЕБНЫЙ КАБИНЕТ')}</div><h1>{t('Сәлем,', 'Привет,')} {user.name || t('оқушы', 'ученик')}<span className="greeting-dot">.</span></h1></div><button className="button button-outline" onClick={logout} disabled={busy}><Icon name="logout" />{t('Шығу', 'Выйти')}</button></div>;
  if (user.must_change_password) return <>{header}<div className="gate-card"><div className="gate-icon"><Icon name="lock" /></div><h2>{t('Өзіңнің пароліңді орнат', 'Установи свой пароль')}</h2><p>{t('Уақытша парольді ауыстырғаннан кейін браузеріңді мақұлдауға жіберуге болады. Бұл браузер привязкасын босатпайды.', 'После смены временного пароля можно продолжить одобрение браузера. Смена пароля не освобождает привязку.')}</p>{notice}<form onSubmit={event => { event.preventDefault(); void run(async () => {
    if (password !== confirm) throw new Error(t('Парольдер сәйкес емес.', 'Пароли не совпадают.'));
    await api('/api/auth/change-password', { method: 'POST', body: { password } }); setPassword(''); setConfirm(''); await refreshStatus();
  }); }}><label>{t('Жаңа пароль', 'Новый пароль')}<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} /></label><label>{t('Қайтала', 'Повтори пароль')}<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={event => setConfirm(event.target.value)} /></label><p className="form-help">{t('Кемінде 12 таңба. Басқа сайтта қолданбайтын бірегей пароль таңда.', 'Не менее 12 символов. Выбери уникальный пароль, который не используешь на других сайтах.')}</p><button className="button button-yellow full-width" disabled={busy}>{busy ? t('Сақталуда…', 'Сохраняем…') : t('Парольді сақтау', 'Сохранить пароль')}</button></form></div></>;
  if (user.totp_required) return <>{header}<div className="gate-card"><div className="gate-icon"><Icon name="lock" /></div><h2>{t('Әкімші кіруін раста', 'Подтверди вход администратора')}</h2><p>{t('Аутентификатордағы бір реттік 6 санды кодты енгіз. Браузерді растау және әкімші әрекеттері TOTP арқылы қорғалады.', 'Введи одноразовый шестизначный код из аутентификатора. Подтверждение браузера и действия администратора защищены TOTP.')}</p>{notice}<form onSubmit={event => { event.preventDefault(); void run(async () => { const next = await api<AuthStatus>('/api/auth/totp', { method: 'POST', body: { code: totp } }); setTotp(''); applyStatus(next); }); }}><label>{t('Аутентификатор коды', 'Код аутентификатора')}<input value={totp} onChange={event => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} /></label><button className="button button-yellow full-width" disabled={busy}>{t('Растау', 'Подтвердить')}</button></form><p className="form-help">{t('Код қолжетімсіз болса, қауіпсіз қалпына келтіру нұсқаулығын қолдан. TOTP-сыз әкімші режимі ашылмайды.', 'Если код недоступен, используй инструкцию безопасного восстановления. Режим администратора без TOTP не открывается.')}</p></div></>;
  if (status.device_status !== 'approved' || !status.session_active) return <>{header}<div className="gate-card device-gate"><div className="gate-icon"><Icon name="laptop" /></div><span className="status-pill">{status.device_status === 'pending' ? t('Өтінім қаралуда', 'Заявка рассматривается') : t('Оқу қолжетімділігі жабық', 'Учебный доступ закрыт')}</span><h2>{status.device_status === 'pending' ? t('Браузер мақұлдауын күт', 'Дождись одобрения браузера') : t('Браузерді тексерейік', 'Подтвердим браузер')}</h2><p>{status.device_status === 'different' || status.device_status === 'revoked' || status.devices?.some(device => device.status === 'approved') ? 'Бұл аккаунт басқа құрылғыға тіркелген. Құрылғыны ауыстыру үшін әкімшіге хабарласыңыз' : t('Әкімші жеке басыңды тексеріп, нақты осы браузердің өтінімін растайды. Сол уақытқа дейін сабақтар, материалдар және файлдар жабық.', 'Администратор проверит личность и одобрит заявку именно этого браузера. До этого уроки, материалы и файлы закрыты.')}</p><div className="device-label"><Icon name="laptop" /><strong>{browserLabel()}</strong></div>{notice}<div className="gate-actions"><button className="button button-yellow" disabled={busy} onClick={() => void run(async () => {
    const next = await refreshStatus(); if (next.device_status === 'approved' && !next.session_active) await activate(); else setSuccess(next.authenticated ? t('Өтінім күйі жаңартылды.', 'Статус заявки обновлён.') : t('Әкімші растағаннан кейін осы браузерден қайта кіріңіз.', 'После одобрения администратором войдите заново из этого браузера.'));
  })}>{busy ? t('Тексерілуде…', 'Проверяем…') : t('Күйін тексеру', 'Проверить статус')}</button>{status.device_status === 'approved' && <button className="button button-outline" onClick={() => void run(activate)} disabled={busy}>{t('Кілтпен растау', 'Подтвердить ключом')}</button>}</div><p className="inline-notice">{t('Әкімші растағаннан кейін осы браузерден қайта кіріңіз. Кіру кезінде браузер өтінімі автоматты жіберіледі, бірақ автоматты мақұлданбайды.', 'После одобрения администратором войдите заново из этого браузера. Заявка отправляется при входе, но никогда не одобряется автоматически.')}</p><p className="privacy-note">{t('Бұл браузер профиліне криптографиялық кілт тіркеледі. Ол физикалық компьютерді абсолютті дәлдікпен анықтамайды. Шығу, пароль ауыстыру немесе IP өзгеруі привязканы босатпайды.', 'В профиле браузера хранится криптографический ключ. Он не определяет физический компьютер с абсолютной точностью. Выход, смена пароля и изменение IP не освобождают привязку.')}</p></div></>;
  return <>{header}{notice}<div className="dashboard-security"><span className="small-dot" /><strong>{t('Браузер мақұлданған', 'Браузер одобрен')}</strong><span>{browserLabel()}</span><span className="security-spacer" /><Icon name="lock" />{t('Әр сұрау кілтпен расталады', 'Каждый запрос подтверждается ключом')}</div>{user.role === 'ADMIN' ? <AdminPanel key={user.id + status.session_id} lang={lang} /> : user.role === 'TEACHER' ? <TeacherPanel key={user.id + status.session_id} lang={lang}/> : <LearningHub key={user.id + status.session_id} lang={lang} role="STUDENT"/>}<div className="poc-account-note"><Icon name="book" /><p>{t('Жабық бейнесабақтар, материалдар, хабарландырулар, оқу барысы, үй тапсырмасы және оқытушының бағалауы қолжетімді.', 'Доступны закрытые видеоуроки, материалы, объявления, прогресс, домашние работы и проверка преподавателем.')}</p></div></>;
}

function AdminDevices({ lang }: { lang: Lang }) {
  const [requests, setRequests] = useState<BrowserRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const t = (kk: string, ru: string) => lang === 'kk' ? kk : ru;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await api<{ requests: BrowserRequest[] }>('/api/admin/device-requests', { proof: 'api' }); setRequests(result.requests); }
    catch (reason) { setError(errorText(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t('ҚОЛЖЕТІМДІЛІКТІ БАСҚАРУ', 'УПРАВЛЕНИЕ ДОСТУПОМ')}</span><h2>{t('Браузер өтінімдері', 'Заявки на браузер')}</h2></div><button className="button button-outline" onClick={() => void load()} disabled={loading}>{t('Жаңарту', 'Обновить')}</button></div><p className="panel-description">{t('Оқушыны жеке тексеріп, осы браузерді мақұлда. Жаңа браузер ескі кілтті, сессияларды және ойнату рұқсаттарын бір транзакцияда қайтарып алады.', 'Проверь ученика лично и одобри конкретный браузер. Замена атомарно отзывает старый ключ, сессии и разрешения воспроизведения.')}</p>{error && <div className="alert alert-error" role="alert">{error}</div>}{success && <div className="alert alert-success" role="status">{success}</div>}{loading ? <div className="empty-state"><span className="spinner" /><p>{t('Өтінімдер жүктелуде…', 'Загружаем заявки…')}</p></div> : requests.length ? <div className="request-list">{requests.map(request => <article className="request-card" key={request.id}><div className="request-avatar"><Icon name="laptop" /></div><div className="request-info"><h3>{request.user_name ?? request.name ?? request.user_id}</h3><p>{request.user_phone ?? request.phone ?? ''} · {request.label}</p><small>{new Intl.DateTimeFormat(lang === 'kk' ? 'kk-KZ' : 'ru-RU', { timeZone: 'Asia/Almaty', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.created_at))}</small>{(request.key_fingerprint ?? request.fingerprint) && <code className="fingerprint">{request.key_fingerprint ?? request.fingerprint}</code>}</div><button className="button button-yellow" disabled={!!busy} onClick={() => {
          setBusy(request.id); setError(''); setSuccess('');
          void api(`/api/admin/devices/${request.id}/approve`, { method: 'POST', body: {}, proof: 'api' }).then(async () => { setSuccess(t('Браузер мақұлданды. Бұрынғы қолжетімділік қайтарылды.', 'Браузер одобрен. Предыдущий доступ отозван.')); await load(); }).catch(reason => setError(errorText(reason))).finally(() => setBusy(''));
        }}><Icon name="check" />{busy === request.id ? t('Сақталуда…', 'Сохраняем…') : t('Тексерілді: мақұлдау', 'Личность проверена: одобрить')}</button></article>)}</div> : <div className="empty-state"><Icon name="check" /><h3>{t('Жаңа өтінімдер жоқ', 'Новых заявок нет')}</h3><p>{t('Оқушы алғаш кіргенде браузердің өтінімі осы жерде пайда болады.', 'Когда ученик впервые войдёт, заявка браузера появится здесь.')}</p></div>}</section>;
}

function LessonsArea({ lang, role }: { lang: Lang; role: 'TEACHER' | 'STUDENT' }) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selected, setSelected] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const t = (kk: string, ru: string) => lang === 'kk' ? kk : ru;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await api<{ lessons: Lesson[] }>('/api/lessons', { proof: 'api' }); setLessons(result.lessons); }
    catch (reason) { setError(errorText(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (selected) return <section className="lesson-panel"><button className="back-link" onClick={() => setSelected(null)}>← {t('Сабақтарға оралу', 'К урокам')}</button><div className="eyebrow">{selected.course_title}</div><h2>{selected.title}</h2><p className="lesson-date">{selected.starts_at ? new Intl.DateTimeFormat(lang === 'kk' ? 'kk-KZ' : 'ru-RU', { timeZone: 'Asia/Almaty', dateStyle: 'long', timeStyle: 'short' }).format(new Date(selected.starts_at)) : ''}</p><ProtectedPlayer lesson={selected} lang={lang} /><p className="lesson-description">{selected.description}</p></section>;
  return <section className="dashboard-panel"><div className="panel-heading"><div><div className="eyebrow">{t('ЖЕКЕ ОҚУ КЕҢІСТІГІ', 'УЧЕБНОЕ ПРОСТРАНСТВО')}</div><h2>{role === 'TEACHER' ? t('Тағайындалған сабақтар', 'Назначенные уроки') : t('Менің сабақтарым', 'Мои уроки')}</h2></div><button className="button button-outline" onClick={() => void load()} disabled={loading}>{t('Жаңарту', 'Обновить')}</button></div>{error && <div className="alert alert-error" role="alert">{error}</div>}{loading ? <div className="empty-state"><span className="spinner" /><p>{t('Сабақтар жүктелуде…', 'Загружаем уроки…')}</p></div> : lessons.length ? <div className="lesson-list">{lessons.map(lesson => <button className="lesson-card" key={lesson.id} onClick={() => setSelected(lesson)}><div className="lesson-play"><Icon name="play" /></div><div><small>{lesson.course_title}</small><h3>{lesson.title}</h3><p>{lesson.description}</p></div><Icon name="arrow" /></button>)}</div> : <div className="empty-state"><Icon name="book" /><h3>{t('Қолжетімді сабақтар әлі жоқ', 'Доступных уроков пока нет')}</h3><p>{t('Әкімші курсты ашып, нақты жеке бейнежазбаны жариялағаннан кейін сабақ осы жерде пайда болады.', 'После открытия курса и публикации реальной приватной записи урок появится здесь.')}</p></div>}</section>;
}
