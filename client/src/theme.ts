import {useEffect,useState} from 'react';
import {preferenceStorage,savedTheme,type ThemePreference} from './i18n';
export const resolveTheme=(choice:ThemePreference,systemDark:boolean):'light'|'dark'=>choice==='system'?(systemDark?'dark':'light'):choice;
const systemIsDark=()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-color-scheme: dark)').matches;
export function applyTheme(choice:ThemePreference,systemDark=systemIsDark()){
 const resolved=resolveTheme(choice,systemDark);
 document.documentElement.dataset.theme=resolved;
 document.documentElement.dataset.themePreference=choice;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='dark'?'#171e19':'#faf9f4');
}
export function useTheme(){
 const [theme,setTheme]=useState<ThemePreference>(()=>savedTheme(preferenceStorage));
 useEffect(()=>{
  applyTheme(theme);preferenceStorage.setItem('uyym-theme',theme);
  if(theme!=='system'||typeof window.matchMedia!=='function')return;
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  const changed=()=>applyTheme('system',media.matches);
  media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);
 },[theme]);
 return [theme,setTheme] as const;
}
