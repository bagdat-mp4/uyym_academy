// Generated, non-private test pattern. Never uses the owner's recordings.
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve('work/player-benchmark/video');
await mkdir(dir,{recursive:true});
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','12','-c:v','libx264','-preset','fast','-g','60','-keyint_min','60','-sc_threshold','0','-pix_fmt','yuv420p','-an','-f','dash','-seg_duration','2','-init_seg_name','init.mp4','-media_seg_name','part-$Number$.m4s','manifest.mpd'],{cwd:dir,stdio:'pipe'});
const xml=await readFile(resolve(dir,'manifest.mpd'),'utf8');
const codec=/codecs="([^"]+)"/.exec(xml)?.[1];if(!codec)throw new Error('Missing generated codec');
const files=['init.mp4',...(await readdir(dir)).filter(x=>/^part-\d+\.m4s$/.test(x)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0]))];
const parts=await Promise.all(files.map(async(file,i)=>({index:i-1,file,bytes:(await stat(resolve(dir,file))).size,start:i?2*(i-1):0,duration:i?2:0})));
if(parts.some(p=>p.bytes>1048576))throw new Error('Generated part exceeds bound');
await writeFile(resolve(dir,'parts.json'),JSON.stringify({mime:`video/mp4; codecs="${codec}"`,duration_seconds:12,parts}));
// Preserve the inspected pre-change implementation for repeatable comparisons.
// Run only local code from this repository, with fixture-only provider settings.
const baseline=execFileSync('git',['show','761efc6:server/drive.ts'],{encoding:'utf8'}).replace("'./config.js'","'../../server/config.js'").replace("'./security.js'","'../../server/security.js'");
await writeFile(resolve(dir,'../baseline-drive.ts'),baseline);
console.info('Generated 12-second local test video; no private media used.');
