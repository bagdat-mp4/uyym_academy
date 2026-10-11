import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {assertPartSize} from '../server/security.js';
const input=process.argv[2],output=resolve(process.argv[3]||'work/prepared-video');
if(!input)throw new Error('Usage: npm run prepare-video -- "absolute input MP4" "output directory" (requires FFmpeg on PATH)');
mkdirSync(output,{recursive:true});
const result=spawnSync('ffmpeg',['-n','-i',resolve(input),'-map','0:v:0','-map','0:a:0','-vf','scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2','-r','30','-c:v','libx264','-profile:v','baseline','-level:v','3.1','-pix_fmt','yuv420p','-b:v','1000k','-maxrate','1400k','-bufsize','2800k','-g','120','-keyint_min','120','-sc_threshold','0','-force_key_frames','expr:gte(t,n_forced*4)','-c:a','aac','-b:a','96k','-ac','2','-ar','48000','-f','hls','-hls_time','4','-hls_playlist_type','vod','-hls_segment_type','fmp4','-hls_fmp4_init_filename','init.mp4','-hls_segment_filename',join(output,'part%05d.m4s'),join(output,'playlist.m3u8')],{stdio:'inherit',shell:false});
if(result.status!==0)throw new Error('FFmpeg failed. Use empty output directory, MP4 with video + audio, and verify FFmpeg installation.');
const init=readFileSync(join(output,'init.mp4'));assertPartSize(init.byteLength);
const at=init.indexOf(Buffer.from('avcC'));if(at<0)throw new Error('Missing AVC decoder configuration');
const codec=`avc1.${init.subarray(at+5,at+8).toString('hex')},mp4a.40.2`;
const lines=readFileSync(join(output,'playlist.m3u8'),'utf8').split(/\r?\n/);let start=0,duration=0,index=0;
const parts:any[]=[{index:-1,file:'init.mp4',bytes:init.byteLength,start:0,duration:0}];
for(const line of lines){if(line.startsWith('#EXTINF:'))duration=Number(line.slice(8).split(',')[0]);else if(line&&!line.startsWith('#')){if(!/^part\d{5}\.m4s$/.test(line)||!Number.isFinite(duration)||duration<=0||duration>4.2)throw new Error('Invalid fragment timeline');const bytes=statSync(join(output,line)).size;assertPartSize(bytes);parts.push({index:index++,file:line,bytes,start,duration});start+=duration;}}
writeFileSync(join(output,'manifest.json'),JSON.stringify({version:1,codec,duration_seconds:start,parts},null,2));
console.info(`Prepared ${index} bounded fMP4 parts. Upload init + parts into the SAME Restricted folder as source. Keep their generated filenames: ADMIN UI and register-video can resolve all IDs from the private folder in one batch. Do not share manifest with learners.`);
