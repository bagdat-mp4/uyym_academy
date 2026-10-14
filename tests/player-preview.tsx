// Local visual fixture only. This entrypoint is never imported by production.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ProtectedPlayer from '../client/src/ProtectedPlayer';
import '../client/src/styles.css';
import '../client/src/management.css';
import '../client/src/dark-surfaces.css';
import '../client/src/appearance.css';
import type {Lang} from '../client/src/i18n';
function Preview(){
 const [lang,setLang]=useState<Lang>('en'),[dark,setDark]=useState(false);
 document.documentElement.lang=lang;document.documentElement.dataset.theme=dark?'dark':'light';
 return <main className="container" style={{padding:'32px 0'}}><h1>LOCAL PLAYER UI FIXTURE</h1><div className="header-actions">{(['en','kk','ru'] as Lang[]).map(code=><button key={code} className="button button-outline" onClick={()=>setLang(code)}>{code}</button>)}<button className="button button-outline" onClick={()=>setDark(!dark)}>Theme</button></div><ProtectedPlayer lang={lang} lesson={{id:'00000000-0000-4000-8000-000000000000',title:'Local player fixture',description:'',starts_at:'',course_title:'Fixture'}}/></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
