import {ApiError} from './api';
import {tr,type Lang} from './i18n';

/** UI messages deliberately exclude provider diagnostics, URLs and server payloads. */
export function playerFailure(reason:unknown,lang:Lang):{message:string;retry:boolean}{
 const copy=(kk:string,ru:string)=>tr(lang,[kk,ru]);
 if(reason instanceof ApiError){
  if(reason.status===401)return {message:copy('Сессия аяқталды. Аккаунтқа қайта кіріңіз.','Сессия истекла. Войдите в аккаунт снова.'),retry:false};
  if(reason.code==='MEDIA_GRANT_EXPIRED')return {message:copy('Бейне рұқсаты аяқталды. Көруді қайта бастаңыз.','Разрешение на видео истекло. Запустите просмотр снова.'),retry:true};
  if(reason.status===403)return {message:copy('Бейнеге қолжетімділік расталмады. Браузер мен курс рұқсатын тексеру үшін әкімшіге хабарласыңыз.','Доступ к видео не подтверждён. Обратитесь к администратору для проверки браузера и доступа к курсу.'),retry:false};
  if(reason.status===404)return {message:copy('Бұл бейне қазір қолжетімсіз. Әкімшіге хабарласыңыз.','Видео сейчас недоступно. Обратитесь к администратору.'),retry:false};
  if(reason.status===408||reason.status===429)return {message:copy('Байланыс баяу немесе сұраулар тым жиі. Біраз күтіп, қайталаңыз.','Соединение медленное или запросы слишком частые. Подождите немного и повторите.'),retry:true};
 }
 if(reason instanceof UnsupportedPlayerError)return {message:copy('Бұл браузер қорғалған бейне форматын қолдамайды. Chrome, Edge немесе MediaSource қолдайтын Safari қолданыңыз.','Браузер не поддерживает защищённое видео. Используйте Chrome, Edge или Safari с поддержкой MediaSource.'),retry:false};
 return {message:copy('Бейнені ойнату мүмкін болмады. Интернет байланысын тексеріп, қайталап көріңіз.','Не удалось воспроизвести видео. Проверьте соединение и повторите попытку.'),retry:true};
}

export class UnsupportedPlayerError extends Error {}
