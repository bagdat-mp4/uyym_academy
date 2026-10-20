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
const declarations=(block:string)=>Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[a-f0-9]{3,6}|var\(--[\w-]+\))/gi)].map(m=>[m[1],m[2]]));
function color(tokens:Record<string,string>,name:string):string{
 const value=tokens[name];assert.ok(value,`Missing color token ${name}`);
 return value.startsWith('var(')?color(tokens,value.slice(4,-1)):value;
}
test('light and dark design tokens meet text and input-boundary contrast requirements',async()=>{
 const css=await readFile(new URL('../client/src/design-system.css',import.meta.url),'utf8');
 const blocks=[css.match(/:root\s*\{([^}]+)\}/)![1],css.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]];
 for(const block of blocks){
  const tokens=Object.fromEntries([...block.matchAll(/--ui-([\w-]+):\s*(#[a-f0-9]{3,6})/gi)].map(m=>[m[1],m[2]]));
  for(const surface of ['bg','panel'])for(const text of ['ink','muted'])assert.ok(contrast(tokens[text],tokens[surface])>=4.5,`${text} on ${surface} must meet 4.5:1`);
  assert.ok(contrast(tokens.control,tokens.panel)>=3,'Input boundaries must meet 3:1');
 }
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
 const shared=await readFile(new URL('../client/src/neo-system.css',import.meta.url),'utf8');
 const light=declarations(shared.match(/:root\s*\{([^}]+)\}/)![1]),dark=declarations(shared.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]);
 for(const theme of [light,{...light,...dark}]){
  const tokens={...theme,...declarations(css.match(/\.course-hero\s*\{([^}]+)\}/)![1])};
  assert.ok(contrast(color(tokens,'--hero-ink'),color(tokens,'--hero-surface'))>=4.5,'Hero text');
  assert.ok(contrast(color(tokens,'--hero-action-ink'),color(tokens,'--hero-action'))>=4.5,'Hero action text');
  assert.ok(contrast(color(tokens,'--hero-focus'),color(tokens,'--hero-surface'))>=3,'Visible focus ring');
 }
});

test('neo semantic surfaces, states, selection and controls meet AA in light and dark',async()=>{
 const css=await readFile(new URL('../client/src/neo-system.css',import.meta.url),'utf8');
 const blocks=[css.match(/:root\s*\{([^}]+)\}/)![1],css.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]];
 let tokens:Record<string,string>={};
 for(const block of blocks){
  tokens={...tokens,...declarations(block)};
  const get=(name:string)=>color(tokens,'--neo-'+name);
  for(const surface of ['bg','panel','soft'])for(const ink of ['ink','muted','success','warning','error'])assert.ok(contrast(get(ink),get(surface))>=4.5,`${ink} on ${surface}`);
  assert.ok(contrast(get('border'),get('panel'))>=3);assert.ok(contrast(get('focus'),get('panel'))>=3);
  assert.ok(contrast(get('selected-ink'),get('selected'))>=4.5);
  for(const fill of ['brand','brand-hover','deep'])assert.ok(contrast(get('on-brand'),get(fill))>=4.5,`Primary action on ${fill}`);
  assert.ok(contrast(get('on-tint'),get('tint'))>=4.5,'Highlighted panels');
  assert.ok(contrast(get('on-feature'),get('feature'))>=4.5,'Hero and contact sections');
  assert.ok(contrast(get('link'),get('panel'))>=4.5,'Secondary actions');
  assert.equal(get('brand'),'#203f85','Brand fill remains UYYM blue in both themes');
 }
 assert.ok(!/linear-gradient|radial-gradient|backdrop-filter:\s*blur/.test(css));
});
