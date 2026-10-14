import {useState} from 'react';
import {api} from './api';
import {message,Notice,tr,type Lang} from './management';

// Temporary: no automatic diagnostic request on mount or refresh.
export default function OwnerAuthDiagnostic({lang}:{lang:Lang}) {
 const [busy,setBusy]=useState(false),[result,setResult]=useState(''),[error,setError]=useState('');
 const check=async()=>{
  setBusy(true);setResult('');setError('');
  try {
   const response=await api<{ok:true}>('/api/admin/diagnostics/auth',{proof:'api'});
   if(response.ok===true)setResult('ok');
  } catch(e){setError(message(e));}finally{setBusy(false);}
 };
 return <section className="manage-section">
  <h3>{tr(lang,['Auth уақытша тексеруі','Временная проверка Auth'])}</h3>
  <p>{tr(lang,['Тек иесінің Auth жазбасын оқу. Аккаунттар мен қолжетімділік өзгермейді.','Только чтение Auth-записи владельца. Аккаунты и доступы не изменяются.'])}</p>
  <button type="button" className="button button-outline" disabled={busy} onClick={()=>void check()}>{busy?tr(lang,['Тексерілуде…','Проверяем…']):tr(lang,['Auth тексеру (тек оқу)','Проверить Auth (только чтение)'])}</button>
  <Notice success={result} error={error}/>
 </section>;
}
