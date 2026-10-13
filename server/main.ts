import {app} from './index.js';
import {config,ready} from './config.js';
import {pool} from './db.js';
await app.listen({port:config.port,host:config.production?'0.0.0.0':'127.0.0.1'});
console.info(`UYYM backend listening on port ${config.port}; services ${ready()?'configured':'NOT configured'}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{await app.close();await pool.end();process.exit(0);});
