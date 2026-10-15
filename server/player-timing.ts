import {performance} from 'node:perf_hooks';

export type PlayerPhase='access'|'drive_token'|'drive_metadata'|'drive_permissions'|'drive_validate'|'drive_headers'|'drive_body'|'prepare';
// Only fixed names and numeric durations: never URLs, IDs, tokens or errors.
export class PlayerTiming {
 private values:Partial<Record<PlayerPhase,number>>={};
 constructor(private clock=()=>performance.now()){}
 async measure<T>(phase:PlayerPhase,operation:()=>Promise<T>):Promise<T>{
  const start=this.clock();try{return await operation();}finally{this.add(phase,this.clock()-start);}
 }
 add(phase:PlayerPhase,ms:number){if(Number.isFinite(ms)&&ms>=0)this.values[phase]=(this.values[phase]??0)+ms;}
 snapshot(){return Object.fromEntries(Object.entries(this.values).map(([name,value])=>[name,Math.round(value!*10)/10]));}
 header(){return Object.entries(this.snapshot()).map(([name,ms])=>`${name};dur=${ms}`).join(', ');}
}
