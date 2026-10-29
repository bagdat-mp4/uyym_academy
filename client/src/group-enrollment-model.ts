import {localDate,utcDate} from './management';

export const GROUP_BATCH_LIMIT=100;
export type GroupContext={id:string;course_id:string;title:string;course_title:string;active:boolean;can_add_students?:boolean;capacity:number;reserved_seats:number;starts_at:string|null;ends_at:string|null;revision:number};
export type GroupCandidate={id:string;user_id:string;name:string;phone:string;active:boolean;enrollment_id:string|null;enrollment_revision:number|null;group_id:string|null;group_title:string|null;status:string|null;effective_status?:string;starts_at?:string;expires_at?:string;eligibility:'new'|'ungrouped'|'member'|'other_group'|'inactive'|'access_review';selectable:boolean;[key:string]:unknown};
export type GroupCandidatePage={group:GroupContext;items:GroupCandidate[];total:number;page:number;page_size:number};
export type SelectedStudents=Record<string,GroupCandidate>;
export type AccessDates={starts_at:string;expires_at:string};
export type GroupEnrollmentRequest={operation_id:string;students:{user_id:string;enrollment_revision:number|null}[];status:'active'|'pending';starts_at:string;expires_at:string};

export function groupAvailable(group:GroupContext,now=Date.now()){
 return group.active&&group.can_add_students!==false&&(!group.ends_at||Date.parse(group.ends_at)>now);
}
export function freeSeats(group:GroupContext){return Math.max(0,group.capacity-group.reserved_seats);}
export function defaultAccessDates(group:GroupContext,now=Date.now()):AccessDates{
 const knownStart=group.starts_at?Date.parse(group.starts_at):NaN;
 let start=Number.isFinite(knownStart)?knownStart:now;
 const knownEnd=group.ends_at?Date.parse(group.ends_at):NaN;
 const groupEnd=Number.isFinite(knownEnd)&&knownEnd>start&&knownEnd>now;
 if(!groupEnd)start=Math.max(start,now);
 const end=groupEnd?knownEnd:start+42*24*3600000;
 return {starts_at:localDate(new Date(start).toISOString()),expires_at:localDate(new Date(end).toISOString())};
}
export function localAccessDate(value:string):string|null{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
 try{const iso=utcDate(value);return iso&&localDate(iso)===value?iso:null;}catch{return null;}
}
export function toggleStudent(selected:SelectedStudents,student:GroupCandidate):SelectedStudents{
 if(selected[student.user_id]){const next={...selected};delete next[student.user_id];return next;}
 if(!student.selectable||Object.keys(selected).length>=GROUP_BATCH_LIMIT)return selected;
 return {...selected,[student.user_id]:student};
}
export function reconcileSelection(selected:SelectedStudents,visible:GroupCandidate[]):SelectedStudents{
 let next=selected;
 for(const row of visible){
  const previous=next[row.user_id];
  if(previous&&(!row.selectable||previous.enrollment_revision!==row.enrollment_revision||previous.enrollment_id!==row.enrollment_id)){
   if(next===selected)next={...selected};delete next[row.user_id];
  }
 }
 return next;
}
export function selectionProblem(group:GroupContext,selected:SelectedStudents,dates:AccessDates,now=Date.now()):'group'|'empty'|'limit'|'capacity'|'dates'|null{
 const students=Object.values(selected);
 if(!groupAvailable(group,now))return 'group';
 if(!students.length)return 'empty';
 if(students.length>GROUP_BATCH_LIMIT)return 'limit';
 if(students.length>freeSeats(group))return 'capacity';
 if(students.every(row=>row.eligibility==='ungrouped'))return null;
 const starts=localAccessDate(dates.starts_at),ends=localAccessDate(dates.expires_at);
 if(!starts||!ends||Date.parse(ends)<=Date.parse(starts)||Date.parse(ends)<=now)return 'dates';
 return null;
}
export function enrollmentRequest(operationId:string,selected:SelectedStudents,status:'active'|'pending',dates:AccessDates):GroupEnrollmentRequest{
 const starts_at=localAccessDate(dates.starts_at),expires_at=localAccessDate(dates.expires_at);
 if(!starts_at||!expires_at)throw new Error('Invalid access dates');
 return {operation_id:operationId,students:Object.values(selected).map(row=>({user_id:row.user_id,enrollment_revision:row.enrollment_revision})),status,starts_at,expires_at};
}
