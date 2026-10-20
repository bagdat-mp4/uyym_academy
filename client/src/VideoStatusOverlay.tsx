import {tr,type Lang} from './i18n';
import {playerFailure} from './player-error';

export type PlayerState='idle'|'loading'|'ready'|'error';

export default function VideoStatusOverlay({state,lang,failure,fullscreen,onStart,onRetry,onExit}:{state:PlayerState;lang:Lang;failure:unknown;fullscreen:boolean;onStart:()=>void;onRetry:()=>void;onExit:()=>void}){
 const t=(kk:string,ru:string)=>tr(lang,[kk,ru]),error=playerFailure(failure,lang);
 return <>
  {state==='idle'&&<div className="player-overlay player-idle uyym-player-idle"><button type="button" className="uyym-player-start" onClick={onStart} aria-label={t('Ойнату','Воспроизвести')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z" fill="currentColor"/></svg></button><p>{t('Сабақ бейнесі','Видео урока')}</p></div>}
  {state==='loading'&&<div className="player-overlay uyym-player-loading" role="status"><span className="spinner" aria-hidden="true"/><span>{t('Бейне дайындалуда…','Подготовка видео…')}</span></div>}
  {state==='error'&&<div className="player-overlay player-error uyym-player-error"><p role="alert">{error.message}</p>{error.retry&&<button type="button" className="uyym-player-retry" onClick={onRetry}>{t('Қайта көру','Повторить')}</button>}</div>}
  {fullscreen&&state!=='ready'&&<button type="button" className="uyym-player-exit" onClick={onExit} aria-label={t('Толық экраннан шығу','Выйти из полноэкранного режима')}>↙ <span>{t('Толық экраннан шығу','Выйти из полноэкранного режима')}</span></button>}
 </>;
}
