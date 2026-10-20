/** Presentation helpers only. Seeking still goes through the protected MSE engine. */
export function finiteDuration(value:number):number {
 return Number.isFinite(value)&&value>0?value:0;
}

export function clampSeek(value:number,duration:number):number {
 const end=finiteDuration(duration);
 return end&&Number.isFinite(value)?Math.min(end,Math.max(0,value)):0;
}

export function formatMediaTime(value:number):string {
 const seconds=Math.floor(Number.isFinite(value)?Math.max(0,value):0);
 const h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=seconds%60;
 return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}

/** MSE can report 11.999999 for a nominal twelve-second recording. */
export function formatMediaDuration(value:number):string {
 return formatMediaTime(Math.ceil(finiteDuration(value)));
}

export type PlayerShortcut='play'|'back'|'forward'|'volume-up'|'volume-down'|'mute'|'fullscreen'|'captions'|'escape';
export function playerShortcut(key:string):PlayerShortcut|null {
 switch(key.toLowerCase()){
  case ' ':case 'k':return 'play';
  case 'j':case 'arrowleft':return 'back';
  case 'l':case 'arrowright':return 'forward';
  case 'arrowup':return 'volume-up';
  case 'arrowdown':return 'volume-down';
  case 'm':return 'mute';
  case 'f':return 'fullscreen';
  case 'c':return 'captions';
  case 'escape':return 'escape';
  default:return null;
 }
}

export const playbackRates=[.5,.75,1,1.25,1.5,1.75,2] as const;

export function seekOffset(key:string):number|null {
 switch(key.toLowerCase()){
  case 'j':return -10;
  case 'l':return 10;
  case 'arrowleft':return -5;
  case 'arrowright':return 5;
  default:return null;
 }
}
