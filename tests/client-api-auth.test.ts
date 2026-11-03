import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../client/src/api';

test('login 401 is not presented as an expired session; protected 401 still is', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const target = new EventTarget();
  let expiredEvents = 0;
  target.addEventListener('uyym-session-expired', () => { expiredEvents++; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: 'ru' } } });
  globalThis.fetch = async () => Response.json({ error: 'AUTH_REJECTED' }, { status: 401 });

  try {
    await assert.rejects(api('/api/auth/login', { method: 'POST', body: { phone: 'synthetic', password: 'synthetic' } }));
    assert.equal(expiredEvents, 0, 'failed login must not set the expired-session banner');

    await assert.rejects(api('/api/courses'));
    assert.equal(expiredEvents, 1, 'protected endpoint 401 must still expire the UI session');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    if (originalDocument === undefined) delete (globalThis as any).document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }
});

test('legacy Russian 503 does not falsely claim services are unconfigured',async()=>{
 const originalFetch=globalThis.fetch,originalDocument=globalThis.document;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{lang:'ru'}}});
 globalThis.fetch=async()=>Response.json({error:'Внешние сервисы ещё не подключены. Обратитесь к администратору'},{status:503});
 try{await assert.rejects(api('/api/teacher/video-uploads'),(error:any)=>{assert.equal(error.status,503);assert.equal(error.message,'Сервис временно недоступен. Не удалось выполнить запрос.');return true;});}
 finally{globalThis.fetch=originalFetch;if(originalDocument===undefined)delete(globalThis as any).document;else Object.defineProperty(globalThis,'document',{configurable:true,value:originalDocument});}
});
