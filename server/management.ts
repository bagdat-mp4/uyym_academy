import type {FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from './db.js';
import {context,proof,requireLearning,type Context} from './auth.js';
import {HttpError,hash} from './security.js';

export const uuid=z.string().uuid();
export const operationSchema=z.object({operation_id:uuid});
const messages:Record<string,[string,string]>={
 FORBIDDEN:['Рұқсат жоқ','Нет разрешения'], NOT_FOUND:['Жазба табылмады','Запись не найдена'],
 CONFLICT:['Жазба өзгертілді. Тізімді жаңартыңыз','Запись изменилась. Обновите список'],
 DUPLICATE:['Бұл жазба бар','Такая запись уже существует'], GROUP_FULL:['Топта бос орын жоқ','В группе нет свободных мест'],
 INVALID_DATA:['Деректерді тексеріңіз','Проверьте данные'], OPERATION_CONFLICT:['Қайталау деректері сәйкес емес','Данные повторной операции отличаются'],
 AUTH_UNAVAILABLE:['Auth қызметі қолжетімсіз. Операция күйін тексеріңіз','Сервис Auth недоступен. Проверьте состояние операции'],
 AUTH_PENDING:['Auth операциясы аяқталмаған. Әкімші тексеруі керек','Операция Auth не завершена. Требуется проверка администратора'],
 PHONE_IMMUTABLE:['Телефонды ауыстыру бөлек жеке тексеруді қажет етеді','Смена телефона требует отдельной проверки личности'],
 OWNER_PROTECTED:['Иесінің аккаунты тек қауіпсіз қалпына келтіру арқылы басқарылады','Аккаунт владельца управляется через безопасное восстановление'],
};
export function fail(code:string,status=403):never {
 const [kk,ru]=messages[code]||messages.INVALID_DATA;
 throw Object.assign(new HttpError(status,kk),{code,message_ru:ru});
}
export async function readAccess(req:FastifyRequest,roles:string[]=['ADMIN']):Promise<Context> {
 const ctx=await proof(req);requireLearning(ctx);if(!roles.includes(ctx.user.role))fail('FORBIDDEN');return ctx;
}
// Serialize the small academy's management writes. The advisory lock precedes
// user/course/group locks; proof's separate transaction has already ended.
export async function freshManagement(db:PoolClient,req:FastifyRequest,previous:Context,roles:string[]=['ADMIN']) {
 await db.query('SELECT private.management_lock()');
 await db.query('SELECT id FROM private.app_users WHERE id=$1 FOR UPDATE',[previous.user_id]);
 const fresh=await context(req,db);requireLearning(fresh);
 if(fresh.id!==previous.id||!roles.includes(fresh.user.role))fail('FORBIDDEN');return fresh;
}
export async function managementMutation<T extends Record<string,any>>(req:FastifyRequest,action:string,data:{operation_id:string;[key:string]:unknown},fn:(db:PoolClient,ctx:Context)=>Promise<T>,roles:string[]=['ADMIN'],authorize?:(db:PoolClient,ctx:Context)=>Promise<void>):Promise<T> {
 const ctx=await readAccess(req,roles);
 const requestHash=hash(JSON.stringify(data));
 try{return await transaction(async db=>{
  const fresh=await freshManagement(db,req,ctx,roles);
  if(authorize)await authorize(db,fresh);
  const previous=(await db.query('SELECT * FROM private.mutation_receipts WHERE operation_id=$1',[data.operation_id])).rows[0];
  if(previous){if(previous.actor_id!==ctx.user_id||previous.action!==action||previous.request_hash!==requestHash)fail('OPERATION_CONFLICT',409);return {...previous.response,replayed:true} as T;}
  const result=await fn(db,fresh);
  // Allowlist scalar receipts. Full DTOs, personal fields and secrets never enter this ledger.
  const safe:Record<string,any>={};for(const k of ['id','user_id','group_id','course_id','enrollment_id','payment_id','assignment_id','operation_id','revision','ok','created','completed','status'])if(result[k]!==undefined&&['string','boolean','number'].includes(typeof result[k]))safe[k]=result[k];
  if(safe.revision!==undefined)safe.revision=Number(safe.revision);
  await db.query('INSERT INTO private.mutation_receipts(operation_id,actor_id,action,request_hash,response) VALUES($1,$2,$3,$4,$5)',[data.operation_id,ctx.user_id,action,requestHash,JSON.stringify(safe)]);
  return result;
 });}catch(e:any){if(e?.code==='23505')fail('DUPLICATE',409);if(e?.constraint==='group_capacity_limit'||e?.message?.includes('GROUP_FULL'))fail('GROUP_FULL',409);if(['23503','23514','22007','22008'].includes(e?.code))fail('INVALID_DATA',400);throw e;}
}
export function pageParams(req:FastifyRequest){return z.object({page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(100).default(20),q:z.string().max(120).default('')}).parse(req.query);}
export async function pageList(req:FastifyRequest,db:any,fromSql:string,selectSql:string,whereSql:string,params:unknown[],order='id') {
 const p=pageParams(req),where=whereSql?`WHERE ${whereSql}`:'';
 const total=Number((await db.query(`SELECT count(*) AS total FROM ${fromSql} ${where}`,params)).rows[0].total);
 const result=await db.query(`SELECT ${selectSql} FROM ${fromSql} ${where} ORDER BY ${order} LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,p.page_size,(p.page-1)*p.page_size]);
 return {items:result.rows,total,page:p.page,page_size:p.page_size};
}
