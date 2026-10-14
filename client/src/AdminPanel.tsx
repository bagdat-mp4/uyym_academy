import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { dateLabel, Dialog, Empty, EntitySelect, localDate, managementMutation, message, money, newOperation, Notice, Pager, Status, tr, usePage, utcDate, value, type Copy, type Lang, type Row } from './management';
import LearningHub from './LearningHub';
import OwnerAuthDiagnostic from './OwnerAuthDiagnostic';
type Tab = 'users' | 'applications' | 'courses' | 'groups' | 'teacher-assignments' | 'enrollments' | 'payments' | 'content' | 'devices' | 'settings' | 'audit';
const tabs: [
    Tab,
    Copy
][] = [['users', ['Пайдаланушылар', 'Пользователи']], ['applications', ['Курс өтінімдері', 'Заявки на курсы']], ['courses', ['Курстар', 'Курсы']], ['groups', ['Топтар', 'Группы']], ['teacher-assignments', ['Оқытушылар', 'Преподаватели']], ['enrollments', ['Қолжетімділік', 'Доступы']], ['content', ['Оқу контенті', 'Учебный контент']], ['devices', ['Браузерлер', 'Браузеры']], ['settings', ['Баптаулар', 'Настройки']], ['audit', ['Әрекеттер журналы', 'Журнал действий']]];
const titles = Object.fromEntries(tabs) as Record<Tab, Copy>;
const editable = ['users', 'courses', 'groups', 'teacher-assignments', 'enrollments'];
type Field = {
    key: string;
    label: Copy;
    type?: 'number' | 'checkbox' | 'textarea' | 'datetime-local' | 'tel' | 'select';
    default?: string | number | boolean;
    min?: number;
    required?: boolean;
    options?: [
        string,
        Copy
    ][];
};
const fields: Record<string, Field[]> = {
    users: [{ key: 'name', label: ['Нақты аты', 'Настоящее имя'], required: true }, { key: 'phone', label: ['Телефон (E.164)', 'Телефон (E.164)'], type: 'tel', required: true }, { key: 'role', label: ['Рөл', 'Роль'], type: 'select', default: 'STUDENT', options: [['STUDENT', ['Оқушы', 'Ученик']], ['TEACHER', ['Оқытушы', 'Преподаватель']]] }, { key: 'active', label: ['Аккаунт белсенді', 'Аккаунт активен'], type: 'checkbox', default: true }],
    courses: [{ key: 'title', label: ['Курс атауы', 'Название курса'], required: true }, { key: 'slug', label: ['Қысқа атауы (латын әріптері)', 'Короткий адрес (латиница)'], required: true }, { key: 'description', label: ['Сипаттама', 'Описание'], type: 'textarea' }, { key: 'weeks', label: ['Апта саны', 'Количество недель'], type: 'number', min: 1, default: 6 }, { key: 'lessons_per_week', label: ['Аптасына сабақ саны', 'Занятий в неделю'], type: 'number', min: 1, default: 2 }, { key: 'lesson_minutes', label: ['Сабақ ұзақтығы, минут', 'Длительность занятия, минут'], type: 'number', min: 1, default: 90 }, { key: 'price_kzt', label: ['Бір курс бағасы, ₸', 'Стоимость курса, ₸'], type: 'number', min: 0, default: 60000 }, { key: 'default_group_size', label: ['Топтың ұсынылған көлемі', 'Рекомендуемый размер группы'], type: 'number', min: 1, default: 5 }, { key: 'published', label: ['Сайтта жариялау', 'Показывать на сайте'], type: 'checkbox', default: false }, { key: 'active', label: ['Курс белсенді', 'Курс активен'], type: 'checkbox', default: true }],
    groups: [{ key: 'title', label: ['Топ атауы', 'Название группы'], required: true }, { key: 'capacity', label: ['Топ көлемі', 'Размер группы'], type: 'number', min: 1, default: 5 }, { key: 'starts_at', label: ['Басталуы · Алматы UTC+5', 'Начало · Алматы UTC+5'], type: 'datetime-local' }, { key: 'ends_at', label: ['Аяқталуы · Алматы UTC+5', 'Окончание · Алматы UTC+5'], type: 'datetime-local' }, { key: 'schedule_description', label: ['Сабақ кестесі', 'Расписание занятий'], type: 'textarea' }, { key: 'active', label: ['Топ белсенді', 'Группа активна'], type: 'checkbox', default: true }],
    'teacher-assignments': [{ key: 'can_manage_access', label: ['Осы топтың бар оқушыларының қолжетімділігін басқаруға рұқсат беру', 'Разрешить управлять доступом существующих учеников этой группы'], type: 'checkbox', default: false }],
    enrollments: [{ key: 'status', label: ['Қолжетімділік күйі', 'Статус доступа'], type: 'select', default: 'pending', options: [['pending', ['Күтуде', 'Ожидает']], ['active', ['Белсенді', 'Активен']], ['paused', ['Тоқтату', 'Приостановить']], ['revoked', ['Қайтару', 'Отозвать']]] }, { key: 'starts_at', label: ['Басталуы · Алматы UTC+5', 'Начало · Алматы UTC+5'], type: 'datetime-local', required: true }, { key: 'expires_at', label: ['Аяқталуы · Алматы UTC+5', 'Окончание · Алматы UTC+5'], type: 'datetime-local', required: true }],
    payments: [{ key: 'amount_kzt', label: ['Сома, ₸', 'Сумма, ₸'], type: 'number', min: 1, required: true }, { key: 'paid_at', label: ['Төлем уақыты · Алматы UTC+5', 'Дата оплаты · Алматы UTC+5'], type: 'datetime-local', required: true }, { key: 'method', label: ['Төлем тәсілі', 'Способ оплаты'], type: 'select', default: 'manual', options: [['manual', ['Қолмен белгіленген', 'Ручная отметка']], ['cash', ['Қолма-қол', 'Наличные']], ['bank_transfer', ['Банк аударымы', 'Банковский перевод']], ['card', ['Банк картасы', 'Банковская карта']], ['other', ['Басқа', 'Другой']]] }, { key: 'note', label: ['Ескерту', 'Примечание'], type: 'textarea' }],
};
export default function AdminPanel({ lang }: {
    lang: Lang;
}) {
    const [tab, setTab] = useState<Tab>('users');
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('');
    const [change, setChange] = useState(0);
    const [editing, setEditing] = useState<{
        row?: Row;
        reset?: boolean;
        remove?: boolean;
        revoke?: boolean;
    } | null>(null);
    const [detail, setDetail] = useState<Row | null>(null);
    const [application, setApplication] = useState<Row | null>(null);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');
    const [password, setPassword] = useState<{
        name: string;
        password: string;
    } | null>(null);
    const [copied, setCopied] = useState(false);
    const list = usePage(`/api/admin/${tab}`, { page: String(page), page_size: '20', q: query, ...(filter ? tab === 'users' ? { role: filter } : { status: filter } : {}) }, change, tab !== 'settings' && tab !== 'content');
    const refresh = () => setChange(current => current + 1);
    useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
    useEffect(() => {
    const changed = () => { setEditing(null); setDetail(null); setPassword(null); refresh(); };
        window.addEventListener('uyym-management-permissions-changed', changed);
        return () => window.removeEventListener('uyym-management-permissions-changed', changed);
    }, []);
  const choose = (next: Tab) => { setTab(next); setPage(1); setSearch(''); setQuery(''); setFilter(''); setSuccess(''); setError(''); setEditing(null); setDetail(null); setApplication(null); setPassword(null); };
    const saved = (result?: Record<string, unknown>) => {
        setEditing(null);
        refresh();
        if (typeof result?.temporary_password === 'string') {
            const created = result.user as Record<string, unknown> | undefined;
            setPassword({ name: String(created?.name ?? ''), password: result.temporary_password });
            setCopied(false);
        }
        setSuccess(result?.status === 'reconcile_required' ? tr(lang, ['Операцияны салыстырып тексеру қажет. Сол сұраудың күйін қайта тексеріңіз; жаңа аккаунт ашпаңыз.', 'Операция требует сверки. Проверьте состояние того же запроса; не создавайте аккаунт повторно.']) : tr(lang, ['Өзгеріс сақталды.', 'Изменение сохранено.']));
        window.dispatchEvent(new CustomEvent('uyym-data-changed'));
    };
    const approve = (row: Row) => {
        setError('');
        setSuccess('');
        void managementMutation(`/api/admin/devices/${row.id}/approve`, {}).then(() => { refresh(); setSuccess(tr(lang, ['Браузер мақұлданды. Оқушы осы браузерден қайта кіруі керек.', 'Браузер одобрен. Ученику нужно войти заново из этого браузера.'])); }).catch(reason => setError(message(reason)));
    };
    const filterOptions = tab === 'users' ? ['STUDENT', 'TEACHER', 'ADMIN'] : tab === 'applications' ? ['pending', 'processing', 'approved', 'rejected'] : tab === 'enrollments' ? ['pending', 'active', 'paused', 'expired', 'revoked'] : tab === 'devices' ? ['pending', 'approved', 'revoked', 'rejected'] : tab === 'payments' ? ['posted', 'voided'] : [];
    return <div className="management-shell"><OwnerAuthDiagnostic lang={lang}/><nav className="manage-tabs" aria-label={tr(lang, ['Әкімші бөлімдері', 'Разделы администратора'])}>{tabs.map(([id, title]) => <button type="button" key={id} className={tab === id ? 'selected' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => choose(id)}>{tr(lang, title)}</button>)}</nav><label className="manage-mobile-nav">{tr(lang, ['Бөлім', 'Раздел'])}<select value={tab} onChange={event => choose(event.target.value as Tab)}>{tabs.map(([id, title]) => <option key={id} value={id}>{tr(lang, title)}</option>)}</select></label>{tab === 'content' ? <LearningHub lang={lang} role="ADMIN"/> : <section className="dashboard-panel manage-panel"><div className="panel-heading"><div><div className="eyebrow">UYYM ACADEMY · ADMIN</div><h2>{tr(lang, titles[tab])}</h2></div><div className="manage-heading-actions"><button className="button button-outline" onClick={refresh}>{tr(lang, ['Жаңарту', 'Обновить'])}</button>{editable.includes(tab) && <button className="button button-yellow" onClick={() => setEditing({})}>+ {tr(lang, ['Қосу', 'Добавить'])}</button>}</div></div><Notice error={error} success={success}/>{tab === 'settings' ? <SettingsPanel lang={lang} change={change} onSaved={() => { saved(); refresh(); }}/> : <><div className="manage-toolbar"><label>{tr(lang, ['Іздеу', 'Поиск'])}<input type="search" value={search} placeholder={tr(lang, ['Аты, пәні немесе телефоны', 'Имя, предмет или телефон'])} onChange={event => setSearch(event.target.value)}/></label>{filterOptions.length > 0 && <label>{tr(lang, ['Сүзгі', 'Фильтр'])}<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="">{tr(lang, ['Барлығы', 'Все'])}</option>{filterOptions.map(option => <option value={option} key={option}>{statusText(option, lang)}</option>)}</select></label>}</div><Notice error={list.error}/>{list.loading ? <Empty lang={lang} loading/> : list.error ? <div className="manage-retry"><button className="button button-outline" onClick={refresh}>{tr(lang, ['Қайта көру', 'Повторить'])}</button></div> : list.data.items.length === 0 ? <Empty lang={lang}/> : <div className="manage-records">{list.data.items.map(row => <div className="manage-record" key={row.id}><RecordInfo tab={tab} row={row} lang={lang}/><div className="manage-record-actions">{editable.includes(tab) && !(tab === "users" && row.role === "ADMIN") && <button className="button button-outline" onClick={() => setEditing({ row })}>{tab === 'payments' ? tr(lang, ['Түзету', 'Корректировать']) : tr(lang, ['Өзгерту', 'Изменить'])}</button>}{tab === 'users' && <><button className="button button-outline" onClick={() => setDetail(row)}>{tr(lang, ['Толығырақ', 'Подробнее'])}</button>{row.role !== 'ADMIN' && <button className="manage-text-action" onClick={() => setEditing({ row, reset: true })}>{tr(lang, ['Парольді қалпына келтіру', 'Сбросить пароль'])}</button>}</>}{tab === 'applications' && ['pending','processing'].includes(value(row,'status')) && <button className="button button-yellow" onClick={() => setApplication(row)}>{tr(lang, ['Тексеру және мақұлдау', 'Проверить и одобрить'])}</button>}{tab === 'teacher-assignments' && <button className="manage-text-action danger" onClick={() => setEditing({ row, remove: true })}>{tr(lang, ['Тағайындауды жою', 'Убрать назначение'])}</button>}{tab === 'devices' && <>{row.status === 'pending' && <button className="button button-yellow" onClick={() => setEditing({ row })}>{tr(lang, ['Жеке басы тексерілді: мақұлдау', 'Личность проверена: одобрить'])}</button>}{row.status === 'approved' && <button className="manage-text-action danger" onClick={() => setEditing({ row, revoke: true })}>{tr(lang, ['Браузерді қайтару', 'Отозвать браузер'])}</button>}</>}</div></div>)}</div>}{!list.error && !list.loading && <Pager data={list.data} lang={lang} setPage={setPage} loading={list.loading}/>}{tab === "users" && <AuthOperations lang={lang} change={change} onSaved={saved}/>}</>}{editing && <EditDialog key={`${tab}-${editing.row?.id ?? 'new'}-${editing.reset ?? false}-${editing.remove ?? false}-${editing.revoke ?? false}`} tab={tab} row={editing.row} lang={lang} reset={editing.reset} remove={editing.remove} revoke={editing.revoke} onClose={() => setEditing(null)} onSaved={saved} onApprove={() => { if (editing.row)
        approve(editing.row); setEditing(null); }}/>}{detail && <UserDetails user={detail} lang={lang} onClose={() => setDetail(null)}/>}{application && <ApplicationApprovalDialog row={application} lang={lang} onClose={() => setApplication(null)} onSaved={result => { setApplication(null); saved(result); }}/>} {password && <Dialog title={tr(lang, ['Жеке уақытша пароль', 'Индивидуальный временный пароль'])} lang={lang} onClose={() => setPassword(null)}><p className="manage-dialog-description">{password.name} · {tr(lang, ['Пароль тек осы терезеде көрсетіледі. Тексерілген жеке байланыс арқылы беріңіз. Жабылғаннан кейін оны қайта көру мүмкін емес.', 'Пароль доступен только в этом окне. Передайте его по проверенному личному контакту. После закрытия повторный просмотр невозможен.'])}</p><output className="temporary-password">{password.password}</output><div className="manage-dialog-actions"><button className="button button-yellow" onClick={() => { void navigator.clipboard.writeText(password.password).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? tr(lang, ['Көшірілді', 'Скопировано']) : tr(lang, ['Көшіру', 'Копировать'])}</button><button className="button button-outline" onClick={() => setPassword(null)}>{tr(lang, ['Жабу', 'Закрыть'])}</button></div><p className="form-help">{tr(lang, ['Көшірілген пароль браузердің алмасу буферінде қалуы мүмкін. Алғаш кіргенде оқушы оны ауыстырады.', 'Скопированный пароль может остаться в буфере обмена. При первом входе пользователь обязан его сменить.'])}</p></Dialog>}</section>}</div>;
}
function statusText(status: string, lang: Lang) { const names: Record<string, Copy> = { STUDENT: ['Оқушы', 'Ученик'], TEACHER: ['Оқытушы', 'Преподаватель'], ADMIN: ['Әкімші', 'Администратор'], pending: ['Күтуде', 'Ожидает'], processing: ['Өңделуде', 'Обрабатывается'], active: ['Белсенді', 'Активен'], paused: ['Тоқтатылған', 'Приостановлен'], expired: ['Мерзімі аяқталған', 'Истёк'], revoked: ['Қайтарылған', 'Отозван'], approved: ['Мақұлданған', 'Одобрен'], rejected: ['Қабылданбаған', 'Отклонён'], posted: ['Есепке алынған', 'Учтён'], voided: ['Күші жойылған', 'Аннулирован'] }; return names[status] ? tr(lang, names[status]) : status; }
function ApplicationApprovalDialog({ row, lang, onClose, onSaved }: { row: Row; lang: Lang; onClose: () => void; onSaved: (result: Record<string, unknown>) => void }) {
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [operationId] = useState(() => value(row, 'operation_id') || newOperation());
    const [rejectOperationId] = useState(newOperation);
    const submit = (event: FormEvent) => {
        event.preventDefault(); setBusy(true); setError('');
        void managementMutation<Record<string, unknown>>(`/api/admin/applications/${row.id}/approve`, { operation_id: operationId, identity_verified: true })
            .then(onSaved).catch(reason => setError(message(reason))).finally(() => setBusy(false));
    };
    const reject = () => {
        setBusy(true); setError('');
        void managementMutation<Record<string, unknown>>(`/api/admin/applications/${row.id}/reject`, { operation_id: rejectOperationId, revision: Number(row.revision) })
            .then(onSaved).catch(reason => setError(message(reason))).finally(() => setBusy(false));
    };
    return <Dialog title={tr(lang, ['Курс өтінімін мақұлдау', 'Одобрить заявку на курс'])} lang={lang} onClose={onClose} busy={busy}>
        <form className="manage-form" onSubmit={submit}>
            <p className="manage-dialog-description"><strong>{value(row, 'name')}</strong><br/>{value(row, 'phone')} · {value(row, 'course_title')}</p>
            <p className="form-help">{tr(lang, ['Телефон иесін бар жеке байланыс арқылы тексеріңіз. Мақұлдаудан кейін оқушы аккаунты мен таңдалған курсқа 6 апталық қолжетімділік жасалады.', 'Проверьте владельца номера через существующий личный контакт. После одобрения создаются аккаунт ученика и доступ к выбранному курсу на срок программы.'])}</p>
            <label className="checkbox-field"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} required/>{tr(lang, ['Жеке басын және өтінімді тексердім', 'Я проверил личность и заявку'])}</label>
            <Notice error={error}/>
            <div className="manage-dialog-actions"><button className="button button-yellow" disabled={busy || !verified}>{busy ? tr(lang, ['Өңделуде…', 'Обрабатываем…']) : tr(lang, ['Аккаунт пен қолжетімділік жасау', 'Создать аккаунт и доступ'])}</button>{row.status === 'pending' && <button type="button" className="button button-outline" disabled={busy} onClick={reject}>{tr(lang, ['Өтінімді қабылдамау', 'Отклонить заявку'])}</button>}<button type="button" className="button button-outline" disabled={busy} onClick={onClose}>{tr(lang, ['Бас тарту', 'Отмена'])}</button></div>
        </form>
    </Dialog>;
}
function AuthOperations({ lang, change, onSaved }: {
    lang: Lang;
    change: number;
    onSaved: (result?: Record<string, unknown>) => void;
}) {
    const [page, setPage] = useState(1);
    const [ownChange, setOwnChange] = useState(0);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [retry, setRetry] = useState<{ row: Row; operationId: string } | null>(null);
    const list = usePage('/api/admin/auth-operations', { page: String(page), page_size: '10' }, change + ownChange);
    const states: Record<string, Copy> = {
        completed: ['Аяқталған', 'Завершена'],
        inflight: ['Орындалуда', 'Выполняется'],
        reconcile_required: ['Салыстыру қажет', 'Нужна сверка'],
        failed: ['Орындалмаған', 'Не выполнена'],
        prepared: ['Дайындалған', 'Подготовлена']
    };
    const refresh = () => setOwnChange(current => current + 1);
    const reconcile = (row: Row) => {
        setBusy(row.id);
        setError('');
        void managementMutation<Record<string, unknown>>(`/api/admin/auth-operations/${row.id}/reconcile`, {})
            .then(result => {
                refresh();
                if (result.status === 'completed')
                    onSaved(result);
                else
                    setError(tr(lang, ['Операция әлі аяқталған жоқ. Auth күйін тексеріп, кейін қайта салыстырыңыз.', 'Операция ещё не завершена. Проверьте состояние Auth и повторите сверку позже.']));
            })
            .catch(reason => setError(message(reason)))
            .finally(() => setBusy(''));
    };
    return <section className="auth-operations">
        <h3>{tr(lang, ['Аккаунт операцияларының күйі', 'Состояние операций с аккаунтами'])}</h3>
        <p className="form-help">{tr(lang, ['Байланыс үзілсе, алдымен сол операцияны салыстырыңыз. Қайта орындау тек жеке басты қайта тексергеннен және күту мерзімінен кейін ашылады.', 'При обрыве связи сначала сверяйте ту же операцию. Повтор доступен только после новой проверки личности и периода ожидания.'])}</p>
        <Notice error={error || list.error}/>
        {list.loading ? <Empty lang={lang} loading/> : !list.error && <div className="manage-records">{list.data.items.map(row => {
            const state = value(row, 'state');
            const updated = Date.parse(value(row, 'updated_at', value(row, 'created_at')));
            const retryReady = ['failed', 'reconcile_required'].includes(state) && value(row, 'last_error_code') !== 'OPERATION_SUPERSEDED' && Number.isFinite(updated) && Date.now() - updated >= 60_000;
            return <div className="manage-record" key={row.id}>
                <div className="manage-record-info">
                    <div className="manage-record-title"><h3>{value(row, 'name', value(row, 'user_name')) || tr(lang, ['Аккаунт операциясы', 'Операция с аккаунтом'])}</h3><span className="manage-status">{states[state] ? tr(lang, states[state]) : state}</span></div>
                    <dl>
                        <div><dt>{tr(lang, ['Телефон', 'Телефон'])}</dt><dd>{value(row, 'phone') || '—'}</dd></div>
                        <div><dt>{tr(lang, ['Операция', 'Операция'])}</dt><dd>{value(row, 'action') === 'reset_password' ? tr(lang, ['Парольді қалпына келтіру', 'Сброс пароля']) : tr(lang, ['Аккаунт жасау', 'Создание аккаунта'])}</dd></div>
                        <div><dt>{tr(lang, ['Жаңартылды', 'Обновлена'])}</dt><dd>{dateLabel(row.updated_at ?? row.created_at, lang)}</dd></div>
                    </dl>
                </div>
                {state !== 'completed' && <div className="manage-record-actions">
                    <button type="button" className="button button-outline" disabled={!!busy} onClick={() => reconcile(row)}>{busy === row.id ? tr(lang, ['Тексерілуде…', 'Проверяем…']) : tr(lang, ['Салыстырып тексеру', 'Сверить состояние'])}</button>
                    {retryReady && <button type="button" className="manage-text-action" disabled={!!busy} onClick={() => setRetry({ row, operationId: newOperation() })}>{tr(lang, ['Жеке басты тексеріп қайталау', 'Проверить личность и повторить'])}</button>}
                </div>}
            </div>;
        })}</div>}
        {!list.error && !list.loading && <Pager data={list.data} lang={lang} setPage={setPage} loading={list.loading}/>}
        {retry && <AuthRetryDialog lang={lang} row={retry.row} operationId={retry.operationId} onClose={() => setRetry(null)} onCompleted={result => { setRetry(null); refresh(); onSaved(result); }} onPending={text => { refresh(); setError(text); }}/>}
    </section>;
}

function AuthRetryDialog({ lang, row, operationId, onClose, onCompleted, onPending }: {
    lang: Lang;
    row: Row;
    operationId: string;
    onClose: () => void;
    onCompleted: (result: Record<string, unknown>) => void;
    onPending: (text: string) => void;
}) {
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const creation = value(row, 'action') === 'create_user';
    const submit = (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        const path = creation ? `/api/admin/auth-operations/${row.id}/resume-create` : `/api/admin/auth-operations/${row.id}/retry`;
        const body = creation ? { identity_verified: true } : { operation_id: operationId, identity_verified: true };
        void managementMutation<Record<string, unknown>>(path, body)
            .then(result => {
                if (result.status === 'completed')
                    onCompleted(result);
                else {
                    const text = tr(lang, ['Операция аяқталмады. Қолжетімділік жабық күйде қалады; Auth күйін қайта салыстырыңыз.', 'Операция не завершена. Доступ остаётся закрытым; повторно сверьте состояние Auth.']);
                    setError(text);
                    onPending(text);
                }
            })
            .catch(reason => setError(message(reason)))
            .finally(() => setBusy(false));
    };
    return <Dialog title={creation ? tr(lang, ['Аккаунт жасауды қауіпсіз қайталау', 'Безопасно продолжить создание аккаунта']) : tr(lang, ['Парольді қалпына келтіруді қайталау', 'Повторить сброс пароля'])} lang={lang} onClose={onClose} busy={busy}>
        <form className="manage-form" onSubmit={submit}>
            <p className="manage-dialog-description">{creation ? tr(lang, ['Сервер бұрын бөлген Auth ID мен телефонды қолданады. Жаңа аккаунт жасалмайды; егер бұрынғы сұрау аяқталса, ол тек салыстырылады.', 'Сервер использует уже выделенные Auth ID и телефон. Второй аккаунт не создаётся; если прежний запрос завершился, состояние только сверяется.']) : tr(lang, ['Жаңа операция бұрынғысын алмастырады, ал мақұлданған браузер кілті сақталады. Өте кеш Auth жауабы болса, иесі қайта тексеруі керек.', 'Новая операция заменит прежнюю, а одобренный ключ браузера сохранится. При крайне позднем ответе Auth владельцу потребуется повторная проверка.'])}</p>
            <label className="checkbox-field"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} required/>{tr(lang, ['Жеке басты қайта тексердім', 'Я повторно проверил личность'])}</label>
            <Notice error={error}/>
            <div className="manage-dialog-actions">
                <button className="button button-yellow" disabled={busy || !verified}>{busy ? tr(lang, ['Орындалуда…', 'Выполняем…']) : tr(lang, ['Қауіпсіз қайталау', 'Безопасно повторить'])}</button>
                <button type="button" className="button button-outline" disabled={busy} onClick={onClose}>{tr(lang, ['Бас тарту', 'Отмена'])}</button>
            </div>
        </form>
    </Dialog>;
}

function auditAction(action: string, lang: Lang) {
    const labels: Record<string, Copy> = {
        'user.created': ['Пайдаланушы жасалды', 'Пользователь создан'],
        'user.updated': ['Пайдаланушы өзгертілді', 'Пользователь изменён'],
        'course.created': ['Курс жасалды', 'Курс создан'],
        'course.updated': ['Курс өзгертілді', 'Курс изменён'],
        'group.created': ['Топ жасалды', 'Группа создана'],
        'group.updated': ['Топ өзгертілді', 'Группа изменена'],
        'teacher.assigned': ['Оқытушы тағайындалды', 'Преподаватель назначен'],
        'teacher.assignment.updated': ['Оқытушы құқығы өзгертілді', 'Права преподавателя изменены'],
        'teacher.assignment.removed': ['Оқытушы тағайындауы жойылды', 'Назначение преподавателя снято'],
        'enrollment.created': ['Қолжетімділік берілді', 'Доступ выдан'],
        'enrollment.updated': ['Қолжетімділік өзгертілді', 'Доступ изменён'],
        'payment.recorded': ['Төлем тіркелді', 'Оплата записана'],
        'payment.corrected': ['Төлем түзетілді', 'Оплата исправлена'],
        'password.reset.started': ['Парольді қалпына келтіру басталды', 'Сброс пароля начат'],
        'password.reset.completed': ['Пароль қалпына келтірілді', 'Пароль сброшен'],
        'device.approved': ['Браузер мақұлданды', 'Браузер одобрен'],
        'device.revoked': ['Браузер қайтарылды', 'Браузер отозван']
    };
    return labels[action] ? tr(lang, labels[action]) : action;
}

function auditDetails(metadata: unknown, lang: Lang) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        return '';
    const source = metadata as Record<string, unknown>;
    const allowed: Record<string, Copy> = {
        status: ['Күйі', 'Статус'],
        active: ['Белсенді', 'Активен'],
        starts_at: ['Басталуы', 'Начало'],
        expires_at: ['Аяқталуы', 'Окончание'],
        title: ['Атауы', 'Название'],
        name: ['Аты', 'Имя'],
        capacity: ['Орын саны', 'Вместимость'],
        amount_kzt: ['Сома', 'Сумма'],
        paid_at: ['Төлем күні', 'Дата оплаты'],
        method: ['Тәсілі', 'Способ'],
        state: ['Жазба күйі', 'Состояние записи'],
        can_manage_access: ['Қолжетімділікті басқару', 'Управление доступом'],
        published: ['Жарияланған', 'Опубликован']
    };
    const display = (key: string, input: unknown) => {
        if (key.endsWith('_at'))
            return dateLabel(input, lang);
        if (key === 'amount_kzt')
            return money(input);
        if (typeof input === 'boolean')
            return input ? tr(lang, ['Иә', 'Да']) : tr(lang, ['Жоқ', 'Нет']);
        if (key === 'status' || key === 'state')
            return statusText(String(input), lang);
        return String(input ?? '—');
    };
    const section = (name: 'before' | 'after') => {
        const values = source[name];
        if (!values || typeof values !== 'object' || Array.isArray(values))
            return '';
        const parts = Object.entries(values as Record<string, unknown>)
            .filter(([key]) => allowed[key])
            .map(([key, input]) => `${tr(lang, allowed[key])}: ${display(key, input)}`);
        if (!parts.length)
            return '';
        return `${tr(lang, name === 'before' ? ['Бұрын', 'Было'] : ['Кейін', 'Стало'])}: ${parts.join(', ')}`;
    };
    return [section('before'), section('after')].filter(Boolean).join(' · ');
}

function RecordInfo({ row, tab, lang }: {
    row: Row;
    tab: Tab;
    lang: Lang;
}) {
    const [showHistory, setShowHistory] = useState(false);
    const title = ['users','applications'].includes(tab) ? value(row, 'name') : tab === 'teacher-assignments' ? value(row, 'teacher_name', value(row, 'name')) : ['enrollments', 'payments', 'devices'].includes(tab) ? value(row, 'student_name', value(row, 'user_name', value(row, 'name'))) : tab === 'audit' ? auditAction(value(row, 'action'), lang) : value(row, 'title');
    const info: [
        string,
        string
    ][] = [];
    const add = (label: Copy, content: unknown) => { if (content !== undefined && content !== null && content !== '')
        info.push([tr(lang, label), String(content)]); };
    if (tab === 'users') {
        add(['Телефон', 'Телефон'], row.phone);
        add(['Құрылу уақыты', 'Создан'], dateLabel(row.created_at, lang));
    }
    if (tab === 'applications') {
        add(['Телефон', 'Телефон'], row.phone);
        add(['Курс', 'Курс'], row.course_title);
        add(['Өтінім уақыты', 'Дата заявки'], dateLabel(row.created_at, lang));
        add(['Мақұлданды', 'Одобрена'], dateLabel(row.approved_at, lang));
    }
    if (tab === 'courses') {
        add(['Бағасы', 'Стоимость'], money(row.price_kzt));
        add(['Оқу форматы', 'Формат'], `${row.weeks} ${tr(lang, ['апта', 'недель'])} · ${row.lessons_per_week} × ${row.lesson_minutes} ${tr(lang, ['минут', 'минут'])}`);
        add(['Топ көлемі', 'Размер группы'], row.default_group_size);
    }
    if (['groups', 'teacher-assignments', 'enrollments', 'payments'].includes(tab)) {
        add(['Курс', 'Курс'], row.course_title);
        add(['Топ', 'Группа'], row.group_title);
    }
    if (tab === 'groups') {
        add(['Топ көлемі', 'Размер группы'], row.capacity);
        add(['Кестесі', 'Расписание'], row.schedule_description);
        add(['Басталуы', 'Начало'], dateLabel(row.starts_at, lang));
    }
    if (tab === 'teacher-assignments')
        add(['Қолжетімділікті басқару', 'Управление доступом'], row.can_manage_access ? tr(lang, ['Рұқсат берілген', 'Разрешено']) : tr(lang, ['Рұқсат жоқ', 'Не разрешено']));
    if (tab === 'enrollments') {
        add(['Телефон', 'Телефон'], row.student_phone ?? row.phone);
        add(['Басталуы', 'Начало'], dateLabel(row.starts_at, lang));
        add(['Аяқталуы', 'Окончание'], dateLabel(row.expires_at, lang));
    }
    if (tab === 'payments') {
        add(['Сома', 'Сумма'], money(row.amount_kzt));
        add(['Төлем күні', 'Дата оплаты'], dateLabel(row.paid_at, lang));
        add(['Тәсілі', 'Способ'], row.method);
        add(['Енгізген', 'Автор записи'], row.recorded_by_name);
        add(['Ескерту', 'Примечание'], row.note);
        add(['Түзету себебі', 'Причина коррекции'], row.reason);
    }
    if (tab === 'devices') {
        add(['Телефон', 'Телефон'], row.user_phone ?? row.phone);
        add(['Браузер', 'Браузер'], row.label);
        add(['Өтінім', 'Заявка'], dateLabel(row.requested_at ?? row.created_at, lang));
        add(['Кілт белгісі', 'Отпечаток ключа'], row.key_fingerprint);
    }
    if (tab === 'audit') {
        add(['Кім', 'Кто'], row.actor_name);
        add(['Нысан', 'Объект'], row.object_label ?? row.subject_name ?? row.target_type);
        add(['Өзгеріс', 'Изменение'], auditDetails(row.metadata, lang));
        add(['Уақыты', 'Время'], dateLabel(row.created_at, lang));
    }
    return <div className="manage-record-info">
        {tab === 'groups' && <div className="group-media-placeholder" aria-label={tr(lang, ['Топтың мұқабасы жоқ', 'Обложка группы не добавлена'])}><span>{(title || 'U').slice(0, 1).toUpperCase()}</span><small>{tr(lang, ['Мұқаба жоқ', 'Без обложки'])}</small></div>}
        <div className="manage-record-title"><h3>{title || tr(lang, ['Атауы көрсетілмеген', 'Название не указано'])}</h3>{tab === 'users' && <Status status={row.role} lang={lang}/>} {['users', 'groups', 'courses'].includes(tab) && <Status status={row.active ? 'active' : 'paused'} lang={lang}/>} {['applications','enrollments', 'devices'].includes(tab) && <Status status={row.effective_status ?? row.status} lang={lang}/>} {tab === 'payments' && <Status status={row.state} lang={lang}/>}</div>
        <dl>{info.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl>
        {tab === 'payments' && <button type="button" className="manage-text-action" onClick={() => setShowHistory(true)}>{tr(lang, ['Түзетулер тарихы', 'История исправлений'])}</button>}
        {showHistory && <PaymentHistory payment={row} lang={lang} onClose={() => setShowHistory(false)}/>}
    </div>;
}

function PaymentHistory({ payment, lang, onClose }: { payment: Row; lang: Lang; onClose: () => void }) {
    const [page, setPage] = useState(1);
    const history = usePage(`/api/admin/payments/${payment.id}/history`, { page: String(page), page_size: '10' }, 0);
    return <Dialog title={tr(lang, ['Төлем түзетулерінің тарихы', 'История исправлений оплаты'])} lang={lang} onClose={onClose}>
        <p className="manage-dialog-description">{value(payment, 'student_name', value(payment, 'user_name'))} · {value(payment, 'course_title')}</p>
        <Notice error={history.error}/>
        {history.loading ? <Empty lang={lang} loading/> : history.data.items.length ? <div className="manage-records">{history.data.items.map(item => <div className="manage-record" key={item.id}>
            <div className="manage-record-info">
                <div className="manage-record-title">
                    <h3>{Number(item.revision) === 0 ? tr(lang, ['Бастапқы жазба', 'Исходная запись']) : `${tr(lang, ['Түзету', 'Исправление'])} №${item.revision}`}</h3>
                    <Status status={item.state} lang={lang}/>
                </div>
                <dl>
                    <div><dt>{tr(lang, ['Сома', 'Сумма'])}</dt><dd>{money(item.amount_kzt)}</dd></div>
                    <div><dt>{tr(lang, ['Төлем күні', 'Дата оплаты'])}</dt><dd>{dateLabel(item.paid_at, lang)}</dd></div>
                    <div><dt>{tr(lang, ['Тәсілі', 'Способ'])}</dt><dd>{value(item, 'method')}</dd></div>
                    <div><dt>{tr(lang, ['Енгізген', 'Автор записи'])}</dt><dd>{value(item, 'recorded_by_name')}</dd></div>
                    <div><dt>{tr(lang, ['Жазылған уақыты', 'Время записи'])}</dt><dd>{dateLabel(item.created_at, lang)}</dd></div>
                    {value(item, 'reason') && <div><dt>{tr(lang, ['Түзету себебі', 'Причина исправления'])}</dt><dd>{value(item, 'reason')}</dd></div>}
                    {value(item, 'note') && <div><dt>{tr(lang, ['Ескерту', 'Примечание'])}</dt><dd>{value(item, 'note')}</dd></div>}
                </dl>
            </div>
        </div>)}</div> : !history.error && <Empty lang={lang}/>}
        {!history.error && !history.loading && <Pager data={history.data} lang={lang} setPage={setPage} loading={history.loading}/>}
    </Dialog>;
}

function EditDialog({ tab, row, lang, onClose, onSaved, reset = false, remove = false, revoke = false, onApprove }: {
    tab: Tab;
    row?: Row;
    lang: Lang;
    onClose: () => void;
    onSaved: (result?: Record<string, unknown>) => void;
    reset?: boolean;
    remove?: boolean;
    revoke?: boolean;
    onApprove: () => void;
}) {
    const [operationId] = useState(newOperation);
    const [form, setForm] = useState<Record<string, string | number | boolean>>(() => {
        const defaults: Record<string, string | number | boolean> = {};
        for (const field of fields[tab] ?? [])
            defaults[field.key] = field.type === 'datetime-local' ? localDate(row?.[field.key]) : (row?.[field.key] ?? field.default ?? '') as string | number | boolean;
        for (const key of ['user_id', 'course_id', 'group_id', 'teacher_id', 'enrollment_id'])
            defaults[key] = row?.[key] ? String(row[key]) : '';
        defaults.state = value(row ?? { id: '' }, 'state', 'posted');
        defaults.reason = '';
        defaults.identity_verified = false;
        if (!row && tab === 'payments')
            defaults.paid_at = localDate(new Date().toISOString());
        return defaults;
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const set = (key: string, next: string | number | boolean) => setForm(current => ({ ...current, [key]: next, ...(key === 'course_id' ? { group_id: '' } : {}) }));
    useEffect(() => {
        // Some mobile/WebKit date controls emit input before React's synthetic
        // change event. Capture it so the UTC conversion always uses what is
        // visibly shown in the datetime-local field.
        const syncDateInput = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || target.type !== 'datetime-local')
                return;
            const inputs = [...document.querySelectorAll<HTMLInputElement>('.manage-form input[type="datetime-local"]')];
            const keys = (fields[tab] ?? []).filter(field => field.type === 'datetime-local');
            const key = keys[inputs.indexOf(target)]?.key;
            if (key)
                set(key, target.value);
        };
        document.addEventListener('input', syncDateInput, true);
        return () => document.removeEventListener('input', syncDateInput, true);
    }, [tab]);
    const simple = reset || remove || revoke || tab === 'devices';
    const title = reset ? tr(lang, ['Парольді қалпына келтіру', 'Сброс пароля']) : remove ? tr(lang, ['Тағайындауды жою', 'Убрать назначение']) : revoke ? tr(lang, ['Браузерді қайтару', 'Отозвать браузер']) : tab === 'devices' ? tr(lang, ['Нақты браузерді мақұлдау', 'Одобрить конкретный браузер']) : `${tr(lang, titles[tab])} · ${tr(lang, row ? ['Өзгерту', 'Изменить'] : ['Қосу', 'Добавить'])}`;
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            if (tab === 'devices' && !revoke) {
                if (!form.identity_verified)
                    throw new Error(tr(lang, ['Жеке басын растау қажет.', 'Нужна проверка личности.']));
                onApprove();
                return;
            }
            let path = `/api/admin/${tab}${row ? `/${row.id}` : ''}`;
            let method = row ? 'PATCH' : 'POST';
            const body: Record<string, unknown> = { operation_id: operationId };
            if (row && (!simple || remove) && (tab !== 'users'))
                body.revision = row.revision;
            if (reset) {
                path += '/password-reset';
                method = 'POST';
                body.identity_verified = form.identity_verified;
            }
            else if (remove) {
                path += '/remove';
                method = 'POST';
            }
            else if (revoke) {
                path = `/api/admin/users/${value(row!, 'user_id')}/revoke-device`;
                method = 'POST';
            }
            else {
                for (const field of fields[tab] ?? []) {
                    if (tab === 'users' && ((row && field.key === 'role') || (!row && field.key === 'active')))
                        continue;
                    body[field.key] = field.type === 'datetime-local' ? utcDate(String(form[field.key])) : field.type === 'number' ? Number(form[field.key]) : form[field.key];
                }
                if (tab === 'users' && !row)
                    body.identity_verified = form.identity_verified;
                if (tab === 'groups')
                    body.course_id = form.course_id;
                if (tab === 'teacher-assignments')
                    Object.assign(body, { teacher_id: form.teacher_id, course_id: form.course_id, group_id: form.group_id || null });
                if (tab === 'enrollments')
                    Object.assign(body, { user_id: form.user_id, course_id: form.course_id, group_id: form.group_id || null });
                if (tab === 'payments') {
                    body.enrollment_id = form.enrollment_id;
                    if (row)
                        Object.assign(body, { reason: form.reason, state: form.state });
                }
                if (tab === 'teacher-assignments' && body.can_manage_access && !body.group_id)
                    throw new Error(tr(lang, ['Қолжетімділікті басқару үшін нақты топты таңдаңыз.', 'Для управления доступом выберите конкретную группу.']));
            }
            const result = await managementMutation<Record<string, unknown>>(path, body, method);
            const authOperation = tab === 'users' && (!row || reset);
            if (authOperation && result.status !== 'completed') {
                setPending(true);
                setError(tr(lang, ['Операция аяқталған жоқ. Аккаунт немесе жаңа пароль берілген жоқ; «Операциялар күйі» бөлімінде сол сұрауды салыстырыңыз.', 'Операция не завершена. Аккаунт или новый пароль не выданы; сверьте тот же запрос в разделе состояния операций.']));
                return;
            }
            onSaved(result);
        }
        catch (reason) {
            setError(message(reason));
        }
        finally {
            setBusy(false);
        }
    };
    const fieldList = (fields[tab] ?? []).filter(field => !(tab === 'users' && ((row && field.key === 'role') || (!row && field.key === 'active'))));
    return <Dialog title={title} lang={lang} onClose={onClose} busy={busy}><form className="manage-form" onSubmit={event => void submit(event)}>{row && <p className="manage-dialog-description">{value(row, 'name', value(row, 'student_name', value(row, 'teacher_name', value(row, 'title', value(row, 'user_name')))))} {value(row, 'course_title')}</p>}{simple ? <><p className="manage-dialog-description">{reset ? tr(lang, ['Жеке басын тексергеннен кейін жаңа уақытша пароль беріледі. Қазіргі пароль көрсетілмейді; браузердің привязкасы сақталады.', 'После проверки личности будет выдан новый временный пароль. Текущий пароль недоступен; привязка браузера сохраняется.']) : remove ? tr(lang, ['Оқытушы бұл тағайындау берген құқықтардан айырылады. Басқа тағайындаулар бөлек сақталады.', 'Преподаватель потеряет права этого назначения. Другие назначения сохранятся.']) : revoke ? tr(lang, ['Бұл оқушының браузері, сессиялары және бейне ойнату рұқсаттары қайтарылады.', 'Браузер, сессии и разрешения воспроизведения этого ученика будут отозваны.']) : tr(lang, ['Оқушыны жеке тексеріп, осы өтінімді растаңыз. Браузерді ауыстыру бұрынғы кілт пен сессияларды қайтарып алады.', 'Проверьте ученика лично и подтвердите эту заявку. Замена браузера отзывает прежний ключ и сессии.'])}</p>{(reset || tab === 'devices') && !revoke && <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.identity_verified)} onChange={event => set('identity_verified', event.target.checked)} required/>{tr(lang, ['Жеке басын тексердім', 'Я проверил личность'])}</label>}</> : <>{tab === 'teacher-assignments' && <EntitySelect disabled={!!row} entity="users" role="TEACHER" label={tr(lang, ['Оқытушы', 'Преподаватель'])} selected={String(form.teacher_id)} selectedLabel={value(row ?? { id: '' }, 'teacher_name')} onChange={id => set('teacher_id', id)} lang={lang}/>}{tab === 'enrollments' && <EntitySelect disabled={!!row} entity="users" role="STUDENT" label={tr(lang, ['Оқушы', 'Ученик'])} selected={String(form.user_id)} selectedLabel={value(row ?? { id: '' }, 'student_name')} onChange={id => set('user_id', id)} lang={lang}/>}{['groups', 'teacher-assignments', 'enrollments'].includes(tab) && <EntitySelect disabled={!!row} entity="courses" label={tr(lang, ['Курс', 'Курс'])} selected={String(form.course_id)} selectedLabel={value(row ?? { id: '' }, 'course_title')} onChange={id => set('course_id', id)} lang={lang}/>}{['teacher-assignments', 'enrollments'].includes(tab) && form.course_id && <EntitySelect disabled={!!row && tab === "teacher-assignments"} entity="groups" courseId={String(form.course_id)} label={tr(lang, ['Топ', 'Группа'])} selected={String(form.group_id)} selectedLabel={value(row ?? { id: '' }, 'group_title')} onChange={id => set('group_id', id)} lang={lang} required={false}/>}{tab === 'payments' && <EntitySelect disabled={!!row} entity="enrollments" label={tr(lang, ['Оқушының курсы', 'Зачисление ученика'])} selected={String(form.enrollment_id)} selectedLabel={[value(row ?? { id: '' }, 'student_name'), value(row ?? { id: '' }, 'course_title')].filter(Boolean).join(' · ')} onChange={id => set('enrollment_id', id)} lang={lang}/>}<div className="manage-form-grid">{fieldList.map(field => field.type === 'checkbox' ? <label key={field.key} className="checkbox-field"><input type="checkbox" checked={Boolean(form[field.key])} onChange={event => set(field.key, event.target.checked)}/>{tr(lang, field.label)}</label> : <label key={field.key} className={field.type === 'textarea' ? 'full-field' : ''}>{tr(lang, field.label)}{field.type === 'textarea' ? <textarea value={String(form[field.key])} onChange={event => set(field.key, event.target.value)} rows={3} maxLength={4000}/> : field.type === 'select' ? <select value={String(form[field.key])} onChange={event => set(field.key, event.target.value)}>{field.options?.map(([id, copy]) => <option key={id} value={id}>{tr(lang, copy)}</option>)}</select> : <input type={field.type ?? 'text'} min={field.min} step={field.type === 'number' ? 1 : undefined} readOnly={tab === 'users' && !!row && field.key === 'phone'} required={field.required || field.type === 'number'} value={String(form[field.key])} onChange={event => set(field.key, event.target.value)} maxLength={field.type === 'tel' ? 30 : field.type === undefined ? 200 : undefined}/>}</label>)}</div>{tab === 'users' && row && <p className="form-help">{tr(lang, ['Телефон нөмірін өзгерту жеке басын тексеретін бөлек рәсім арқылы орындалады.', 'Изменение номера выполняется отдельной процедурой проверки личности.'])}</p>}{tab === 'users' && !row && <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.identity_verified)} onChange={event => set('identity_verified', event.target.checked)} required/>{tr(lang, ['Нөмір иесінің жеке басын байланыс арқылы тексердім', 'Я проверил владельца номера по личному контакту'])}</label>}{tab === 'payments' && row && <><label>{tr(lang, ['Төлем жазбасының күйі', 'Состояние записи оплаты'])}<select value={String(form.state)} onChange={event => set('state', event.target.value)}><option value="posted">{tr(lang, ['Есепке алынған', 'Учтён'])}</option><option value="voided">{tr(lang, ['Күшін жою', 'Аннулировать'])}</option></select></label><label>{tr(lang, ['Түзету себебі', 'Причина коррекции'])}<textarea value={String(form.reason)} onChange={event => set('reason', event.target.value)} required minLength={3} rows={2}/></label></>}{tab === 'enrollments' && <p className="form-help">{tr(lang, ['Төлемді белгілеу қолжетімділікті автоматты ашпайды. Күйі мен мерзімін бөлек сақтаңыз.', 'Учёт оплаты не открывает доступ автоматически. Статус и срок доступа сохраняются отдельно.'])}</p>}</>}<Notice error={error}/><div className="manage-dialog-actions"><button className="button button-yellow" disabled={busy}>{busy ? tr(lang, ['Сақталуда…', 'Сохраняем…']) : pending ? tr(lang, ['Сол сұрауды тексеру', 'Проверить тот же запрос']) : simple ? tr(lang, ['Растау', 'Подтвердить']) : tr(lang, ['Сақтау', 'Сохранить'])}</button><button type="button" className="button button-outline" disabled={busy} onClick={onClose}>{tr(lang, ['Бас тарту', 'Отмена'])}</button></div></form></Dialog>;
}
function UserDetails({ user, lang, onClose }: {
    user: Row;
    lang: Lang;
    onClose: () => void;
}) {
    const [data, setData] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState('');
    useEffect(() => { const controller = new AbortController(); void api<Record<string, unknown>>(`/api/admin/users/${user.id}`, { proof: 'api', signal: controller.signal }).then(result => { if (!controller.signal.aborted)
        setData(result); }).catch(reason => { if (!controller.signal.aborted)
        setError(message(reason)); }); return () => controller.abort(); }, [user.id]);
    return <Dialog title={value(user, 'name')} lang={lang} onClose={onClose}><p className="manage-dialog-description">{value(user, 'phone')} · {statusText(value(user, 'role'), lang)}</p><Notice error={error}/>{!data && !error ? <Empty lang={lang} loading/> : <>{(['enrollments', 'devices', 'sessions'] as const).map(section => { const records = data?.[section]; return Array.isArray(records) && <div className="manage-detail-section" key={section}><h3>{tr(lang, section === 'enrollments' ? ['Қолжетімділіктер', 'Доступы'] : section === 'devices' ? ['Браузерлер', 'Браузеры'] : ['Сессиялар', 'Сессии'])}</h3>{records.length ? records.map((record: Row) => <div className="manage-detail-item" key={record.id}><strong>{value(record, 'course_title', value(record, 'label', tr(lang, ['Сессия', 'Сессия'])))}</strong><Status status={record.effective_status ?? record.status ?? (record.revoked_at ? 'revoked' : 'active')} lang={lang}/><small>{dateLabel(record.expires_at ?? record.requested_at ?? record.created_at, lang)}</small></div>) : <p className="form-help">{tr(lang, ['Жазбалар жоқ', 'Нет записей'])}</p>}</div>; })}</>}</Dialog>;
}
type Settings = {
    revision?: number;
    title: string;
    contacts: {
        whatsapp: string;
        instagram: string;
        email: string;
        contact_email?: string;
    };
    teachers_public: {
        name: string;
        subject: string;
        bio: string;
    }[];
    faq: {
        question: string;
        answer: string;
    }[];
};
function SettingsPanel({ lang, change, onSaved }: {
    lang: Lang;
    change: number;
    onSaved: () => void;
}) {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [operationId, setOperationId] = useState(newOperation);
    useEffect(() => {
        const controller = new AbortController();
        setSettings(null);
        setError('');
        void api<{
            settings: Settings;
        }>('/api/admin/settings', { proof: 'api', signal: controller.signal }).then(result => { if (!controller.signal.aborted) {
            setSettings({ ...result.settings, contacts: { whatsapp: result.settings.contacts?.whatsapp ?? '', instagram: result.settings.contacts?.instagram ?? '', email: result.settings.contacts?.contact_email ?? result.settings.contacts?.email ?? '' }, teachers_public: result.settings.teachers_public ?? [], faq: result.settings.faq ?? [] });
            setOperationId(newOperation());
        } }).catch(reason => { if (!controller.signal.aborted)
            setError(message(reason)); });
        return () => controller.abort();
    }, [change]);
    if (!settings)
        return <><Notice error={error}/>{!error && <Empty lang={lang} loading/>}</>;
    return <form className="manage-form manage-settings" onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void managementMutation('/api/admin/settings', { revision: settings.revision, title: settings.title, contacts: settings.contacts, teachers_public: settings.teachers_public, faq: settings.faq, operation_id: operationId }, 'PATCH').then(() => onSaved()).catch(reason => setError(message(reason))).finally(() => setBusy(false)); }}><div className="manage-form-grid"><label>{tr(lang, ['Сайт атауы', 'Название сайта'])}<input value={settings.title} required maxLength={120} onChange={event => setSettings({ ...settings, title: event.target.value })}/></label>{(['whatsapp', 'instagram', 'email'] as const).map(key => <label key={key}>{key === 'email' ? tr(lang, ['Байланыс email', 'Контактный email']) : key === 'whatsapp' ? 'WhatsApp · E.164' : 'Instagram · URL'}<input type={key === 'email' ? 'email' : key === 'whatsapp' ? 'tel' : 'url'} value={settings.contacts[key] ?? ''} onChange={event => setSettings({ ...settings, contacts: { ...settings.contacts, [key]: event.target.value } })}/></label>)}</div><p className="form-help">{tr(lang, ['Бос байланыс өрісі сайтта жарияланбайды. Тек нақты мәліметтерді енгізіңіз.', 'Пустой контакт не публикуется на сайте. Укажите только реальные данные.'])}</p><section className="settings-repeat"><div className="manage-subheading"><h3>{tr(lang, ['Сайттағы оқытушылар', 'Преподаватели на сайте'])}</h3><button type="button" className="button button-outline" onClick={() => setSettings({ ...settings, teachers_public: [...settings.teachers_public, { name: '', subject: '', bio: '' }] })}>+ {tr(lang, ['Қосу', 'Добавить'])}</button></div>{settings.teachers_public.map((teacher, index) => <div className="settings-repeat-row" key={index}><div className="manage-form-grid">{(['name', 'subject', 'bio'] as const).map(key => <label key={key} className={key === 'bio' ? 'full-field' : ''}>{tr(lang, key === 'name' ? ['Нақты аты', 'Настоящее имя'] : key === 'subject' ? ['Пәні', 'Предмет'] : ['Өзі туралы', 'Описание'])}<input value={teacher[key]} required={key !== 'bio'} onChange={event => setSettings({ ...settings, teachers_public: settings.teachers_public.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item) })}/></label>)}</div><button type="button" className="manage-text-action danger" onClick={() => setSettings({ ...settings, teachers_public: settings.teachers_public.filter((_, i) => i !== index) })}>{tr(lang, ['Жою', 'Удалить'])}</button></div>)}</section><section className="settings-repeat"><div className="manage-subheading"><h3>FAQ</h3><button type="button" className="button button-outline" onClick={() => setSettings({ ...settings, faq: [...settings.faq, { question: '', answer: '' }] })}>+ {tr(lang, ['Қосу', 'Добавить'])}</button></div>{settings.faq.map((faq, index) => <div className="settings-repeat-row" key={index}><label>{tr(lang, ['Сұрақ', 'Вопрос'])}<input value={faq.question} required onChange={event => setSettings({ ...settings, faq: settings.faq.map((item, i) => i === index ? { ...item, question: event.target.value } : item) })}/></label><label>{tr(lang, ['Жауап', 'Ответ'])}<textarea value={faq.answer} required rows={3} onChange={event => setSettings({ ...settings, faq: settings.faq.map((item, i) => i === index ? { ...item, answer: event.target.value } : item) })}/></label><button type="button" className="manage-text-action danger" onClick={() => setSettings({ ...settings, faq: settings.faq.filter((_, i) => i !== index) })}>{tr(lang, ['Жою', 'Удалить'])}</button></div>)}</section><Notice error={error}/><button className="button button-yellow" disabled={busy}>{busy ? tr(lang, ['Сақталуда…', 'Сохраняем…']) : tr(lang, ['Сайт баптауларын сақтау', 'Сохранить настройки сайта'])}</button></form>;
}
