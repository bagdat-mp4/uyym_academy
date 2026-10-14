import {defineConfig,mergeConfig} from 'vite';
import config from '../vite.config';
import {fileURLToPath} from 'node:url';
export default mergeConfig(config,defineConfig({server:{port:5174,strictPort:true,proxy:{'/api':'http://127.0.0.1:18878'}},plugins:[{
 name:'local-player-preview',configureServer(server){
  server.middlewares.use('/__ui/player',async(_req,res)=>{
   const source=fileURLToPath(new URL('./player-preview.tsx',import.meta.url)).replace(/\\/g,'/');
   const html=await server.transformIndexHtml('/__ui/player',`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${source}"></script></body></html>`);
   res.setHeader('Content-Type','text/html');res.end(html);
  });
 }
}]}));
