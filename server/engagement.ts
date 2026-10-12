import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {context,lessonAllowed,proof,requireLearning,type Context} from './auth.js';
import {pool,transaction} from './db.js';
import {fail,managementMutation,operationSchema,uuid} from './management.js';

const attendanceStatus=z.enum(['present','absent','excused']);
const attendanceBody=z.object({
  ...operationSchema.shape,
  records:z.array(z.object({user_id:uuid,status:attendanceStatus}).strict()).max(1000),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.records.map(x=>x.user_id)).size!==value.records.length)ctx.addIssue({code:'custom',message:'Duplicate student'});
});
const progressBody=z.object({position_seconds:z.number().min(0).max(86400),completed:z.boolean().default(false)}).strict();

function routeId(req:FastifyRequest){return uuid.parse((req.params as any).id);}

async function staffLesson(db:PoolClient|typeof pool,ctx:Context,lessonId:string){
  const lesson=(await db.query('SELECT id,course_id,group_id,title FROM private.lessons WHERE id=$1',[lessonId])).rows[0];
  if(!lesson||!lesson.group_id)fail('NOT_FOUND',404);
  if(ctx.user.role==='ADMIN')return lesson;
  if(ctx.user.role!=='TEACHER')fail('FORBIDDEN');
  const assigned=(await db.query(`SELECT 1 FROM private.teacher_assignments
    WHERE teacher_id=$1 AND course_id=$2 AND (group_id IS NULL OR group_id=$3) LIMIT 1`,[ctx.user_id,lesson.course_id,lesson.group_id])).rowCount;
  if(!assigned)fail('NOT_FOUND',404);
  return lesson;
}

export async function registerEngagementRoutes(app:FastifyInstance){
  app.patch('/api/lessons/:id/progress',async req=>{
    const previous=await proof(req),lessonId=routeId(req),data=progressBody.parse(req.body);
    requireLearning(previous);if(previous.user.role!=='STUDENT')fail('FORBIDDEN');
    await lessonAllowed(previous,lessonId);
    return transaction(async db=>{
      await db.query('SELECT id FROM private.app_users WHERE id=$1 FOR UPDATE',[previous.user_id]);
      const fresh=await context(req,db);requireLearning(fresh);
      if(fresh.id!==previous.id||fresh.user.role!=='STUDENT')fail('FORBIDDEN');
      const lesson=(await db.query(`SELECT l.id,l.video_duration_seconds FROM private.lessons l
        JOIN private.courses c ON c.id=l.course_id LEFT JOIN private.groups g ON g.id=l.group_id
        WHERE l.id=$1 AND l.published AND c.active AND c.published
        AND (l.group_id IS NULL OR (g.active AND (g.starts_at IS NULL OR g.starts_at<=now()) AND (g.ends_at IS NULL OR g.ends_at>now())))
        AND EXISTS(SELECT 1 FROM private.enrollments e WHERE e.user_id=$2 AND e.course_id=l.course_id
          AND (l.group_id IS NULL OR e.group_id=l.group_id) AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now()
          AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM private.groups eg WHERE eg.id=e.group_id AND eg.active
            AND (eg.starts_at IS NULL OR eg.starts_at<=now()) AND (eg.ends_at IS NULL OR eg.ends_at>now()))))`,[lessonId,fresh.user_id])).rows[0];
      if(!lesson)fail('NOT_FOUND',404);
      const duration=lesson.video_duration_seconds===null?null:Number(lesson.video_duration_seconds);
      const position=duration===null?data.position_seconds:Math.min(data.position_seconds,duration);
      const before=(await db.query('SELECT completed_at FROM private.lesson_progress WHERE user_id=$1 AND lesson_id=$2 FOR UPDATE',[fresh.user_id,lessonId])).rows[0];
      const row=(await db.query(`INSERT INTO private.lesson_progress(user_id,lesson_id,position_seconds,completed_at,last_opened_at)
        VALUES($1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END,now())
        ON CONFLICT(user_id,lesson_id) DO UPDATE SET
          position_seconds=EXCLUDED.position_seconds,
          completed_at=CASE WHEN $4 THEN COALESCE(private.lesson_progress.completed_at,now()) ELSE private.lesson_progress.completed_at END,
          last_opened_at=now()
        RETURNING position_seconds,completed_at,last_opened_at,updated_at`,[fresh.user_id,lessonId,position,data.completed])).rows[0];
      if(data.completed&&!before?.completed_at)await db.query(`INSERT INTO private.audit_log(actor_id,subject_id,action,target_type,target_id,metadata)
        VALUES($1,$1,'lesson.completed','lesson',$2,'{}')`,[fresh.user_id,lessonId]);
      return {...row,position_seconds:Number(row.position_seconds)};
    });
  });

  app.get('/api/lessons/:id/attendance',async req=>{
    const ctx=await proof(req);requireLearning(ctx);const lesson=await staffLesson(pool,ctx,routeId(req));
    const rows=(await pool.query(`SELECT e.user_id,u.name AS student_name,u.phone,e.status AS enrollment_status,
      a.status,a.revision,a.recorded_at
      FROM private.enrollments e JOIN private.app_users u ON u.id=e.user_id
      LEFT JOIN private.attendance a ON a.lesson_id=$1 AND a.user_id=e.user_id
      WHERE e.group_id=$2 AND e.status IN ('pending','active','paused') AND e.expires_at>now()
      ORDER BY u.name,u.id`,[lesson.id,lesson.group_id])).rows;
    return {lesson,items:rows.map(x=>({...x,revision:x.revision===null?null:Number(x.revision)}))};
  });

  app.put('/api/lessons/:id/attendance',async req=>{
    const lessonId=routeId(req),data=attendanceBody.parse(req.body);
    return managementMutation(req,`attendance.saved.${lessonId}`,data,async(db,ctx)=>{
      const lesson=await staffLesson(db,ctx,lessonId);
      const unique=data.records.map(x=>x.user_id);
      if(unique.length){
        const enrolled=(await db.query(`SELECT user_id FROM private.enrollments WHERE group_id=$1
          AND user_id=ANY($2::uuid[]) AND status IN ('pending','active','paused') AND expires_at>now()`,[lesson.group_id,unique])).rows;
        if(enrolled.length!==unique.length)fail('INVALID_DATA',400);
      }
      for(const item of data.records)await db.query(`INSERT INTO private.attendance(lesson_id,user_id,status,recorded_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(lesson_id,user_id) DO UPDATE SET
        status=EXCLUDED.status,recorded_by=EXCLUDED.recorded_by,recorded_at=now()`,[lessonId,item.user_id,item.status,ctx.user_id]);
      await db.query(`INSERT INTO private.audit_log(actor_id,action,target_type,target_id,metadata)
        VALUES($1,'attendance.saved','lesson',$2,$3)`,[ctx.user_id,lessonId,JSON.stringify({count:data.records.length})]);
      return {id:lessonId,ok:true};
    },['ADMIN','TEACHER'],async(db,ctx)=>{await staffLesson(db,ctx,lessonId);});
  });
}
