import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,createRef} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import VideoControls from '../client/src/VideoControls';
import {clampSeek,finiteDuration,formatMediaDuration,formatMediaTime,playbackRates,playerShortcut,seekOffset} from '../client/src/player-controls-model';

test('player timeline accepts unbuffered positions but clamps to a finite recording duration',()=>{
 assert.equal(clampSeek(520,600),520);assert.equal(clampSeek(-20,600),0);assert.equal(clampSeek(900,600),600);
 for(const invalid of [NaN,Infinity,-1,0]){assert.equal(finiteDuration(invalid),0);assert.equal(clampSeek(20,invalid),0);}
 assert.equal(clampSeek(NaN,600),0);
});
test('video time formatting handles invalid, subhour and long recordings',()=>{
 assert.equal(formatMediaTime(NaN),'0:00');assert.equal(formatMediaTime(-2),'0:00');assert.equal(formatMediaTime(65.8),'1:05');assert.equal(formatMediaTime(3671),'1:01:11');
 assert.equal(formatMediaDuration(11.999999),'0:12');assert.equal(formatMediaDuration(12),'0:12');assert.equal(formatMediaDuration(65.8),'1:06');assert.equal(formatMediaDuration(Infinity),'0:00');
 // Presentation rounding never changes the actual finite seek boundary.
 assert.equal(clampSeek(12,11.999999),11.999999);
});
test('only documented player keys map to media actions',()=>{
 for(const key of [' ','k','K'])assert.equal(playerShortcut(key),'play');
 assert.equal(playerShortcut('ArrowLeft'),'back');assert.equal(playerShortcut('j'),'back');assert.equal(playerShortcut('ArrowRight'),'forward');
 assert.equal(playerShortcut('m'),'mute');assert.equal(playerShortcut('f'),'fullscreen');assert.equal(playerShortcut('c'),'captions');assert.equal(playerShortcut('Escape'),'escape');
 assert.equal(playerShortcut('Enter'),null);assert.equal(playerShortcut('Tab'),null);
 assert.deepEqual(playbackRates,[.5,.75,1,1.25,1.5,1.75,2]);
 assert.equal(seekOffset('j'),-10);assert.equal(seekOffset('L'),10);assert.equal(seekOffset('ArrowLeft'),-5);assert.equal(seekOffset('ArrowRight'),5);assert.equal(seekOffset('k'),null);
});
test('controls render semantic disabled native ranges and no invented captions or network source',()=>{
 const props={videoRef:createRef<HTMLVideoElement>(),lang:'ru' as const,enabled:true,onFullscreen(){throw Error('SSR must not request fullscreen');},fullscreen:false};
 assert.equal(renderToStaticMarkup(createElement(VideoControls,{...props,enabled:false})), '');
 const html=renderToStaticMarkup(createElement(VideoControls,props));
 assert.equal((html.match(/type="range"/g)||[]).length,2);assert.ok(html.includes('aria-label="Позиция видео"')&&html.includes('aria-valuetext="0:00 / 0:00"'));
 assert.ok(html.includes('aria-label="Громкость"'));assert.ok(!html.includes('aria-label="Субтитры"'));assert.ok(!html.includes('<video')&&!html.includes('<iframe')&&!html.includes('src='));
 assert.ok(html.includes('aria-label="Воспроизвести"')&&html.includes('disabled=""'));assert.ok(html.includes('uyym-center-play'));
});
