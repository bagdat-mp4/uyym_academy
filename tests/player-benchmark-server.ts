// LOCAL ONLY: actual player + Drive validation/streaming, simulated upstream.
// No production database/Auth/Drive connections or credentials are used.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {GoogleAuth} from 'google-auth-library';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {AsyncLocalStorage} from 'node:async_hooks';
import {PlayerTiming} from '../server/player-timing.js';
if(process.env.NODE_ENV==='production')throw new Error('Local benchmark only');
Object.assign(process.env,{NODE_ENV:'test',DOTENV_CONFIG_PATH:resolve('work/nonexistent-benchmark.env'),GOOGLE_APPLICATION_CREDENTIALS_BASE64:'',DRIVE_ALLOWED_FOLDER_IDS:'TEST_FOLDER_ONLY',DRIVE_ALLOWED_PERMISSION_EMAILS:'fixture@example.invalid'});
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const baseline=process.argv.includes('--baseline'),activeTiming=new AsyncLocalStorage<PlayerTiming>();
(GoogleAuth.prototype as any).getClient=async()=>({getRequestHeaders:async()=>{const measure=baseline?activeTiming.getStore():undefined;await(measure?measure.measure('drive_token',()=>delay(20)):delay(20));return new Headers({authorization:'Bearer LOCAL_FAKE_ONLY'});}});
const folder='TEST_FOLDER_ONLY',videoDir=resolve('work/player-benchmark/video');
const manifest=JSON.parse(await readFile(resolve(videoDir,'parts.json'),'utf8')) as {mime:string;duration_seconds:number;parts:{index:number;file:string;bytes:number;start:number;duration:number}[]};
const files=new Map<string,{index:number;file:string;bytes:number;start:number;duration:number;body:Buffer}>(await Promise.all(manifest.parts.map(async p=>[`TEST_PART_${p.index+1}`,{...p,body:await readFile(resolve(videoDir,p.file))}] as const)));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const u=new URL(String(input));if(u.origin!=='https://www.googleapis.com')throw new Error('External network forbidden in benchmark');
 const phase=u.searchParams.get('alt')==='media'?'drive_headers':u.pathname.endsWith('/permissions')?'drive_permissions':'drive_metadata';
 const measure=baseline?activeTiming.getStore():undefined;
 await(measure?measure.measure(phase,()=>delay(650)):delay(650));
 const id=u.pathname.split('/')[4],file=files.get(id);
 if(u.pathname.endsWith('/permissions'))return Response.json({permissions:[{type:'user',emailAddress:'fixture@example.invalid'}]});
 if(u.searchParams.get('alt')==='media'){
  if(!file||new Headers(init?.headers).get('Range')!==`bytes=0-${file.bytes-1}`)return new Response(null,{status:400});
  return new Response(new ReadableStream({async start(controller){await(measure?measure.measure('drive_body',()=>delay(80)):delay(80));controller.enqueue(file.body);controller.close();}}),{status:206,headers:{'content-range':`bytes 0-${file.bytes-1}/${file.bytes}`}});
 }
 if(id===folder)return Response.json({id,mimeType:'application/vnd.google-apps.folder',trashed:false});
 if(file)return Response.json({id,mimeType:'video/mp4',size:String(file.bytes),parents:[folder],trashed:false});
 return new Response(null,{status:404});
};
const drive=(baseline?await import(new URL('../work/player-benchmark/baseline-drive.ts',import.meta.url).href):await import('../server/drive.js')) as typeof import('../server/drive.js');
const lesson='00000000-0000-4000-8000-000000000000',grant='00000000-0000-4000-8000-000000000001';
let patches=0,scenario='normal';const requests:{name:string;ms:number;phases?:Record<string,number>}[]=[];
const server=await createServer({configFile:false,root:resolve('client'),plugins:[react(),tailwind(),{
 name:'local-measured-player',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url||'/','http://localhost');
  if(url.pathname==='/__benchmark'){
   const html=await vite.transformIndexHtml('/__benchmark',`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${resolve('tests/player-benchmark.tsx').replace(/\\/g,'/')}"></script></body></html>`);
   res.setHeader('content-type','text/html');return res.end(html);
  }
  if(url.pathname==='/__benchmark/stats'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({patches,requests}));}
  if(url.pathname==='/__benchmark/reset'){patches=0;requests.length=0;return res.end('{}');}
  if(url.pathname==='/__benchmark/scenario'){
   const chosen=url.searchParams.get('mode')||'normal';
   if(!['normal','slow','network-error','access-denied','session-expired','unavailable','grant-expired'].includes(chosen)){res.statusCode=400;return res.end('{}');}
   scenario=chosen;return res.end('{}');
  }
  if(!url.pathname.startsWith('/api/'))return next();
  const start=performance.now();let name='';const timing=new PlayerTiming();res.setHeader('cache-control','private, no-store');res.setHeader('content-type','application/json');
  res.once('finish',()=>{if(name)requests.push({name,ms:Math.round(performance.now()-start),phases:timing.snapshot()});});
  try{
   if(url.pathname==='/api/proof/challenge'){await delay(10);return res.end(JSON.stringify({id:crypto.randomUUID(),payload:'LOCAL_BENCHMARK_ONLY'}));}
   if(url.pathname===`/api/lessons/${lesson}/playback`){
    name='playback';await delay(scenario==='slow'?4000:80);
    const status=scenario==='access-denied'?403:scenario==='session-expired'?401:scenario==='unavailable'?404:200;
    if(status!==200){res.statusCode=status;return res.end('{"error":"Local test failure"}');}
    return res.end(JSON.stringify({...manifest,grant_id:grant,watermark:'LOCAL TEST PATTERN'}));
   }
   if(url.pathname===`/api/playback/${grant}/heartbeat`){await delay(20);if(scenario==='grant-expired'){res.statusCode=403;return res.end('{"error":"Local expired grant","code":"MEDIA_GRANT_EXPIRED"}');}return res.end('{"ok":true}');}
   if(url.pathname===`/api/media/${lesson}`){
    if(scenario==='network-error'){res.statusCode=503;return res.end('{"error":"Local media test failure"}');}
    const part=Number(url.searchParams.get('part')),file=files.get(`TEST_PART_${part+1}`);if(!file)throw new Error('Unknown test part');name=`media ${part}`;
    const stream=await activeTiming.run(timing,async()=>{await timing.measure('drive_validate',()=>drive.validateDriveFile(`TEST_PART_${part+1}`,folder,'part',file.bytes,timing));return drive.streamPart(`TEST_PART_${part+1}`,file.bytes,timing);});res.setHeader('server-timing',timing.header());res.setHeader('content-type','video/mp4');res.setHeader('content-length',file.bytes);stream.pipe(res);return;
   }
   if(url.pathname.endsWith('/progress')&&req.method==='PATCH'){
    patches++;let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body||'{}');return res.end(JSON.stringify({position_seconds:input.position_seconds??0,completed_at:input.completed?'2026-10-15T00:00:00Z':null}));
   }
   res.statusCode=404;res.end('{}');
  }catch{res.statusCode=503;res.end('{"error":"Local fixture failed"}');}
 });}
}],server:{host:'127.0.0.1',port:5175,strictPort:true,fs:{allow:[resolve('.')]}}});
await server.listen();console.info(`LOCAL ONLY benchmark: http://localhost:5175/__benchmark (${baseline?'baseline':'optimized'}; simulated Drive, 650 ms per operation)`);
process.on('SIGINT',async()=>{globalThis.fetch=originalFetch;await server.close();process.exit(0);});
