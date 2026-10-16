export type Course={id:string;title:string;description:string;group_id?:string;expires_at?:string};
export type Group={id:string;title:string;schedule_description?:string;starts_at?:string|null;ends_at?:string|null};
export type FileItem={id:string;name:string;mime:string;size:number;slot?:number};
export type SubmissionSummary={id?:string;status:'not_submitted'|'submitted'|'reviewed'|'needs_revision';current_version:number;grade:number|null;feedback:string;reviewed_at?:string|null;late_allowed_until?:string|null;revision:number|null;answer:string;is_late?:boolean;submitted_at?:string|null;files:FileItem[]};
export type ContentItem={id:string;course_id:string;group_id?:string|null;title:string;published:boolean;revision:number;description?:string;body?:string;instructions?:string;due_at?:string|null;max_grade?:number;lesson_id?:string|null;category?:'Quiz'|'Midterm'|'Endterm'|'Final';exam_year?:number;semester?:string;topic?:string;starts_at?:string|null;position?:number;video_ready?:boolean;video_duration_seconds?:number|null;progress_seconds?:number;completed_at?:string|null;last_opened_at?:string|null;files?:FileItem[];submission?:SubmissionSummary};
export type Content={course:Course;groups:Group[];lessons:ContentItem[];assignments:ContentItem[];archive:ContentItem[];announcements:ContentItem[]};
export type StudentView='overview'|'courses'|'assignments'|'schedule'|'announcements'|'archive';
export function summarizeLearning(contents:Content[],now=Date.now()){
 const lessons=contents.flatMap(content=>content.lessons),assignments=contents.flatMap(content=>content.assignments);
 const resume=lessons.filter(item=>item.video_ready&&item.published&&!item.completed_at&&Number(item.progress_seconds)>0&&item.last_opened_at).sort((a,b)=>Date.parse(b.last_opened_at!)-Date.parse(a.last_opened_at!))[0];
 const upcoming=lessons.filter(item=>item.starts_at&&Date.parse(item.starts_at)>now).sort((a,b)=>Date.parse(a.starts_at!)-Date.parse(b.starts_at!));
 const due=assignments.filter(item=>!item.submission||['not_submitted','needs_revision'].includes(item.submission.status)).sort((a,b)=>(a.due_at?Date.parse(a.due_at):Infinity)-(b.due_at?Date.parse(b.due_at):Infinity));
 return {resume,upcoming,due,completed:lessons.filter(item=>item.completed_at).length,total:lessons.length};
}
