import type {User} from './api';

type Event='playback'|'media_init'|'media_0'|'first_frame'|'first_frame_ready';
export function playerDiagnosticsEnabled(){try{return sessionStorage.getItem('uyym-player-timing')==='1';}catch{return false;}}
// Deliberately accepts no lesson/grant/user/URL/error fields.
export function observePlayer(enabled:boolean,start:number,report=(event:Event,ms:number)=>console.info('[uyym-player]',JSON.stringify({event,ms:Math.round(ms)}))){
 return {
  mark(event:Event){if(enabled)report(event,performance.now()-start);},
  async measure<T>(event:Event,operation:()=>Promise<T>){const at=performance.now();const value=await operation();if(enabled)report(event,performance.now()-at);return value;}
 };
}

// Previews for staff never register progress listeners or timers.
export function watchStudentProgress(role:User['role'],element:Pick<HTMLVideoElement,'paused'|'addEventListener'|'removeEventListener'>,save:()=>void){
 if(role!=='STUDENT')return ()=>{};
 const pause=()=>save(),timer=setInterval(()=>{if(!element.paused)save();},15000);
 element.addEventListener('pause',pause);
 return()=>{clearInterval(timer);element.removeEventListener('pause',pause);};
}
