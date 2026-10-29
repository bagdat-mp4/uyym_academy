import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import GroupEnrollmentDialog,{loadGroupCandidates,StudentChoices} from '../client/src/GroupEnrollmentDialog';
import EnrollmentPeriod from '../client/src/EnrollmentPeriod';
import {defaultAccessDates,enrollmentRequest,freeSeats,GROUP_BATCH_LIMIT,groupAvailable,localAccessDate,reconcileSelection,selectionProblem,toggleStudent,type GroupCandidate,type GroupCandidatePage,type GroupContext,type SelectedStudents} from '../client/src/group-enrollment-model';

const now=Date.parse('2026-10-29T10:00:00Z');
const group:GroupContext={id:'group-fixture',course_id:'course-fixture',title:'Local group',course_title:'Local course',active:true,can_add_students:true,capacity:5,reserved_seats:2,starts_at:'2026-10-01T10:00:00Z',ends_at:'2026-11-29T10:00:00Z',revision:1};
function student(id:string,patch:Partial<GroupCandidate>={}):GroupCandidate{return {id,user_id:id,name:`Local student ${id}`,phone:'synthetic',active:true,enrollment_id:null,enrollment_revision:null,group_id:null,group_title:null,status:null,eligibility:'new',selectable:true,...patch};}

test('candidate reads retain group, escaped search, page and device proof; aborted scopes never return stale lists',async()=>{
 const controller=new AbortController();let called=0;
 const page:GroupCandidatePage={group,items:[student('one')],total:22,page:2,page_size:20};
 const result=await loadGroupCandidates('group-fixture','Қ & + course',2,controller.signal,async(path,options)=>{
  called++;const url=new URL(path,'https://local.invalid');
  assert.equal(url.pathname,'/api/admin/groups/group-fixture/students');
  assert.deepEqual(Object.fromEntries(url.searchParams),{q:'Қ & + course',page:'2',page_size:'20'});
  assert.equal(options.proof,'api');assert.equal(options.signal,controller.signal);return page;
 });
 assert.equal(result,page);assert.equal(called,1);
 controller.abort();await assert.rejects(loadGroupCandidates('group-fixture','',1,controller.signal,async()=>{called++;return page;}),{name:'AbortError'});assert.equal(called,1);
 const late=new AbortController();await assert.rejects(loadGroupCandidates('group-fixture','old search',1,late.signal,async()=>{late.abort();return page;}),{name:'AbortError'});
});

test('selection survives other pages, rejects disabled entries and drops visible stale membership revisions',()=>{
 const one=student('one'),two=student('two',{enrollment_id:'enrollment-two',enrollment_revision:3,eligibility:'ungrouped'});
 let selected:SelectedStudents=toggleStudent({},one);selected=toggleStudent(selected,two);
 assert.deepEqual(Object.keys(selected),['one','two']);
 assert.equal(toggleStudent(selected,student('foreign',{selectable:false,eligibility:'other_group'})),selected);
 assert.equal(reconcileSelection(selected,[student('other-page')]),selected,'Paging must not clear invisible selections');
 const current=reconcileSelection(selected,[{...two,enrollment_revision:4}]);assert.deepEqual(Object.keys(current),['one']);assert.equal(selected.two,two,'Previous selection is immutable');
 const disabled=reconcileSelection(selected,[{...one,selectable:false,eligibility:'member'}]);assert.deepEqual(Object.keys(disabled),['two']);
 assert.deepEqual(Object.keys(toggleStudent(selected,one)),['two']);
});

test('bounded batch selection never imposes a platform-wide account limit',()=>{
 let selected:SelectedStudents={};for(let index=0;index<GROUP_BATCH_LIMIT;index++)selected=toggleStudent(selected,student(String(index)));
 assert.equal(Object.keys(selected).length,100);assert.equal(toggleStudent(selected,student('overflow')),selected);
 selected=toggleStudent(selected,student('0'));assert.ok(toggleStudent(selected,student('replacement')).replacement);
});

test('group date defaults use Almaty wall-clock and future dates even for a historical group with no end',()=>{
 assert.deepEqual(defaultAccessDates(group,now),{starts_at:'2026-10-01T15:00',expires_at:'2026-11-29T15:00'});
 const endless=defaultAccessDates({...group,ends_at:null},now);
 assert.equal(endless.starts_at,'2026-10-29T15:00');assert.ok(Date.parse(localAccessDate(endless.expires_at)!)>now);
 assert.equal(localAccessDate('2026-10-29T15:00'),'2026-10-29T10:00:00.000Z');
 for(const invalid of ['','2026-02-30T12:00','invalid','2026-10-29'])assert.equal(localAccessDate(invalid),null);
});

test('new individual access needs no date entry and future group starts are retained',()=>{
 const individual=defaultAccessDates({starts_at:null,ends_at:null},now);
 assert.deepEqual(individual,{starts_at:'2026-10-29T15:00',expires_at:'2026-12-10T15:00'});
 assert.equal(Date.parse(localAccessDate(individual.expires_at)!)-Date.parse(localAccessDate(individual.starts_at)!),42*24*3600000);
 assert.deepEqual(defaultAccessDates({starts_at:'2026-11-02T10:00:00Z',ends_at:null},now),{starts_at:'2026-11-02T15:00',expires_at:'2026-12-14T15:00'});
 assert.deepEqual(defaultAccessDates({starts_at:null,ends_at:'2026-11-29T10:00:00Z'},now),{starts_at:'2026-10-29T15:00',expires_at:'2026-11-29T15:00'});
});

test('automatic access period is a localized ready-to-save summary without hidden required date inputs',()=>{
 const dates=defaultAccessDates({starts_at:null,ends_at:null},now);
 for(const [lang,automatic,change] of [['en','Selected automatically','Change dates'],['kk','Автоматты түрде таңдалды','Күндерді өзгерту'],['ru','Выбрано автоматически','Изменить даты']] as const){
  const html=renderToStaticMarkup(createElement(EnrollmentPeriod,{dates,automaticDates:()=>dates,onChange(){throw Error('Rendering must not change dates');},lang}));
  assert.ok(html.includes(automatic)&&html.includes(change)&&html.includes('UTC+5'));
  assert.ok(!html.includes('type="datetime-local"')&&!html.includes('required=""'));
  assert.ok(html.includes('type="button"')&&html.includes('aria-expanded="false"'));
 }
});

test('validation honors capacity and current group state; dates apply only to new course enrollments',()=>{
 const dates=defaultAccessDates(group,now),one=student('one'),ungrouped=student('existing',{eligibility:'ungrouped',enrollment_id:'existing',enrollment_revision:4});
 assert.equal(freeSeats(group),3);assert.equal(groupAvailable({...group,can_add_students:false},now),false);
 assert.equal(selectionProblem(group,{},dates,now),'empty');
 assert.equal(selectionProblem({...group,active:false},{one},dates,now),'group');
 assert.equal(selectionProblem({...group,ends_at:'2026-10-01T00:00:00Z'},{one},dates,now),'group');
 assert.equal(selectionProblem({...group,capacity:2},{one},dates,now),'capacity');
 assert.equal(selectionProblem(group,{one},{starts_at:'invalid',expires_at:''},now),'dates');
 assert.equal(selectionProblem(group,{ungrouped},{starts_at:'invalid',expires_at:''},now),null,'Hidden irrelevant new-access dates must not block group-only attachment');
 assert.equal(selectionProblem(group,{one},dates,now),null);
});

test('frozen mutation snapshot sends only IDs, revisions and explicit new-access choices',()=>{
 const row=student('one',{name:'Private fixture identity',enrollment_revision:4,enrollment_id:'existing',eligibility:'ungrouped'}),selected={one:row};
 const body=enrollmentRequest('operation-fixture',selected,'active',{starts_at:'2026-10-29T15:00',expires_at:'2026-11-29T15:00'});
 assert.deepEqual(body,{operation_id:'operation-fixture',students:[{user_id:'one',enrollment_revision:4}],status:'active',starts_at:'2026-10-29T10:00:00.000Z',expires_at:'2026-11-29T10:00:00.000Z'});
 row.enrollment_revision=9;delete (selected as Partial<typeof selected>).one;
 assert.equal(body.students[0].enrollment_revision,4);assert.ok(!JSON.stringify(body).includes('Private fixture identity'));
});

test('student choices expose escaped identities and native checked/disabled states in all languages',()=>{
 const first=student('one',{name:'<img onerror=unsafe>',phone:'<phone>'}),foreign=student('foreign',{group_title:'Other <group>',eligibility:'other_group',selectable:false});
 for(const [lang,text] of [['en','In another group'],['kk','Басқа топта'],['ru','В другой группе']] as const){
  const html=renderToStaticMarkup(createElement(StudentChoices,{items:[first,foreign],selected:{one:first},lang,disabled:false,onToggle(){throw Error('SSR must not select');}}));
  assert.equal((html.match(/type="checkbox"/g)||[]).length,2);assert.equal((html.match(/checked=""/g)||[]).length,1);assert.equal((html.match(/disabled=""/g)||[]).length,1);
  assert.ok(html.includes('&lt;img onerror=unsafe&gt;')&&html.includes('&lt;phone&gt;')&&html.includes('Other &lt;group&gt;'));
  assert.ok(!html.includes('<img')&&html.includes(text));
 }
});

test('dialog initial state is localized and does not invent a loaded student list or issue mutations',()=>{
 for(const [lang,title] of [['en','Add students to a group'],['kk','Топқа оқушылар қосу'],['ru','Добавить учеников в группу']] as const){
  const html=renderToStaticMarkup(createElement(GroupEnrollmentDialog,{groupId:group.id,lang,onClose(){},onSaved(){throw Error('SSR must not mutate');}}));
  assert.ok(html.includes('aria-modal="true"')&&html.includes(title));assert.ok(html.includes('aria-busy="true"'));
  assert.ok(!html.includes('Local student one'));assert.ok(!html.includes('value="group-fixture"'));
 }
});
