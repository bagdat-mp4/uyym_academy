import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {savedTheme} from '../client/src/i18n';
import {resolveTheme,applyTheme} from '../client/src/theme';
import ThemeControl from '../client/src/ThemeControl';

test('theme preference preserves explicit modes and resolves system without overwriting it',()=>{
 for(const choice of ['light','dark','system'] as const){assert.equal(savedTheme({getItem:()=>choice}),choice);for(const dark of [false,true])assert.equal(resolveTheme(choice,dark),choice==='system'?(dark?'dark':'light'):choice);}
 assert.equal(savedTheme({getItem:()=>null}),'light');assert.equal(savedTheme({getItem:()=>{throw Error();}}),'light');
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const dataset:Record<string,string>={};let color='';
 try{
  Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset},querySelector:()=>({setAttribute(_key:string,value:string){color=value;}})}});
  applyTheme('system',true);assert.equal(dataset.theme,'dark');assert.equal(dataset.themePreference,'system');assert.equal(color,'#171e19');
  applyTheme('system',false);assert.equal(dataset.theme,'light');assert.equal(dataset.themePreference,'system');
 }finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');}
});
test('all locales have a labelled keyboard-native three-mode theme selector',()=>{
 for(const lang of ['en','kk','ru'] as const){const html=renderToStaticMarkup(createElement(ThemeControl,{lang,value:'system',onChange(){}}));assert.ok(html.includes('<label')&&html.includes('<select'));assert.equal((html.match(/<option /g)||[]).length,3);assert.ok(html.includes('value="system" selected=""'));}
});
