import { useEffect, useRef, useState } from 'react';
import { api, type Lesson, type User } from './api';
import {observePlayer,playerDiagnosticsEnabled,watchStudentProgress} from './player-observation';
import {tr,type Lang} from './i18n';
import VideoControls from './VideoControls';
import {UnsupportedPlayerError} from './player-error';
import VideoStatusOverlay,{type PlayerState} from './VideoStatusOverlay';

type MediaPart = { index: number; start: number; duration: number; bytes: number };
type Playback = { grant_id: string; mime: string; watermark: string; duration_seconds: number; parts: MediaPart[] };
const MAX_BYTES = 1024 * 1024;
const MAX_AHEAD = 30;
type MediaSourceConstructor = { new(): MediaSource; isTypeSupported(type: string): boolean };
type ManagedSource = MediaSource & { streaming?: boolean };

function updateBuffer(buffer: SourceBuffer, operation: () => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timeout = setTimeout(() => { clear(); reject(new Error('Бейнені дайындау уақыты аяқталды. Қайта көріңіз.')); }, 15000);
    const clear = () => {
      clearTimeout(timeout);
      buffer.removeEventListener('updateend', complete);
      buffer.removeEventListener('error', failed);
      signal.removeEventListener('abort', abort);
    };
    const complete = () => { clear(); resolve(); };
    const failed = () => { clear(); reject(new Error('Бейне форматы ойнатқышпен үйлеспейді.')); };
    const abort = () => { clear(); reject(new DOMException('Aborted', 'AbortError')); };
    buffer.addEventListener('updateend', complete, { once: true });
    buffer.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    try { operation(); } catch (error) { clear(); reject(error); }
  });
}

function isBuffered(buffer: SourceBuffer, part: MediaPart): boolean {
  for (let i = 0; i < buffer.buffered.length; i++) {
    if (buffer.buffered.start(i) <= part.start + .15 && buffer.buffered.end(i) >= part.start + part.duration - .15) return true;
  }
  return false;
}

export default function ProtectedPlayer({ lesson, lang, role }: { lesson: Lesson; lang: Lang; role:User['role'] }) {
  const t=(kk:string,ru:string)=>tr(lang,[kk,ru]);
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlayerState>('idle');
  const [failure,setFailure] = useState<unknown>(null);
  const [watermark, setWatermark] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenNotice, setFullscreenNotice] = useState('');
  const [completed, setCompleted] = useState(Boolean(lesson.completed_at));
  const [progressNotice, setProgressNotice] = useState('');
  const savingProgress = useRef(false);
  const [started, setStarted] = useState(false);
  const startedAt=useRef(0);
  const playbackLanguage=useRef(lang);
  useEffect(()=>{playbackLanguage.current=lang;},[lang]);
  useEffect(() => { setStarted(false); setState('idle'); setFailure(null); }, [lesson.id]);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const exit = (event: KeyboardEvent) => { if (event.key === 'Escape'&&!event.defaultPrevented) setExpanded(false); };
    window.addEventListener('keydown', exit);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener('keydown', exit); };
  }, [expanded]);
  const toggleFullscreen = async () => {
    setFullscreenNotice('');
    if (document.fullscreenElement === shell.current) { await document.exitFullscreen(); return; }
    if (expanded) { setExpanded(false); return; }
    try {
      if (!shell.current?.requestFullscreen) throw new Error('Fullscreen unavailable');
      await shell.current.requestFullscreen();
    } catch {
      // The whole wrapper expands, preserving the DOM watermark; never invoke native video fullscreen.
      setExpanded(true);
      setFullscreenNotice(t('Браузер толық экран API қолдамайды; ойнатқыш терезе көлеміне үлкейтілді.','Браузер не открыл полноэкранный режим; плеер увеличен до размера окна.'));
    }
  };

  useEffect(() => {
    if (!started) return;
    // Translating controls must not destroy MSE, discard its buffer or issue a
    // new grant. Async error text still reads the current selected language.
    const t=(kk:string,ru:string)=>tr(playbackLanguage.current,[kk,ru]);
    const element = video.current!;
    const controller = new AbortController();
    const diagnostics=playerDiagnosticsEnabled();
    const observation=observePlayer(diagnostics,startedAt.current||performance.now());
    const firstData=()=>{if(!controller.signal.aborted)observation.mark('first_frame_ready');};
    element.addEventListener('loadeddata',firstData,{once:true});
    const frame=diagnostics&&element.requestVideoFrameCallback?element.requestVideoFrameCallback(()=>{if(!controller.signal.aborted)observation.mark('first_frame');}):undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let objectUrl = '';
    let pumping = false;
    let source: MediaSource | undefined;
    let buffer: SourceBuffer | undefined;
    let streaming = true;
    setState('loading'); setFailure(null);

    const fail = (reason: unknown) => {
      if (controller.signal.aborted) return;
      setFailure(()=>reason);
      setState('error'); element.pause();
      controller.abort();
      if (heartbeat) clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
    };
    const mediaError = () => fail(new Error(t('Браузер бейнені декодтай алмады. Бейне форматын немесе интернет байланысын тексеріңіз.','Браузер не смог декодировать видео. Проверьте формат записи или соединение.')));
    element.addEventListener('error', mediaError);
    const startStreaming = () => { streaming = true; };
    const endStreaming = () => { streaming = false; };
    const start = async () => {
      const nativeSource = window.MediaSource as MediaSourceConstructor | undefined;
      const managedSource = (window as unknown as { ManagedMediaSource?: MediaSourceConstructor }).ManagedMediaSource;
      if (!nativeSource && !managedSource) throw new UnsupportedPlayerError();
      const grant = await observation.measure('playback',()=>api<Playback>(`/api/lessons/${lesson.id}/playback`, { method: 'POST', body: {}, proof: 'playback', signal: controller.signal,playerTiming:diagnostics }));
      const beat = () => api(`/api/playback/${grant.grant_id}/heartbeat`, { method: 'POST', body: {}, proof: 'heartbeat', signal: controller.signal }).catch(fail);
      // Keep the grant fresh while MediaSource opens and Drive validates the
      // init fragment. A slow Drive response must not expire its own grant.
      await beat();
      if (controller.signal.aborted) return;
      heartbeat = setInterval(() => void beat(), 15000);
      const Source = nativeSource?.isTypeSupported(grant.mime) ? nativeSource : managedSource?.isTypeSupported(grant.mime) ? managedSource : undefined;
      if (!Source) throw new UnsupportedPlayerError();
      const initial = grant.parts.find(part => part.index === -1);
      const fragments = grant.parts.filter(part => part.index >= 0).sort((a, b) => a.start - b.start);
      if (!initial || !fragments.length || grant.parts.some(part => part.bytes > MAX_BYTES || part.bytes <= 0 || (part.index >= 0 && (part.duration <= 0 || part.duration > MAX_AHEAD)))) {
        throw new Error(t('Бейне қорғалған бөліктерге дұрыс дайындалмаған. Әкімшіге хабарласыңыз.','Видео не подготовлено для безопасной выдачи частей. Обратитесь к администратору.'));
      }
      setWatermark(grant.watermark);
      source = new Source();
      if (Source === managedSource) {
        streaming = (source as ManagedSource).streaming !== false;
        source.addEventListener('startstreaming', startStreaming);
        source.addEventListener('endstreaming', endStreaming);
      }
      // iPhone ManagedMediaSource is available only with an AirPlay alternative or explicit remote-playback disablement.
      element.disableRemotePlayback = true;
      element.preload = 'auto';
      objectUrl = URL.createObjectURL(source);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { clear(); reject(new Error(t('Ойнатқыш ашылмады. Браузерді жаңартып, қайта көріңіз.','Плеер не открылся. Обновите браузер и повторите попытку.'))); }, 15000);
        const clear = () => { clearTimeout(timeout); source!.removeEventListener('sourceopen', opened); controller.signal.removeEventListener('abort', aborted); };
        const opened = () => { clear(); resolve(); };
        const aborted = () => { clear(); reject(new DOMException('Aborted', 'AbortError')); };
        source!.addEventListener('sourceopen', opened, { once: true });
        controller.signal.addEventListener('abort', aborted, { once: true });
        element.src = objectUrl;
        element.load();
      });
      if (controller.signal.aborted) return;
      source.duration = grant.duration_seconds;
      buffer = source.addSourceBuffer(grant.mime);
      buffer.mode = 'segments';
      const loadPart = async (part: MediaPart) => {
        const path = `/api/media/${lesson.id}?grant=${encodeURIComponent(grant.grant_id)}&part=${part.index}`;
        const request=()=>api<ArrayBuffer>(path, { proof: 'media', binary: true, signal: controller.signal,playerTiming:diagnostics });
        const bytes = await(part.index===-1?observation.measure('media_init',request):part.index===0?observation.measure('media_0',request):request());
        if (bytes.byteLength > MAX_BYTES || bytes.byteLength !== part.bytes) throw new Error('Media part integrity check failed.');
        await updateBuffer(buffer!, () => buffer!.appendBuffer(bytes), controller.signal);
      };
      await loadPart(initial);
      if (lesson.progress_seconds && lesson.progress_seconds > 0 && lesson.progress_seconds < grant.duration_seconds - 1) element.currentTime = lesson.progress_seconds;
      const pump = async () => {
        if (pumping || controller.signal.aborted) return;
        // Safari asks the client to stop/start streaming to save energy; heartbeat remains active.
        if (!streaming) { timer = setTimeout(() => void pump(), 300); return; }
        pumping = true;
        try {
          const now = element.currentTime;
          const wanted = fragments.find(part => part.start + part.duration > now + .05 && !isBuffered(buffer!, part));
          const ahead = element.paused ? Math.min(MAX_AHEAD, 8) : MAX_AHEAD;
          // Remove future fragments even if this seek lands in an already buffered fragment.
          if (buffer!.buffered.length && buffer!.buffered.end(buffer!.buffered.length - 1) > now + MAX_AHEAD + 4) {
            await updateBuffer(buffer!, () => buffer!.remove(now + MAX_AHEAD, grant.duration_seconds), controller.signal);
          }
          if (wanted && (wanted.start <= now || wanted.start + wanted.duration <= now + ahead)) {
            // Segments are independently decodable and contain absolute timestamps; seeking fetches only the target fragment.
            if (now > 20 && buffer!.buffered.length && buffer!.buffered.start(0) < now - 15) {
              await updateBuffer(buffer!, () => buffer!.remove(0, Math.max(0, now - 15)), controller.signal);
            }
            await loadPart(wanted);
            setState('ready');
            if (wanted.index === fragments[fragments.length - 1].index && source!.readyState === 'open' && !buffer!.updating) {
              // Mark the finite recording complete. appending a fragment after a backward seek reopens MSE automatically.
              source!.endOfStream();
            }
          }
        } catch (reason) { fail(reason); }
        finally {
          pumping = false;
          if (!controller.signal.aborted) timer = setTimeout(() => void pump(), 300);
        }
      };
      await pump();
      // Playback was explicitly requested by the central button. If a browser
      // requires another gesture after asynchronous authorization, the ready
      // controls remain paused and offer Play; no muted autoplay workaround.
      if(!controller.signal.aborted)void element.play().catch(()=>{});
    };
    void start().catch(fail);
    return () => {
      controller.abort();
      if (heartbeat) clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      element.removeEventListener('error', mediaError);
      element.removeEventListener('loadeddata',firstData);
      if(frame!==undefined)element.cancelVideoFrameCallback(frame);
      source?.removeEventListener('startstreaming', startStreaming);
      source?.removeEventListener('endstreaming', endStreaming);
      element.pause(); element.removeAttribute('src'); element.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [lesson.id, attempt, started]);

  useEffect(() => {
    if(role!=='STUDENT')return;
    const element=video.current!;
    let lastSaved=Number(lesson.progress_seconds??0);
    const save=async(done=false)=>{
      const position=Math.max(0,element.currentTime||0);
      if(savingProgress.current||(!done&&Math.abs(position-lastSaved)<5))return;
      savingProgress.current=true;
      try{
        const result=await api<{position_seconds:number;completed_at:string|null}>(`/api/lessons/${lesson.id}/progress`,{method:'PATCH',proof:'api',body:{position_seconds:position,completed:done}});
        lastSaved=Number(result.position_seconds);
        if(result.completed_at){setCompleted(true);setProgressNotice(t('Сабақ аяқталды деп белгіленді.','Урок отмечен завершённым.'));}
      }catch{/* Progress is secondary to playback; the next interval retries. */}
      finally{savingProgress.current=false;}
    };
    return watchStudentProgress(role,element,()=>void save(false));
  },[lesson.id,lesson.progress_seconds,lang,role]);

  const focusStage=()=>shell.current?.querySelector<HTMLElement>('.video-stage')?.focus({preventScroll:true});
  const startPlayback=()=>{focusStage();startedAt.current=performance.now();setStarted(true);};
  return <div ref={shell} className={`player-shell uyym-player ${expanded ? 'player-expanded' : ''}`}>
    <div className="video-stage" role="group" aria-label={`${t('Бейне ойнатқыш','Видеоплеер')}: ${lesson.title}`} tabIndex={0}>
      <video ref={video} controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture disableRemotePlayback playsInline preload="none" onContextMenu={event => event.preventDefault()} aria-label={lesson.title} />
      {watermark && <div className="video-watermark" aria-hidden="true">UYYM Academy · {watermark}</div>}
      <VideoControls videoRef={video} lang={lang} enabled={state==='ready'} onFullscreen={()=>void toggleFullscreen()} fullscreen={expanded||fullscreen}/>
      <VideoStatusOverlay state={state} lang={lang} failure={failure} fullscreen={expanded||fullscreen} onStart={startPlayback} onRetry={()=>{focusStage();startedAt.current=performance.now();setAttempt(value=>value+1);}} onExit={()=>void toggleFullscreen()}/>
    </div>
    <div className="player-tools"><span className="small-dot"/>{t('Жеке оқу қолжетімділігі','Персональный учебный доступ')}{role==='STUDENT'&&<button type="button" className={`complete-button ${completed?'completed':''}`} disabled={completed||!started||state==='error'} onClick={()=>{const element=video.current;if(role!=='STUDENT'||!element||savingProgress.current)return;savingProgress.current=true;setProgressNotice('');void api<{completed_at:string|null}>(`/api/lessons/${lesson.id}/progress`,{method:'PATCH',proof:'api',body:{position_seconds:Math.max(0,element.currentTime||0),completed:true}}).then(result=>{if(result.completed_at){setCompleted(true);setProgressNotice(t('Сабақ аяқталды деп белгіленді.','Урок отмечен завершённым.'));}}).catch(()=>setProgressNotice(t('Белгіні сақтау мүмкін болмады. Қайта көріңіз.','Не удалось сохранить отметку. Повторите попытку.'))).finally(()=>{savingProgress.current=false;});}}>{completed?'✓ ':''}{t('Аяқталды','Завершить')}</button>}</div>
    {progressNotice&&<p className="player-progress-notice" role="status">{progressNotice}</p>}
    {fullscreenNotice&&<p className="player-fullscreen-notice" role="status">{fullscreenNotice}</p>}
    <details className="player-privacy"><summary>{t('Жеке бейнені көру туралы','О приватном просмотре')}</summary><p className="privacy-note">{t('Әр жаңа бөлікке қолжетімділік қайта тексеріледі. Бұрын алынған буферді қайтару және экран жазбасын толық тоқтату мүмкін емес. Бұл DRM емес.','Доступ проверяется перед каждой новой частью. Уже полученный буфер нельзя отозвать; запись экрана полностью предотвратить нельзя. Это не DRM.')}</p></details>
  </div>;
}
