import {useEffect,useId,useRef,useState,type CSSProperties,type RefObject} from 'react';
import {tr,type Lang} from './i18n';
import {clampSeek,finiteDuration,formatMediaDuration,formatMediaTime,playbackRates,playerShortcut,seekOffset} from './player-controls-model';

type Snapshot={time:number;duration:number;paused:boolean;ended:boolean;muted:boolean;volume:number;rate:number;buffered:{start:number;end:number}[];captions:boolean;captionsOn:boolean};
const initial:Snapshot={time:0,duration:0,paused:true,ended:false,muted:false,volume:1,rate:1,buffered:[],captions:false,captionsOn:false};
const captionTracks=(video:HTMLVideoElement)=>Array.from(video.textTracks).filter(track=>track.kind==='captions'||track.kind==='subtitles');
function snapshot(video:HTMLVideoElement):Snapshot{
 const duration=finiteDuration(video.duration),tracks=captionTracks(video),buffered=[];
 for(let index=0;index<video.buffered.length;index++)buffered.push({start:clampSeek(video.buffered.start(index),duration),end:clampSeek(video.buffered.end(index),duration)});
 return {time:clampSeek(video.currentTime,duration),duration,paused:video.paused,ended:video.ended,muted:video.muted,volume:video.volume,rate:video.playbackRate,buffered,captions:tracks.length>0,captionsOn:tracks.some(track=>track.mode==='showing')};
}
function Glyph({name}:{name:'play'|'pause'|'volume'|'muted'|'settings'|'expand'|'collapse'|'captions'|'check'}){
 const paths={
  play:<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>,
  pause:<><path d="M7 5h4v14H7zM15 5h4v14h-4z" fill="currentColor" stroke="none"/></>,
  volume:<><path d="m11 5-6 5H2v4h3l6 5z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  muted:<><path d="m11 5-6 5H2v4h3l6 5z"/><path d="m16 9 6 6m0-6-6 6"/></>,
  settings:<><path d="m10 3-.7 2.2-2 .8-2.1-.9-2 3.4 1.7 1.5-.3 2.2-1.7 1.5 2 3.5 2.2-.9 2 .8.6 2.2h4l.7-2.2 2-.8 2.1.9 2-3.5-1.7-1.5-.3-2.2 1.7-1.5-2-3.4-2.2.9-2-.8L14 3z"/><circle cx="12" cy="11.6" r="3"/></>,
  expand:<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,
  collapse:<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>,
  captions:<><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 10a3 3 0 1 0 0 4m8-4a3 3 0 1 0 0 4"/></>,
  check:<path d="m5 12 4 4L19 6"/>
 };
 return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function VideoControls({videoRef,lang,enabled,onFullscreen,fullscreen}:{videoRef:RefObject<HTMLVideoElement|null>;lang:Lang;enabled:boolean;onFullscreen:()=>void;fullscreen:boolean}){
 const t=(kk:string,ru:string)=>tr(lang,[kk,ru]);
 const [media,setMedia]=useState(initial),[visible,setVisible]=useState(true),[settings,setSettings]=useState(false),[playError,setPlayError]=useState(false);
 const [hover,setHover]=useState<{fraction:number;time:number}|null>(null),[waiting,setWaiting]=useState(false),[stageHeight,setStageHeight]=useState(180);
 const settingsId=useId(),settingsButton=useRef<HTMLButtonElement>(null),settingsPanel=useRef<HTMLDivElement>(null);
 const enabledRef=useRef(enabled),settingsRef=useRef(settings),controlsHovered=useRef(false),fullscreenRef=useRef(onFullscreen),wake=useRef<()=>void>(()=>{});
 enabledRef.current=enabled;settingsRef.current=settings;fullscreenRef.current=onFullscreen;

 const play=()=>{
  const video=videoRef.current;if(!video||!enabledRef.current)return;
  setPlayError(false);
  if(video.paused){if(video.ended)video.currentTime=0;void video.play().catch(()=>setPlayError(true));}else video.pause();
 };
 const toggleCaptions=()=>{
  const video=videoRef.current;if(!video||!enabledRef.current)return;
  const tracks=captionTracks(video),show=!tracks.some(track=>track.mode==='showing');
  tracks.forEach((track,index)=>{track.mode=show&&index===0?'showing':'disabled';});
  setMedia(snapshot(video));
 };
 const playRef=useRef(play),captionsRef=useRef(toggleCaptions);playRef.current=play;captionsRef.current=toggleCaptions;

 // Localization and controls re-renders never detach the media engine or create a grant.
 useEffect(()=>{
  const video=videoRef.current,stage=video?.parentElement;if(!video||!stage)return;
  let hideTimer:ReturnType<typeof setTimeout>|undefined,focusTimer:ReturnType<typeof setTimeout>|undefined;
  const clear=()=>{if(hideTimer)clearTimeout(hideTimer);};
  const schedule=()=>{
   clear();
   const active=document.activeElement,controlFocused=active!==stage&&stage.contains(active);
   if(enabledRef.current&&!video.paused&&!settingsRef.current&&!controlsHovered.current&&!controlFocused)hideTimer=setTimeout(()=>setVisible(false),2600);
  };
  const reveal=()=>{setVisible(true);schedule();};
  const update=()=>{setMedia(snapshot(video));};
  // timeupdate/progress can fire several times a second: they must not restart
  // the inactivity timer, otherwise playing controls would never fade out.
  const playbackChanged=()=>{update();if(video.paused)reveal();else schedule();};
  const buffering=()=>{setWaiting(true);reveal();};
  const playable=()=>{setWaiting(false);update();};
  const clicked=(event:MouseEvent)=>{if(enabledRef.current&&event.target===video){stage.focus({preventScroll:true});playRef.current();reveal();}};
  const resized=()=>setStageHeight(stage.clientHeight||180);
  const resizeObserver=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(resized);
  resizeObserver?.observe(stage);resized();
  const focusIn=()=>{clear();setVisible(true);};
  const focusOut=()=>{if(focusTimer)clearTimeout(focusTimer);focusTimer=setTimeout(schedule,0);};
  const keyboard=(event:KeyboardEvent)=>{
   if(!enabledRef.current||event.altKey||event.ctrlKey||event.metaKey||!stage.contains(document.activeElement))return;
   const target=event.target;
   if(target instanceof Element&&target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="slider"]')){
    if(event.key==='Escape'&&settingsRef.current){event.preventDefault();event.stopPropagation();setSettings(false);settingsButton.current?.focus();}
    return;
   }
   const action=playerShortcut(event.key);if(!action)return;
   if(action==='captions'&&!captionTracks(video).length)return;
   if(action==='escape'){if(settingsRef.current){event.preventDefault();event.stopPropagation();setSettings(false);settingsButton.current?.focus();}return;}
   event.preventDefault();reveal();
   if(action==='play')playRef.current();
   else if(action==='back'||action==='forward')video.currentTime=clampSeek(video.currentTime+(seekOffset(event.key)??0),video.duration);
   else if(action==='mute')video.muted=!video.muted;
   else if(action==='volume-up'||action==='volume-down'){video.volume=Math.max(0,Math.min(1,video.volume+(action==='volume-up'?.05:-.05)));if(video.volume>0)video.muted=false;}
   else if(action==='fullscreen')fullscreenRef.current();
   else if(action==='captions')captionsRef.current();
  };
  const events=['timeupdate','durationchange','loadedmetadata','loadeddata','volumechange','ratechange','progress','seeking','seeked','emptied'] as const;
  events.forEach(name=>video.addEventListener(name,update));
  const playbackEvents=['play','playing','pause','ended'] as const;
  playbackEvents.forEach(name=>video.addEventListener(name,playbackChanged));
  const waitEvents=['waiting','stalled','seeking'] as const,playableEvents=['playing','canplay','seeked','ended','emptied'] as const;
  waitEvents.forEach(name=>video.addEventListener(name,buffering));playableEvents.forEach(name=>video.addEventListener(name,playable));
  video.textTracks.addEventListener('addtrack',update);video.textTracks.addEventListener('removetrack',update);video.textTracks.addEventListener('change',update);
  stage.addEventListener('pointermove',reveal);stage.addEventListener('pointerdown',reveal);stage.addEventListener('pointerleave',schedule);
  stage.addEventListener('focusin',focusIn);stage.addEventListener('focusout',focusOut);stage.addEventListener('keydown',keyboard);stage.addEventListener('click',clicked);
  wake.current=reveal;update();
  return ()=>{
   clear();if(focusTimer)clearTimeout(focusTimer);wake.current=()=>{};resizeObserver?.disconnect();
   events.forEach(name=>video.removeEventListener(name,update));
   playbackEvents.forEach(name=>video.removeEventListener(name,playbackChanged));
   waitEvents.forEach(name=>video.removeEventListener(name,buffering));playableEvents.forEach(name=>video.removeEventListener(name,playable));
   video.textTracks.removeEventListener('addtrack',update);video.textTracks.removeEventListener('removetrack',update);video.textTracks.removeEventListener('change',update);
   stage.removeEventListener('pointermove',reveal);stage.removeEventListener('pointerdown',reveal);stage.removeEventListener('pointerleave',schedule);
   stage.removeEventListener('focusin',focusIn);stage.removeEventListener('focusout',focusOut);stage.removeEventListener('keydown',keyboard);stage.removeEventListener('click',clicked);
  };
 },[videoRef]);
 useEffect(()=>{wake.current();if(!enabled){setSettings(false);setPlayError(false);setWaiting(false);}},[enabled]);
 useEffect(()=>{wake.current();if(!settings)return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!settingsPanel.current?.contains(event.target)&&!settingsButton.current?.contains(event.target))setSettings(false);};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[settings]);
 const seek=(value:number)=>{const video=videoRef.current;if(video&&enabled&&media.duration)video.currentTime=clampSeek(value,media.duration);};
 const ratio=media.duration?media.time/media.duration:0,muted=media.muted||media.volume===0;
 const totalLabel=formatMediaDuration(media.duration),currentLabel=media.ended?totalLabel:formatMediaTime(media.time);
 const playLabel=media.ended?t('Бейнені қайта ойнату','Повторить видео'):media.paused?t('Ойнату','Воспроизвести'):t('Кідірту','Пауза');
 if(!enabled)return null;
 return <div className={`uyym-video-controls${visible||media.paused||settings||waiting?'':' uyym-controls-hidden'}`} style={{'--uyym-video-height':`${stageHeight}px`} as CSSProperties}>
  {media.paused&&!waiting&&<button type="button" className="uyym-center-play" onClick={play} aria-label={playLabel}><Glyph name="play"/></button>}
  {waiting&&<div className="uyym-buffering" role="status"><span className="sr-only">{t('Бейне буферленуде…','Буферизация видео…')}</span></div>}
  {playError&&<p className="uyym-player-play-error" role="status">{t('Бейнені бастау үшін ойнату түймесін қайта басыңыз.','Нажмите воспроизведение ещё раз, чтобы запустить видео.')}</p>}
  <div className="uyym-control-bar" role="group" aria-label={t('Бейне басқаруы','Управление видео')} onPointerEnter={event=>{if(event.pointerType!=='touch'){controlsHovered.current=true;wake.current();}}} onPointerLeave={()=>{controlsHovered.current=false;wake.current();}}>
   <div className="uyym-timeline" onPointerMove={event=>{if(event.pointerType==='touch')return;const rect=event.currentTarget.getBoundingClientRect();const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));setHover({fraction,time:fraction*media.duration});}} onPointerLeave={()=>setHover(null)}>
    <div className="uyym-timeline-rail" aria-hidden="true">
     {media.buffered.map((range,index)=><i className="uyym-buffered" key={index} style={{left:`${media.duration?range.start/media.duration*100:0}%`,width:`${media.duration?(range.end-range.start)/media.duration*100:0}%`}}/>)}
     <i className="uyym-played" style={{width:`${ratio*100}%`}}/>
    </div>
    <input className="uyym-seek" type="range" min="0" max={media.duration||1} step="0.1" value={media.time} disabled={!enabled||!media.duration} aria-label={t('Бейне орны','Позиция видео')} aria-valuetext={`${currentLabel} / ${totalLabel}`} onChange={event=>seek(Number(event.target.value))} style={{'--uyym-played':`${ratio*100}%`} as CSSProperties}/>
    {hover&&enabled&&media.duration>0&&<output className="uyym-seek-preview" aria-hidden="true" style={{left:`${Math.min(95,Math.max(5,hover.fraction*100))}%`}}>{formatMediaTime(hover.time)}</output>}
   </div>
   <div className="uyym-control-row">
    <button type="button" className="uyym-control-button" onClick={play} disabled={!enabled} aria-label={playLabel} title={playLabel} aria-keyshortcuts="k Space"><Glyph name={media.paused?'play':'pause'}/></button>
    <div className="uyym-volume-group">
     <button type="button" className="uyym-control-button" disabled={!enabled} onClick={()=>{if(videoRef.current)videoRef.current.muted=!videoRef.current.muted;}} aria-pressed={muted} aria-label={muted?t('Дыбысты қосу','Включить звук'):t('Дыбысты өшіру','Выключить звук')} title={muted?t('Дыбысты қосу','Включить звук'):t('Дыбысты өшіру','Выключить звук')} aria-keyshortcuts="m"><Glyph name={muted?'muted':'volume'}/></button>
     <input className="uyym-volume" type="range" min="0" max="1" step="0.05" value={muted?0:media.volume} disabled={!enabled} aria-label={t('Дыбыс деңгейі','Громкость')} aria-valuetext={`${Math.round((muted?0:media.volume)*100)}%`} onChange={event=>{const video=videoRef.current;if(video){video.volume=Number(event.target.value);video.muted=video.volume===0;}}}/>
    </div>
    <span className="uyym-time" aria-label={t('Ағымдағы уақыт және ұзақтығы','Текущее время и длительность')}>{currentLabel} <span>/ {totalLabel}</span></span>
    <div className="uyym-control-spacer"/>
    {media.captions&&<button type="button" className="uyym-control-button uyym-captions-button" disabled={!enabled} onClick={toggleCaptions} aria-pressed={media.captionsOn} aria-label={t('Субтитрлер','Субтитры')} title={t('Субтитрлер','Субтитры')} aria-keyshortcuts="c"><Glyph name="captions"/></button>}
    <div className="uyym-settings-wrap">
     <button type="button" ref={settingsButton} className="uyym-control-button" disabled={!enabled} onClick={()=>setSettings(value=>!value)} aria-expanded={settings} aria-controls={settings?settingsId:undefined} aria-label={t('Ойнатқыш баптаулары','Настройки плеера')} title={t('Ойнатқыш баптаулары','Настройки плеера')}><Glyph name="settings"/></button>
     {settings&&<div ref={settingsPanel} id={settingsId} className="uyym-settings-panel" role="group" aria-label={t('Ойнату жылдамдығы','Скорость воспроизведения')}>
      <p>{t('Ойнату жылдамдығы','Скорость воспроизведения')}</p>
      {playbackRates.map(rate=><button type="button" key={rate} className="uyym-rate-option" aria-pressed={media.rate===rate} onClick={()=>{if(videoRef.current)videoRef.current.playbackRate=rate;setSettings(false);settingsButton.current?.focus();}}><span>{rate===1?t('Қалыпты','Обычная'):`${rate}×`}</span>{media.rate===rate?<Glyph name="check"/>:<span/>}</button>)}
     </div>}
    </div>
    <button type="button" className="uyym-control-button" disabled={!enabled} onClick={onFullscreen} aria-label={fullscreen?t('Толық экраннан шығу','Выйти из полноэкранного режима'):t('Толық экран','Полный экран')} title={fullscreen?t('Толық экраннан шығу','Выйти из полноэкранного режима'):t('Толық экран','Полный экран')} aria-keyshortcuts="f"><Glyph name={fullscreen?'collapse':'expand'}/></button>
   </div>
  </div>
 </div>;
}
