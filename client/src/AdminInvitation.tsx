import {useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {api} from './api';
import {Dialog,Notice,message,newOperation,value,type Row,type Lang} from './management';

// Each new security instruction is explicit in all three languages.
const copy=(lang:Lang,en:string,kk:string,ru:string)=>lang==='en'?en:lang==='kk'?kk:ru;
export function InviteAdminDialog({user,lang,onClose,onSaved}:{user:Row;lang:Lang;onClose:()=>void;onSaved:()=>void}){
 const [pending,setPending]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[code,setCode]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [operationId]=useState(newOperation),[cancelId]=useState(newOperation);
 const t=(en:string,kk:string,ru:string)=>copy(lang,en,kk,ru);
 const path=`/api/admin/users/${user.id}/admin-invitation`;
 useEffect(()=>{const controller=new AbortController();void api<{pending:boolean}>(path,{proof:'api',signal:controller.signal}).then(data=>setPending(data.pending)).catch(e=>{if(!controller.signal.aborted)setError(message(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[path]);
 const submit=async(event:FormEvent)=>{
  event.preventDefault();setBusy(true);setError('');
  try{await api(path,{method:'POST',proof:'api',body:{operation_id:operationId,identity_verified:true,full_access_confirmed:true,code}});onSaved();}
  catch(e){setError(message(e));}finally{setBusy(false);setCode('');}
 };
 const cancel=async()=>{setBusy(true);setError('');try{await api(path+'/cancel',{method:'POST',proof:'api',body:{operation_id:cancelId}});onSaved();}catch(e){setError(message(e));}finally{setBusy(false);}};
 return <Dialog title={t('Administrator invitation','Әкімшіге шақыру','Приглашение администратора')} lang={lang} onClose={onClose} busy={busy}>
  <p className="manage-dialog-description"><strong>{value(user,'name')}</strong><br/>{value(user,'phone')}</p>
  <Notice error={error}/>
  {loading?<p>{t('Checking invitation…','Шақыру тексерілуде…','Проверяем приглашение…')}</p>:pending?<>
   <p>{t('An invitation is already pending. It expires after 24 hours. The recipient must change their temporary password, use an approved browser and configure their own TOTP before ADMIN access opens.','Шақыру жіберілген. Ол 24 сағаттан кейін аяқталады. Алушы уақытша паролін ауыстырып, мақұлданған браузерден жеке TOTP орнатуы керек.','Приглашение уже ожидает принятия и действует 24 часа. Получатель должен сменить временный пароль, войти из одобренного браузера и настроить собственный TOTP до открытия ADMIN.')}</p>
   <button className="button button-outline" disabled={busy} onClick={()=>void cancel()}>{t('Cancel invitation','Шақыруды қайтару','Отменить приглашение')}</button>
  </>:<form className="manage-form" onSubmit={event=>void submit(event)}>
   <p className="manage-dialog-description">{t('ADMIN has full access to users, courses, browser approvals and settings. No administrator rights are granted until the recipient confirms their own TOTP. Your current access stays active.','ADMIN пайдаланушыларға, курстарға, браузерлерді мақұлдауға және баптауларға толық қол жеткізеді. Алушы жеке TOTP растамайынша әкімші құқығы берілмейді. Сіздің қолжетімділігіңіз сақталады.','ADMIN получит полный доступ к пользователям, курсам, одобрению браузеров и настройкам. Права выдаются только после подтверждения личного TOTP получателем. Ваш доступ сохраняется.')}</p>
   <label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>{t('I verified this person and authorize full ADMIN access.','Жеке басын тексердім және толық ADMIN құқығын беремін.','Я проверил личность и разрешаю полный доступ ADMIN.')}</label>
   <label>{t('Your current authenticator code','Сіздің ағымдағы аутентификатор кодыңыз','Ваш текущий код аутентификатора')}<input type="password" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required pattern="[0-9]{6}" maxLength={6}/></label>
   <p className="manage-dialog-description">{t('Wait for a new code if you just used this code to sign in. Never send an authenticator key or code in chat.','Бұл кодпен жаңа кірсеңіз, келесі кодты күтіңіз. Аутентификатор кілтін не кодын чатқа жібермеңіз.','Если этим кодом вы только что вошли, дождитесь следующего. Не отправляйте ключ или код аутентификатора в чат.')}</p>
   <button className="button button-yellow" disabled={busy||!confirmed}>{t('Send administrator invitation','Әкімші шақыруын жіберу','Отправить приглашение администратора')}</button>
  </form>}
 </Dialog>;
}

export function AdminInvitationSetup({lang,onDone,children}:{lang:Lang;onDone:()=>void;children:ReactNode}){
 const [checked,setChecked]=useState(false);
 const [pending,setPending]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[code,setCode]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [setup,setSetup]=useState<{secret:string;setup_token:string}|null>(null),[recovery,setRecovery]=useState<string[]|null>(null),[saved,setSaved]=useState(false);
 const t=(en:string,kk:string,ru:string)=>copy(lang,en,kk,ru);
 useEffect(()=>{const controller=new AbortController();void api<{pending:boolean}>('/api/account/admin-invitation',{proof:'api',signal:controller.signal}).then(data=>setPending(data.pending)).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setChecked(true);});return()=>controller.abort();},[]);
 const start=async()=>{setBusy(true);setError('');try{setSetup(await api('/api/account/admin-invitation/setup',{method:'POST',proof:'api'}));}catch(e){setError(message(e));}finally{setBusy(false);}};
 const confirm=async(event:FormEvent)=>{
  event.preventDefault();if(!setup)return;setBusy(true);setError('');
  try{const result=await api<{recovery_codes:string[]}>('/api/account/admin-invitation/confirm',{method:'POST',proof:'api',body:{setup_token:setup.setup_token,code,full_access_confirmed:true}});setRecovery(result.recovery_codes);setSetup(null);}
  catch(e){setError(message(e));}finally{setBusy(false);setCode('');}
 };
 if(!checked)return <p>{t('Checking invitation…','Шақыру тексерілуде…','Проверяем приглашение…')}</p>;
 if(!pending)return <>{children}</>;
 return <section className="dashboard-panel" style={{marginBottom:24}}>
  <h2>{t('Administrator invitation','Әкімшіге шақыру','Приглашение администратора')}</h2><Notice error={error}/>
  {recovery?<>
   <p>{t('ADMIN activated. Your previous sessions were closed. Save these one-use recovery codes offline: they are shown once. Then sign in again with your own password and TOTP.','ADMIN іске қосылды. Бұрынғы сессиялар жабылды. Бір реттік қалпына келтіру кодтарын офлайн сақтаңыз: олар бір рет көрсетіледі. Содан кейін өз пароліңізбен және TOTP арқылы қайта кіріңіз.','ADMIN активирован, прежние сессии закрыты. Сохраните одноразовые коды восстановления офлайн: они показываются один раз. Затем войдите заново со своим паролем и TOTP.')}</p>
   <output className="temporary-password" style={{display:'block',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{recovery.join('\n')}</output>
   <label className="checkbox-field"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>{t('Recovery codes saved offline','Қалпына келтіру кодтары офлайн сақталды','Коды восстановления сохранены офлайн')}</label>
   <button className="button button-yellow" disabled={!saved} onClick={onDone}>{t('Return to sign in','Қайта кіру','Перейти ко входу')}</button>
  </>:setup?<form className="manage-form" onSubmit={event=>void confirm(event)}>
   <p>{t('In your authenticator, add a new time-based entry named UYYM Academy using this key. Keep it private. Setup expires after 10 minutes; generate a new key here if it expires.','Аутентификаторда UYYM Academy атты уақытқа негізделген жаңа жазба жасаңыз. Осы кілтті құпия сақтаңыз. Баптау 10 минутқа жарамды; аяқталса жаңа кілт жасаңыз.','В аутентификаторе добавьте новую запись UYYM Academy по времени с этим ключом. Сохраните его в тайне. Настройка действует 10 минут; при истечении создайте новый ключ здесь.')}</p>
   <output className="temporary-password" style={{overflowWrap:'anywhere'}}>{setup.secret}</output>
   <label>{t('Your new authenticator code','Жаңа аутентификатор кодыңыз','Код вашего нового аутентификатора')}<input type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required/></label>
   <label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>{t('I accept full administrator access and responsibility for it.','Толық әкімші құқығын және жауапкершілікті қабылдаймын.','Я принимаю полный доступ администратора и ответственность за него.')}</label>
   <div className="manage-dialog-actions"><button className="button button-yellow" disabled={busy||!confirmed}>{t('Confirm TOTP and activate ADMIN','TOTP растап, ADMIN іске қосу','Подтвердить TOTP и активировать ADMIN')}</button><button type="button" className="button button-outline" disabled={busy} onClick={()=>void start()}>{t('Generate a new setup key','Жаңа баптау кілтін жасау','Создать новый ключ настройки')}</button></div>
  </form>:<>
   <p>{t('You were invited to full ADMIN access. Configure your own authenticator to accept. Do not share your password, key or recovery codes.','Сіз толық ADMIN құқығына шақырылдыңыз. Қабылдау үшін жеке аутентификатор орнатыңыз. Пароль, кілт және қалпына келтіру кодтарын бөліспеңіз.','Вас пригласили получить полный доступ ADMIN. Для принятия настройте личный аутентификатор. Не передавайте пароль, ключ и коды восстановления.')}</p>
   <button className="button button-yellow" disabled={busy} onClick={()=>void start()}>{t('Set up my authenticator','Жеке аутентификатор орнату','Настроить мой аутентификатор')}</button>
  </>}
 </section>;
}
