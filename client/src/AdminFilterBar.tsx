import type {ReactNode} from 'react';
import {tr,type Lang} from './i18n';
import {Button,UiIcon} from './ui';

export default function AdminFilterBar({children,lang,onReset,resetDisabled}:{children:ReactNode;lang:Lang;onReset:()=>void;resetDisabled:boolean}){
 return <div className="manage-toolbar admin-filterbar">{children}<Button type="button" variant="ghost" onClick={onReset} disabled={resetDisabled}><UiIcon name="close"/>{tr(lang,['Сүзгілерді тазарту','Сбросить фильтры'])}</Button></div>;
}
