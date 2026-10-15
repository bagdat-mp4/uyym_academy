import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';

test('public entry never eagerly downloads role workspaces or private player code',async()=>{
 const result=await build({configFile:'vite.config.ts',logLevel:'silent',build:{write:false,minify:false,emptyOutDir:false}});
 assert.ok(!Array.isArray(result)&&'output' in result);
 const chunks=result.output.filter(chunk=>chunk.type==='chunk'),entry=chunks.find(chunk=>chunk.isEntry);assert.ok(entry);
 const eager=new Set<string>();
 function visit(file:string){if(eager.has(file))return;eager.add(file);for(const dependency of chunks.find(x=>x.fileName===file)?.imports??[])visit(dependency);}
 visit(entry.fileName);
 const modules=chunks.filter(chunk=>eager.has(chunk.fileName)).flatMap(chunk=>Object.keys(chunk.modules));
 for(const name of ['AdminPanel','TeacherPanel','LearningHub','ProtectedPlayer','AdminInvitation'])assert.ok(!modules.some(id=>id.replaceAll('\\','/').endsWith(`/src/${name}.tsx`)),`${name} leaked into public startup`);
 assert.ok(chunks.some(chunk=>chunk.dynamicImports.length>0));
 assert.ok(chunks.some(chunk=>Object.keys(chunk.modules).some(id=>id.endsWith('/AdminPanel.tsx'))),'staff functionality remains in a reachable deferred chunk');
});
