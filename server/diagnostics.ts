import type {FastifyInstance} from 'fastify';
import {readAccess} from './management.js';
import {getAuthUser} from './supabase.js';

// Temporary owner diagnostic. Remove after the owner confirms production success.
export function registerDiagnosticRoutes(app:FastifyInstance) {
 app.get('/api/admin/diagnostics/auth',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
  const ctx=await readAccess(req);
  try {
   const user=await getAuthUser(ctx.user_id);
   if(user.id!==ctx.user_id)throw new Error('Unexpected Auth identity');
   return {ok:true};
  } catch {
   // Never forward provider errors, account data, URLs or credentials.
   return reply.code(503).send({error:'Проверка Auth не выполнена. Повторите позже.'});
  }
 });
}
