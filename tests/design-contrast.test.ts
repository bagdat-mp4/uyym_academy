import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// WCAG relative luminance; assert the design requirement rather than a hex value.
function luminance(hex:string){
 const raw=hex.replace('#',''),expanded=raw.length===3?raw.split('').map(c=>c+c).join(''):raw;
 const rgb=expanded.match(/../g)!.map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('light and dark design tokens meet text and input-boundary contrast requirements',async()=>{
 const css=await readFile(new URL('../client/src/design-system.css',import.meta.url),'utf8');
 const blocks=[css.match(/:root\s*\{([^}]+)\}/)![1],css.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]];
 for(const block of blocks){
  const tokens=Object.fromEntries([...block.matchAll(/--ui-([\w-]+):\s*(#[a-f0-9]{3,6})/gi)].map(m=>[m[1],m[2]]));
  for(const surface of ['bg','panel'])for(const text of ['ink','muted'])assert.ok(contrast(tokens[text],tokens[surface])>=4.5,`${text} on ${surface} must meet 4.5:1`);
  assert.ok(contrast(tokens.control,tokens.panel)>=3,'Input boundaries must meet 3:1');
 }
 assert.ok(contrast('#142c50','#ffcd2b')>=4.5,'Enrollment button text must meet 4.5:1');
});

test('workspace typography, muted metadata and form boundaries meet contrast in both themes',async()=>{
 const css=await readFile(new URL('../client/src/workspace.css',import.meta.url),'utf8');
 const blocks=[css.match(/:root\s*\{([^}]+)\}/)![1],css.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]];
 for(const block of blocks){
  const tokens=Object.fromEntries([...block.matchAll(/--ws-([\w-]+):\s*(#[a-f0-9]{3,6})/gi)].map(match=>[match[1],match[2]]));
  for(const surface of ['bg','panel','soft'])for(const text of ['ink','muted'])assert.ok(contrast(tokens[text],tokens[surface])>=4.5,`${text} on ${surface}`);
  assert.ok(contrast(tokens.input,tokens.panel)>=3,'Form boundary');
 }
 assert.ok(contrast('#dceaff','#142746')>=4.5,'Player overlay needs its own light text even in light theme');
});

test('course hero text, actions and focus meet contrast in both themes',async()=>{
 const css=await readFile(new URL('../client/src/course-hero.css',import.meta.url),'utf8');
 const blocks=[css.match(/\.course-hero\s*\{([^}]+)\}/)![1],css.match(/html\[data-theme="dark"\][^{]+\{([^}]+)\}/)![1]];
 let tokens:Record<string,string>={};
 for(const block of blocks){
  tokens={...tokens,...Object.fromEntries([...block.matchAll(/--hero-([\w-]+):\s*(#[a-f0-9]{6})/gi)].map(m=>[m[1],m[2]]))};
  assert.ok(contrast(tokens.ink,tokens.surface)>=4.5,'Hero text');
  assert.ok(contrast(tokens['action-ink'],tokens.action)>=4.5,'Yellow action text');
  assert.ok(contrast(tokens.focus,tokens.surface)>=3,'Visible focus ring');
 }
});

test('neo semantic surfaces, states, selection and controls meet AA in light and dark',async()=>{
 const css=await readFile(new URL('../client/src/neo-system.css',import.meta.url),'utf8');
 const blocks=[css.match(/:root\s*\{([^}]+)\}/)![1],css.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]];
 let tokens:Record<string,string>={};
 for(const block of blocks){
  tokens={...tokens,...Object.fromEntries([...block.matchAll(/--neo-([\w-]+):\s*(#[a-f0-9]{6})/gi)].map(m=>[m[1],m[2]]))};
  for(const surface of ['bg','panel','soft'])for(const ink of ['ink','muted','success','warning','error'])assert.ok(contrast(tokens[ink],tokens[surface])>=4.5,`${ink} on ${surface}`);
  assert.ok(contrast(tokens.border,tokens.panel)>=3);assert.ok(contrast(tokens.focus,tokens.panel)>=3);
  assert.ok(contrast(tokens['selected-ink'],tokens.selected)>=4.5);
 }
 assert.ok(contrast('#171e19','#b7c6c2')>=4.5);
 assert.ok(!/linear-gradient|radial-gradient|backdrop-filter:\s*blur/.test(css));
});
