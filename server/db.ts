import pg from 'pg';
import { config } from './config.js';
export const pool = new pg.Pool({connectionString:config.database || undefined, max:10, statement_timeout:10000});
export async function transaction<T>(fn:(db:pg.PoolClient)=>Promise<T>):Promise<T> {
 const db = await pool.connect();
 try {await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result;}
 catch (e) {await db.query('ROLLBACK'); throw e;} finally {db.release();}
}
export async function audit(db:pg.Pool | pg.PoolClient, actor:string|null, action:string, entity:string, entityId:string|null, details:Record<string,unknown>={}) {
 await db.query('INSERT INTO private.audit_log(actor_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5)', [actor,action,entity,entityId,JSON.stringify(details)]);
}
