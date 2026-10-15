// Instrumentation belongs only to this local test page, not the public app.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ProtectedPlayer from '../client/src/ProtectedPlayer';
import '../client/src/styles.css';
import '../client/src/management.css';
import '../client/src/appearance.css';
import '../client/src/design-system.css';
type Role='ADMIN'|'TEACHER'|'STUDENT';
function Benchmark(){
 const [role,setRole]=useState<Role>('STUDENT'),[run,setRun]=useState(0),[frame,setFrame]=useState<string>('not measured'),[loaded,setLoaded]=useState<string>('not measured'),[stats,setStats]=useState<unknown>({});
 const host=useRef<HTMLDivElement>(null),started=useRef(0);
 useEffect(()=>{
  sessionStorage.setItem('uyym-player-timing','1');
  const video=host.current!.querySelector('video')!;
  const loaded=()=>{if(started.current)setLoaded(`${Math.round(performance.now()-started.current)} ms`);};
  video.addEventListener('loadeddata',loaded);
  let handle:number|undefined;
  const click=(event:MouseEvent)=>{if((event.target as HTMLElement).closest('.player-overlay button')){started.current=performance.now();if(video.requestVideoFrameCallback)handle=video.requestVideoFrameCallback(()=>setFrame(`${Math.round(performance.now()-started.current)} ms`));}};
  host.current!.addEventListener('click',click,true);
  const h=host.current!;return()=>{video.removeEventListener('loadeddata',loaded);h.removeEventListener('click',click,true);if(handle!==undefined)video.cancelVideoFrameCallback(handle);};
 },[run,role]);
 const reset=async(next:Role)=>{await fetch('/__benchmark/reset');setRole(next);setRun(n=>n+1);setFrame('not measured');setLoaded('not measured');setStats({});started.current=0;};
 return <main className="container uyym-ui" style={{padding:24}}><h1>LOCAL ONLY · generated MP4 / simulated Drive</h1><p>Same 12-second video; fixed 650 ms upstream operations. No production account or private recording.</p><label>Role <select value={role} onChange={e=>void reset(e.target.value as Role)}>{['STUDENT','ADMIN','TEACHER'].map(r=><option key={r}>{r}</option>)}</select></label><button onClick={()=>void reset(role)}>New run</button><div ref={host} key={`${role}-${run}`}><ProtectedPlayer {...{role}} lang="en" lesson={{id:'00000000-0000-4000-8000-000000000000',title:'Generated test pattern',description:'',course_title:'Local fixture',starts_at:''}}/></div><p>First presented frame: <output data-testid="first-frame">{frame}</output> · loadeddata: <output>{loaded}</output></p><div><button onClick={()=>void host.current?.querySelector('video')?.play()}>Play sample</button><button onClick={()=>host.current?.querySelector('video')?.pause()}>Pause sample</button><button onClick={()=>{const v=host.current?.querySelector('video');if(v)v.currentTime=8;}}>Seek to 8s</button></div><button onClick={()=>void fetch('/__benchmark/stats').then(r=>r.json()).then(setStats)}>Read local request counts and durations</button><pre data-testid="stats">{JSON.stringify(stats,null,2)}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<Benchmark/>);
