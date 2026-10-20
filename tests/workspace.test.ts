import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {summarizeLearning,type Content} from '../client/src/learning-model';
import StudentHome from '../client/src/StudentHome';
import LessonWorkspace from '../client/src/LessonWorkspace';
import {dateLabel} from '../client/src/management';
import {WorkspaceNav} from '../client/src/ui';
import {TeacherScopeStatus} from '../client/src/TeacherPanel';
import ProtectedPlayer from '../client/src/ProtectedPlayer';

const now=Date.parse('2026-10-16T12:00:00Z');
const fixture:Content={course:{id:'own',title:'PP1 · Ә Ғ Қ Ң Ө Ұ Ү Һ І',description:'Owner-written course text'},groups:[],lessons:[
 {id:'done',course_id:'own',title:'Completed',published:true,revision:0,video_ready:true,completed_at:'2026-10-16T11:00:00Z',progress_seconds:600,last_opened_at:'2026-10-16T11:00:00Z'},
 {id:'resume',course_id:'own',title:'Resume <script>alert(1)</script>',published:true,revision:0,video_ready:true,progress_seconds:30,last_opened_at:'2026-10-16T10:00:00Z'},
 {id:'next',course_id:'own',title:'Upcoming lesson',published:true,revision:0,starts_at:'2026-10-17T12:00:00Z'},
],assignments:[{id:'submitted',course_id:'own',title:'Already handed in',revision:0,published:true,submission:{status:'submitted',current_version:1,grade:null,feedback:'',revision:1,answer:'Answer',files:[]}},
 {id:'revise',course_id:'own',title:'Please revise',revision:0,published:true,due_at:'2026-10-17T12:00:00Z',submission:{status:'needs_revision',current_version:1,grade:null,feedback:'Revise',revision:1,answer:'Answer',files:[]}},
 {id:'no-date',course_id:'own',title:'No deadline',revision:0,published:true}],archive:[],announcements:[]};

test('learning summary uses explicit completion, resume and submission states rather than page opens',()=>{
 const summary=summarizeLearning([fixture],now);
 assert.equal(summary.resume?.id,'resume');assert.equal(summary.completed,1);assert.equal(summary.total,3);
 assert.deepEqual(summary.upcoming.map(item=>item.id),['next']);assert.deepEqual(summary.due.map(item=>item.id),['revise','no-date']);
 assert.equal(summarizeLearning([],now).resume,undefined);
 assert.equal(summarizeLearning([{...fixture,lessons:[{...fixture.lessons[1],progress_seconds:0}]}],now).resume,undefined);
});
test('new learners start only published ready lessons; pending and completed recordings are not suggested',()=>{
 const content={...fixture,lessons:fixture.lessons.map(item=>({...item,progress_seconds:0,last_opened_at:null}))};
 assert.equal(summarizeLearning([content],now).start?.id,'resume');
 assert.equal(summarizeLearning([{...content,lessons:[{...content.lessons[1],published:false},content.lessons[2]]}],now).start,undefined);
 const html=renderToStaticMarkup(createElement(StudentHome,{lang:'en',name:'A <script>name</script>',courses:[fixture.course],contents:[content],loading:false,failed:0,view:'overview',onCourse(){},onLesson(){},onRetry(){}}));
 assert.ok(html.includes('Start learning')&&html.includes('A &lt;script&gt;name&lt;/script&gt;'));assert.ok(!html.includes('<script>'));
});
test('dashboard never presents incomplete completion/deadline data as zero; empty account points to real catalogue',()=>{
 const props={lang:'en' as const,courses:[fixture.course],contents:[],loading:false,failed:1,view:'overview' as const,onCourse(){},onLesson(){},onRetry(){}};
 const partial=renderToStaticMarkup(createElement(StudentHome,props));assert.ok(partial.includes('<dd>—</dd>'));
 const empty=renderToStaticMarkup(createElement(StudentHome,{...props,courses:[],failed:0}));assert.ok(empty.includes('href="#courses"'));assert.ok(!empty.includes('Start learning'));
});
test('dashboard discards stale content for courses no longer in the enrolled course list',()=>{
 const html=renderToStaticMarkup(createElement(StudentHome,{lang:'en',courses:[{id:'different',title:'Current enrolment',description:''}],contents:[fixture],loading:false,failed:0,view:'overview',onCourse(){},onLesson(){},onRetry(){}}));
 assert.ok(!html.includes('Resume &lt;script&gt;'));assert.ok(!html.includes('Please revise'));assert.ok(html.includes('<dd>—</dd>'));
});
test('student dashboard renders only supplied course data, escapes author text and exposes partial failures',()=>{
 for(const lang of ['en','kk','ru'] as const){
 const html=renderToStaticMarkup(createElement(StudentHome,{lang,courses:[fixture.course],contents:[fixture],loading:false,failed:1,view:'overview',onCourse(){},onLesson(){},onRetry(){}}));
 assert.ok(html.includes(fixture.course.description));assert.ok(html.includes('role="alert"'));
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('Already handed in'));assert.ok(!html.includes('100%'));
 assert.ok(html.includes('value="1" max="3"'));assert.ok(!html.includes('https://'));
 }
});
test('lesson view retains native protected player, current curriculum, real previous/next and role-specific completion',()=>{
 for(const role of ['ADMIN','TEACHER','STUDENT'] as const){
  const html=renderToStaticMarkup(createElement(LessonWorkspace,{content:fixture,lesson:fixture.lessons[1],lang:'en',role,onLesson(){},onBack(){},onAssignments(){},onMaterials(){}}));
  assert.ok(html.includes('<video'));assert.ok(html.includes('controlsList="nodownload'));
  assert.ok(html.includes('aria-current="step"'));assert.ok(!html.includes('<script>'));
  assert.equal(html.includes('complete-button'),role==='STUDENT');
  assert.ok(!html.includes('drive.google')&&!html.includes('grant_id'));
 }
 const empty=renderToStaticMarkup(createElement(LessonWorkspace,{content:fixture,lesson:fixture.lessons[2],lang:'en',role:'STUDENT',onLesson(){},onBack(){},onAssignments(){},onMaterials(){}}));
 assert.ok(empty.includes('Recording not available yet'));assert.ok(!empty.includes('<video'));
});
test('workspace navigation has one current destination and translated accessible labels',()=>{
 const html=renderToStaticMarkup(createElement(WorkspaceNav,{lang:'en',current:'courses',onSelect(){},items:[{id:'home',label:['Басты бет','Главная'],icon:'home'},{id:'courses',label:['Курстар','Курсы'],icon:'book'}]}));
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
 assert.ok(html.includes('aria-label="Workspace sections"'));assert.ok(html.includes('Courses'));
 assert.ok(html.includes('class="workspace-nav-home" href="#"'));
});

test('course-level teacher assignment is neutral, while inactive real groups remain paused',()=>{
 const course=renderToStaticMarkup(createElement(TeacherScopeStatus,{lang:'en',roster:false,row:{id:'course-only',has_roster:false,active:null}}));
 assert.ok(course.includes('Course-level'));assert.ok(!course.includes('Paused'));
 const group=renderToStaticMarkup(createElement(TeacherScopeStatus,{lang:'en',roster:false,row:{id:'group',has_roster:true,active:false}}));assert.ok(group.includes('Paused'));
});

test('player identity resets for another lesson but remains stable for language changes',()=>{
 function findPlayer(element:any):any{if(!element||typeof element!=='object')return undefined;if(element.type===ProtectedPlayer)return element;const children=element.props?.children;for(const child of Array.isArray(children)?children:[children]){const found=findPlayer(child);if(found)return found;}}
 const props={content:fixture,lesson:fixture.lessons[1],lang:'en' as const,role:'STUDENT' as const,onLesson(){},onBack(){},onAssignments(){},onMaterials(){}};
 const english=findPlayer(LessonWorkspace(props)),kazakh=findPlayer(LessonWorkspace({...props,lang:'kk'})),completed=findPlayer(LessonWorkspace({...props,lesson:fixture.lessons[0]}));
 assert.equal(english.key,kazakh.key);assert.notEqual(english.key,completed.key);
 assert.equal(completed.props.lesson.completed_at,fixture.lessons[0].completed_at);
});
test('dates use Almaty time and real Kazakh month names without Intl fallback placeholders',()=>{
 for(const lang of ['en','kk','ru'] as const){
  const label=dateLabel('2026-10-14T21:30:00Z',lang);assert.ok(label.includes('15'));assert.ok(label.includes('02:30'));assert.ok(!label.includes('M10'));
  assert.equal(dateLabel('invalid',lang),'—');
 }
 assert.ok(dateLabel('2026-10-14T21:30:00Z','kk').includes('қаз.'));
});
