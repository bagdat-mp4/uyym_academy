import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export type Lang = 'kk' | 'ru';
export type Copy = [string, string];
export type Row = { id: string; revision?: number; [field: string]: unknown };
export type Page = { items: Row[]; total: number; page: number; page_size: number; can_manage_access?: boolean };
export const tr = (lang: Lang, copy: Copy) => copy[lang === 'kk' ? 0 : 1];
export const value = (row: Row, field: string, fallback = '') => row[field] == null ? fallback : String(row[field]);
export const message = (error: unknown) => error instanceof Error ? error.message : 'Сұрау орындалмады.';
export const newOperation = () => crypto.randomUUID();
export const dateLabel = (date: unknown, lang: Lang) => {
  if (!date || !Number.isFinite(Date.parse(String(date)))) return '—';
  return new Intl.DateTimeFormat(lang === 'kk' ? 'kk-KZ' : 'ru-RU', { timeZone: 'Asia/Almaty', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(date)));
};
export const localDate = (date: unknown) => date && Number.isFinite(Date.parse(String(date))) ? new Date(Date.parse(String(date)) + 5 * 3600000).toISOString().slice(0, 16) : '';
export const utcDate = (date: string) => date ? new Date(`${date}:00+05:00`).toISOString() : null;
export const money = (amount: unknown) => `${new Intl.NumberFormat('kk-KZ').format(Number(amount ?? 0))} ₸`;
const statusLabels: Record<string, Copy> = { active: ['Белсенді', 'Активен'], pending: ['Күтуде', 'Ожидает'], paused: ['Тоқтатылған', 'Приостановлен'], expired: ['Мерзімі аяқталған', 'Истёк'], revoked: ['Қайтарылған', 'Отозван'], approved: ['Мақұлданған', 'Одобрен'], rejected: ['Қабылданбаған', 'Отклонён'], posted: ['Есепке алынған', 'Учтён'], voided: ['Күші жойылған', 'Аннулирован'], paid: ['Төленген', 'Оплачено'], unpaid: ['Төленбеген', 'Не оплачено'], partial: ['Ішінара төленген', 'Оплачено частично'], refunded: ['Қайтарылған төлем', 'Возврат'], ADMIN: ['Әкімші', 'Администратор'], TEACHER: ['Оқытушы', 'Преподаватель'], STUDENT: ['Оқушы', 'Ученик'] };
export function Status({ status, lang }: { status: unknown; lang: Lang }) { const text = String(status ?? ''); return <span className={`manage-status status-${text.toLowerCase()}`}>{statusLabels[text] ? tr(lang, statusLabels[text]) : text || '—'}</span>; }

export function usePage(path: string, query: Record<string, string>, change: number, enabled = true) {
  const [data, setData] = useState<Page>({ items: [], total: 0, page: 1, page_size: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const serialized = new URLSearchParams(query).toString();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setData({ items: [], total: 0, page: Number(query.page ?? 1), page_size: 20 });
    void api<Page>(`${path}?${serialized}`, { proof: 'api', signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, serialized, change, enabled]);
  return { data, loading, error };
}

export function Notice({ error, success }: { error?: string; success?: string }) { return <>{error && <div className="alert alert-error" role="alert">{error}</div>}{success && <div className="alert alert-success" role="status">{success}</div>}</>; }
export function Empty({ lang, loading = false, text }: { lang: Lang; loading?: boolean; text?: Copy }) { return <div className="empty-state">{loading ? <><span className="spinner" /><p>{tr(lang, ['Деректер жүктелуде…', 'Загружаем данные…'])}</p></> : <><h3>{tr(lang, text ?? ['Бұл бөлімде жазбалар жоқ', 'В этом разделе пока нет записей'])}</h3><p>{tr(lang, ['Серверден алынған нақты деректер осы жерде көрсетіледі.', 'Здесь отображаются реальные данные сервера.'])}</p></>}</div>; }
export function Pager({ data, lang, setPage, loading }: { data: Page; lang: Lang; setPage: (page: number) => void; loading: boolean }) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return <div className="manage-pagination"><span>{tr(lang, ['Барлығы', 'Всего'])}: {data.total} · {data.page} / {pages}</span><div><button className="button button-outline" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>← {tr(lang, ['Алдыңғы', 'Назад'])}</button><button className="button button-outline" disabled={loading || data.page >= pages} onClick={() => setPage(data.page + 1)}>{tr(lang, ['Келесі', 'Далее'])} →</button></div></div>;
}

export function Dialog({ title, lang, children, onClose, busy = false, wide = false }: { title: string; lang: Lang; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, busy }); latest.current = { onClose, busy };
  useEffect(() => {
    const focusBefore = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? []);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !latest.current.busy) latest.current.onClose();
      if (event.key !== 'Tab') return;
      const elements = focusable(), first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; focusBefore?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}><div className={`modal manage-dialog${wide?' manage-dialog-wide':''}`} role="dialog" aria-modal="true" aria-label={title} ref={dialog} onClick={event => event.stopPropagation()}><button type="button" className="modal-close" aria-label={tr(lang, ['Жабу', 'Закрыть'])} disabled={busy} onClick={onClose}>×</button><h2>{title}</h2>{children}</div></div>;
}

type Option = { id: string; label?: string; name?: string; title?: string; phone?: string; student_name?: string; course_title?: string; group_title?: string; [key: string]: unknown };
export function EntitySelect({ entity, label, selectedLabel, selected, onChange, lang, role, courseId, required = true, disabled = false }: { entity: 'users' | 'courses' | 'groups' | 'enrollments'; label: string; selectedLabel?: string; selected: string; onChange: (id: string) => void; lang: Lang; role?: string; courseId?: string; required?: boolean; disabled?: boolean }) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (disabled) { setOptions([]); setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError(''); setOptions([]);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ entity, q: search }); if (role) params.set('role', role); if (courseId) params.set('course_id', courseId);
      void api<{ items: Option[] }>(`/api/admin/options?${params}`, { proof: 'api', signal: controller.signal }).then(result => { if (!controller.signal.aborted) setOptions(result.items); }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [entity, search, role, courseId, disabled]);
  const optionLabel = (item: Option) => item.label || [item.name || item.student_name || item.title, item.phone, item.course_title, item.group_title].filter(Boolean).join(' · ') || tr(lang, ['Атауы көрсетілмеген', 'Название не указано']);
  return <div className="entity-field"><label>{label}{!disabled && <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={tr(lang, ['Аты бойынша іздеу…', 'Поиск по имени или названию…'])} autoComplete="off" />}</label><select aria-label={label} value={selected} onChange={event => onChange(event.target.value)} required={required} disabled={disabled}><option value="">{loading ? tr(lang, ['Жүктелуде…', 'Загружаем…']) : required ? tr(lang, ['Таңдаңыз', 'Выберите']) : tr(lang, ['Топсыз: курс деңгейі', 'Без группы: уровень курса'])}</option>{selected && !options.some(item => item.id === selected) && <option value={selected}>{selectedLabel || tr(lang, ['Қазіргі таңдау', 'Текущий выбор'])}</option>}{options.slice(0, 20).map(item => <option value={item.id} key={item.id}>{optionLabel(item)}</option>)}</select>{error && <small className="field-error" role="alert">{error}</small>}{!disabled && <small className="field-hint">{tr(lang, ['Іздеуге сәйкес алғашқы 20 нәтиже. Нақтырақ атымен іздеңіз.', 'Первые 20 результатов. Для уточнения используйте поиск.'])}</small>}</div>;
}

export async function managementMutation<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  try { return await api<T>(path, { method, body, proof: 'api' }); }
  catch (error) {
    if (error instanceof ApiError && error.status === 403) window.dispatchEvent(new CustomEvent('uyym-management-permissions-changed'));
    throw error;
  }
}
