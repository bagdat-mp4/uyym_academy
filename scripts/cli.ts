import {createInterface} from 'node:readline/promises';
export async function ask(label:string) {const rl=createInterface({input:process.stdin,output:process.stdout});try{return (await rl.question(label)).trim();}finally{rl.close();}}
export async function hidden(label:string) {
 if(!process.stdin.isTTY)throw new Error('Sensitive input requires an interactive local terminal');
 process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise<string>((resolve,reject)=>{let value='';const done=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',handler);process.stdout.write('\n');};const handler=(bytes:Buffer)=>{for(const ch of bytes.toString()){if(ch==='\u0003'){done();reject(new Error('Cancelled'));return;}if(ch==='\r'||ch==='\n'){done();resolve(value);return;}if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else value+=ch;}};process.stdin.on('data',handler);});
}
