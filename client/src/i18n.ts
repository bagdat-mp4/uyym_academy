import english from './english.json';
export {publicFaq} from '../../shared/public-faq.js';
export type Lang = 'en' | 'kk' | 'ru';
export type Copy = [string,string];
export const preferenceStorage={
 getItem(key:string){try{return localStorage.getItem(key);}catch{return null;}},
 setItem(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Keep the UI usable when storage is disabled. */}}
};
const catalog:Record<string,string>=english;
export function tr(lang:Lang,copy:Copy):string {
 return lang==='kk'?copy[0]:lang==='ru'?copy[1]:catalog[copy[1]]??copy[1];
}
export const locale=(lang:Lang)=>lang==='kk'?'kk-KZ':lang==='ru'?'ru-RU':'en-GB';
export function currentLanguage():Lang {
 const lang=document.documentElement.lang;return lang==='kk'||lang==='ru'?lang:'en';
}
export function interfaceError(error:unknown):string {
 const lang=currentLanguage();
 const text=error instanceof Error?error.message:'';
 const local:Record<string,[string,string]>={
  'Бұл браузер қауіпсіз кілтті қолдамайды. HTTPS арқылы Chrome, Edge немесе Safari қолданыңыз.':['Браузер не поддерживает безопасный ключ. Используйте Chrome, Edge или Safari через HTTPS.','Use Chrome, Edge or Safari over HTTPS to create a secure browser key.'],
  'Бейнені дайындау уақыты аяқталды. Қайта көріңіз.':['Время подготовки видео истекло. Повторите попытку.','Video preparation timed out. Try again.'],
  'Бейне форматы ойнатқышпен үйлеспейді.':['Формат видео несовместим с плеером.','The video format is incompatible with this player.'],
 };
 if(local[text])return lang==='kk'?text:local[text][lang==='ru'?0:1];
 if(!text||/^[А-Яа-яӘәҚқҰұІі]/.test(text)&&lang==='en')return 'The request could not be completed. Please try again.';
 return text|| (lang==='ru'?'Запрос не выполнен.':'Сұрау орындалмады.');
}
export function savedLanguage(storage:Pick<Storage,'getItem'>):Lang {
 try {const saved=storage.getItem('uyym-language');return saved==='kk'||saved==='ru'||saved==='en'?saved:'en';}catch{return 'en';}
}
export type ThemePreference='light'|'dark'|'system';
export function savedTheme(storage:Pick<Storage,'getItem'>):ThemePreference {
 try{const value=storage.getItem('uyym-theme');return value==='dark'||value==='system'?value:'light';}catch{return 'light';}
}
