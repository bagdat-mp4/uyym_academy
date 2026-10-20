import {tr,type Lang,type ThemePreference} from './i18n';
export default function ThemeControl({lang,value,onChange}:{lang:Lang;value:ThemePreference;onChange:(value:ThemePreference)=>void}){
 return <label className="theme-control"><span className="sr-only">{tr(lang,['Тақырып','Тема'])}</span><select value={value} onChange={event=>onChange(event.target.value as ThemePreference)}><option value="light">{tr(lang,['Жарық','Светлая'])}</option><option value="dark">{tr(lang,['Қараңғы','Тёмная'])}</option><option value="system">{tr(lang,['Жүйелік','Системная'])}</option></select></label>;
}
