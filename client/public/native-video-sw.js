/* UYYM native MP4 transport. No Drive URL, OAuth token or reusable media token is stored here. */
const MAX_PART=1048576;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

function browserKey(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('uyym-browser-identity',1);
 request.onerror=()=>reject(new Error('Browser key unavailable'));
 request.onsuccess=()=>{const database=request.result,tx=database.transaction('identity','readonly'),get=tx.objectStore('identity').get('p256-v1');
  get.onsuccess=()=>{database.close();if(!get.result?.privateKey||get.result.privateKey.extractable)reject(new Error('Browser key unavailable'));else resolve(get.result.privateKey);};
  get.onerror=()=>{database.close();reject(new Error('Browser key unavailable'));};
 };
 });}
function base64url(bytes){let value='';for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function chunk(path){
 const statusResponse=await fetch('/api/auth/status',{credentials:'same-origin',cache:'no-store'});
 const status=await statusResponse.json();
 if(!status.authenticated||!status.session_active||status.device_status!=='approved'||!status.csrf_token)throw new Error('Session unavailable');
 const body=JSON.stringify({method:'GET',path,purpose:'media',body_hash:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'});
 const challengeResponse=await fetch('/api/proof/challenge',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-csrf-token':status.csrf_token},body});
 if(!challengeResponse.ok)return challengeResponse;
 const challenge=await challengeResponse.json();
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},await browserKey(),new TextEncoder().encode(challenge.payload));
 return fetch(path,{credentials:'same-origin',cache:'no-store',headers:{'x-proof-id':challenge.id,'x-device-proof':base64url(signature)}});
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||!/^\/api\/native-media\/[0-9a-f-]{36}$/i.test(url.pathname))return;
 event.respondWith((async()=>{
  try{
   const grant=url.searchParams.get('grant'),size=Number(url.searchParams.get('size'));
   if(!/^[0-9a-f-]{36}$/i.test(grant||'')||!Number.isSafeInteger(size)||size<1)return new Response(null,{status:400});
   const range=event.request.headers.get('range');
   const match=range?/^bytes=(\d+)-(\d*)$/.exec(range):null;
   if(range&&!match)return new Response(null,{status:416});
   const start=match?Number(match[1]):0;
   if(!Number.isSafeInteger(start)||start>=size)return new Response(null,{status:416});
   const requestedEnd=match&&match[2]?Number(match[2]):size-1;
   const end=Math.min(requestedEnd,start+MAX_PART-1,size-1);
   if(!Number.isSafeInteger(end)||end<start)return new Response(null,{status:416});
   const path=`/api/native-chunk/${url.pathname.split('/').pop()}?grant=${encodeURIComponent(grant)}&start=${start}&end=${end}`;
   return await chunk(path);
  }catch{return new Response(null,{status:503,headers:{'cache-control':'private, no-store'}});}
 })());
});
